import { Chess } from 'chess.js';
import { db, getSettings } from '../db/db';
import type { AnalyzedMove, Classification, Game, GameAnalysis, PlayerSummary, PositionEval } from '../types';
import { classifyMove } from '../analysis/classify';
import { fenKey, loadOpenings, lookupOpening } from '../analysis/openings';
import { gameAccuracy, moveAccuracy, winPctWhite } from '../analysis/winprob';
import { checkGameAgainstRepertoire } from '../repertoire/repertoire';
import { getEngine } from './engine';

export const ALL_CLASSES: Classification[] = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder', 'forced'];
const emptyCounts = () => Object.fromEntries(ALL_CLASSES.map((c) => [c, 0])) as Record<Classification, number>;

async function evalCached(fen: string, depth: number, multiPv: number): Promise<PositionEval> {
  const key = `${fenKey(fen)}|${depth}|${multiPv}`;
  const hit = await db.evalCache.get(key);
  if (hit) return { ...(hit.data as PositionEval), fen };
  const ev = await getEngine().analyze(fen, depth, multiPv);
  await db.evalCache.put({ key, fen, depth, multiPv, data: ev });
  return ev;
}

export function parseGame(pgn: string) {
  const c = new Chess();
  c.loadPgn(pgn);
  const hist = c.history({ verbose: true });
  return hist.map((m) => ({ capture: m.isCapture() || m.isEnPassant(), san: m.san, uci: m.from + m.to + (m.promotion ?? ''), color: m.color, before: m.before, after: m.after }));
}

export async function analyzeGame(game: Game, onProgress?: (done: number, total: number) => void): Promise<GameAnalysis> {
  const settings = await getSettings();
  await loadOpenings();
  const moves = parseGame(game.pgn);
  const fens = [moves[0]?.before ?? new Chess().fen(), ...moves.map((m) => m.after)];

  // Book detection first so book positions can use a shallower search.
  let inBook = true;
  const bookFlags = moves.map((m) => { inBook = inBook && !!lookupOpening(m.after); return inBook; });

  const evals: PositionEval[] = [];
  for (let i = 0; i < fens.length; i++) {
    const depth = i > 0 && bookFlags[i - 1] ? Math.min(12, settings.depth) : settings.depth;
    evals.push(await evalCached(fens[i], depth, settings.multiPv));
    onProgress?.(i + 1, fens.length);
  }

  const out: AnalyzedMove[] = [];
  let lastOpening: { eco: string; name: string } | null = null;
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const r = classifyMove({
      color: m.color, fenBefore: m.before, fenAfter: m.after, uci: m.uci,
      evalBefore: evals[i], evalAfter: evals[i + 1], isBook: bookFlags[i],
      prevOpponent: out[i - 1]?.classification, prevUci: moves[i - 1]?.uci, prevWasCapture: moves[i - 1]?.capture,
      thresholds: settings.thresholds,
    });
    const op = lookupOpening(m.after);
    if (op) lastOpening = op;
    const best = evals[i].lines[0];
    out.push({
      ply: i + 1, san: m.san, uci: m.uci, color: m.color, fenBefore: m.before, fenAfter: m.after,
      evalBefore: evals[i], evalAfter: evals[i + 1], winBefore: r.winBefore, winAfter: r.winAfter,
      classification: r.classification, bestSan: best?.san, bestUci: best?.uci,
      accuracy: moveAccuracy(r.winBefore, r.winAfter), openingName: lastOpening?.name,
    });
  }

  if (game.userColor) {
    try {
      const status = await checkGameAgainstRepertoire(out, game.userColor);
      out.forEach((m, i) => { if (status[i]) m.repertoire = status[i]; });
    } catch { /* repertoire is optional */ }
  }

  const whiteWins = evals.map((e, i) => (e.lines[0] ? winPctWhite(e.lines[0].score) : (out[i - 1]?.color === 'w' ? out[i - 1].winAfter : 100 - (out[i - 1]?.winAfter ?? 50))));
  const accs = out.map((m) => m.accuracy);
  const summary = (color: 'w' | 'b'): PlayerSummary => {
    const counts = emptyCounts();
    out.filter((m) => m.color === color).forEach((m) => counts[m.classification]++);
    return { accuracy: gameAccuracy(whiteWins, accs, color), counts };
  };

  const analysis: GameAnalysis = {
    gameId: game.id, depth: settings.depth, createdAt: Date.now(), moves: out,
    white: summary('w'), black: summary('b'),
    openingName: lastOpening?.name ?? game.openingName, eco: lastOpening?.eco ?? game.eco,
  };
  await db.analyses.put(analysis);
  await db.games.update(game.id, { analyzed: true, openingName: game.openingName ?? lastOpening?.name, eco: game.eco ?? lastOpening?.eco });
  return analysis;
}
