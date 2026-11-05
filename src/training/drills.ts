import { db } from '../db/db';
import { winPctFor } from '../analysis/winprob';
import type { Classification, Drill, Game, GameAnalysis } from '../types';

export const DRILL_CLASSES: Classification[] = ['mistake', 'blunder', 'miss'];
const MIN = 60_000;
const DAY = 86_400_000;

/** Pure: which drills should exist, given games/analyses and the ids already stored. */
export function selectNewDrills(games: Game[], analyses: GameAnalysis[], existing: Set<string>, now = Date.now()): Drill[] {
  const byId = new Map(games.map((g) => [g.id, g]));
  const out: Drill[] = [];
  for (const a of analyses) {
    const g = byId.get(a.gameId);
    if (!g?.userColor) continue;
    for (const m of a.moves) {
      if (m.color !== g.userColor || !DRILL_CLASSES.includes(m.classification) || !m.bestUci) continue;
      const id = `${a.gameId}:${m.ply}`;
      if (existing.has(id)) continue;
      out.push({
        id, gameId: a.gameId, ply: m.ply, fen: m.fenBefore, color: m.color,
        bestUci: m.bestUci, bestSan: m.bestSan ?? m.bestUci, playedSan: m.san, classification: m.classification,
        createdAt: now, due: now, interval: 0, ease: 2.5, reps: 0, lapses: 0,
      });
    }
  }
  return out;
}

/** Create drills for every new mistake of mine. Returns how many were added. */
let inflight: Promise<number> | null = null;
export function syncDrills(): Promise<number> {
  // Share one run between concurrent callers (e.g. React StrictMode double mount).
  inflight ??= doSync().finally(() => { inflight = null; });
  return inflight;
}

async function doSync(): Promise<number> {
  const [games, analyses, existing] = await Promise.all([
    db.games.toArray(), db.analyses.toArray(), db.drills.toCollection().primaryKeys(),
  ]);
  const fresh = selectNewDrills(games, analyses, new Set(existing as string[]));
  if (fresh.length) await db.drills.bulkPut(fresh);
  return fresh.length;
}

/** Simple SM-2 grading. Returns the updated drill (does not persist). */
export function gradeDrill(drill: Drill, pass: boolean, now = Date.now()): Drill {
  if (pass) {
    const reps = drill.reps + 1;
    const interval = reps === 1 ? 1 : reps === 2 ? 3 : Math.round(drill.interval * drill.ease);
    return { ...drill, reps, interval, ease: Math.min(3, drill.ease + 0.1), due: now + interval * DAY, lastResult: 'pass' };
  }
  return {
    ...drill, lapses: drill.lapses + 1, reps: 0, interval: 0, ease: Math.max(1.3, drill.ease - 0.2),
    due: now + 10 * MIN, lastResult: 'fail',
  };
}

export async function gradeAndSave(drill: Drill, pass: boolean): Promise<Drill> {
  const next = gradeDrill(drill, pass);
  await db.drills.put(next);
  return next;
}

/** Pure check against an (optional) stored analysis. */
export function isAcceptable(drill: Drill, uci: string, analysis?: GameAnalysis): boolean {
  if (uci === drill.bestUci) return true;
  const mv = analysis?.moves.find((m) => m.ply === drill.ply);
  const lines = mv?.evalBefore.lines;
  if (!lines?.length) return false;
  const best = winPctFor(lines[0].score, drill.color);
  const alt = lines.find((l) => l.uci === uci);
  return !!alt && best - winPctFor(alt.score, drill.color) <= 3;
}

export async function isCorrect(drill: Drill, uci: string, _fen?: string): Promise<boolean> {
  if (uci === drill.bestUci) return true;
  return isAcceptable(drill, uci, await db.analyses.get(drill.gameId));
}
