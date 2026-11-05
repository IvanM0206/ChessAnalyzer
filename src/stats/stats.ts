import type { AnalyzedMove, Color, Game, GameAnalysis, TimeClass } from '../types';

export type Outcome = 'win' | 'draw' | 'loss';
export type Phase = 'opening' | 'middlegame' | 'endgame';
export const PHASES: Phase[] = ['opening', 'middlegame', 'endgame'];
export const TIME_CLASSES: TimeClass[] = ['bullet', 'blitz', 'rapid', 'classical', 'daily'];

export interface StatsFilters { periodDays: number | null; timeClass: TimeClass | ''; color: Color | '' }

export interface AnalyzedGame { game: Game; analysis: GameAnalysis; color: Color; outcome: Outcome | undefined; accuracy: number }

export function outcomeOf(g: Game): Outcome | undefined {
  if (!g.userColor || g.result === '*') return undefined;
  if (g.result === '1/2-1/2') return 'draw';
  return (g.userColor === 'w') === (g.result === '1-0') ? 'win' : 'loss';
}

/** Join games with their analysis; only games where I know my color. */
export function joinGames(games: Game[], analyses: GameAnalysis[]): AnalyzedGame[] {
  const am = new Map(analyses.map((a) => [a.gameId, a]));
  const out: AnalyzedGame[] = [];
  for (const game of games) {
    const analysis = am.get(game.id);
    if (!analysis || !game.userColor) continue;
    out.push({ game, analysis, color: game.userColor, outcome: outcomeOf(game), accuracy: (game.userColor === 'w' ? analysis.white : analysis.black).accuracy });
  }
  return out;
}

export function filterGames(items: AnalyzedGame[], f: StatsFilters, now = Date.now()): AnalyzedGame[] {
  const cutoff = f.periodDays ? new Date(now - f.periodDays * 86_400_000).toISOString().slice(0, 10) : '';
  return items.filter((x) => {
    if (f.color && x.color !== f.color) return false;
    if (f.timeClass && x.game.timeClass !== f.timeClass) return false;
    if (cutoff && (!x.game.date || x.game.date < cutoff)) return false;
    return true;
  });
}

/** Non-pawn material (N/B=3, R=5, Q=9) per side from a FEN. */
export function materialFromFen(fen: string): { w: number; b: number; queens: number } {
  const v: Record<string, number> = { n: 3, b: 3, r: 5, q: 9 };
  const r = { w: 0, b: 0, queens: 0 };
  for (const ch of fen.split(' ')[0]) {
    const val = v[ch.toLowerCase()];
    if (!val) continue;
    r[ch === ch.toLowerCase() ? 'b' : 'w'] += val;
    if (ch.toLowerCase() === 'q') r.queens++;
  }
  return r;
}

export function isEndgameFen(fen: string): boolean {
  const m = materialFromFen(fen);
  return (m.w <= 13 && m.b <= 13) || (m.queens === 0 && m.w <= 20 && m.b <= 20);
}

/** Phase of every move in a game. Opening = first 20 plies or the initial book run. */
export function movePhases(moves: AnalyzedMove[]): Phase[] {
  let inBook = true;
  return moves.map((m) => {
    inBook = inBook && m.classification === 'book';
    if (isEndgameFen(m.fenBefore)) return 'endgame';
    return m.ply <= 20 || inBook ? 'opening' : 'middlegame';
  });
}

export interface Kpis {
  games: number; wins: number; draws: number; losses: number;
  winPct: number; drawPct: number; lossPct: number; avgAccuracy: number; blundersPerGame: number;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function computeKpis(items: AnalyzedGame[]): Kpis {
  const n = items.length;
  const c = (o: Outcome) => items.filter((x) => x.outcome === o).length;
  const wins = c('win'), draws = c('draw'), losses = c('loss');
  const decided = wins + draws + losses || 1;
  const blunders = items.reduce((s, x) => s + (x.color === 'w' ? x.analysis.white : x.analysis.black).counts.blunder, 0);
  return {
    games: n, wins, draws, losses,
    winPct: (wins / decided) * 100, drawPct: (draws / decided) * 100, lossPct: (losses / decided) * 100,
    avgAccuracy: avg(items.map((x) => x.accuracy)), blundersPerGame: n ? blunders / n : 0,
  };
}

export interface AccuracyPoint { date: string; accuracy: number; avg: number; opponent: string; label: string }

export function accuracySeries(items: AnalyzedGame[], window = 5): AccuracyPoint[] {
  const sorted = items.slice().sort((a, b) => (a.game.date || '').localeCompare(b.game.date || '') || a.game.importedAt - b.game.importedAt);
  return sorted.map((x, i) => ({
    date: x.game.date, accuracy: Math.round(x.accuracy * 10) / 10,
    avg: Math.round(avg(sorted.slice(Math.max(0, i - window + 1), i + 1).map((s) => s.accuracy)) * 10) / 10,
    opponent: x.color === 'w' ? x.game.black : x.game.white, label: x.game.date || 'Sin fecha',
  }));
}

export interface OpeningRow { name: string; games: number; wins: number; draws: number; losses: number; accuracy: number }

/** Group by opening family (text before ':'), for one color. */
export function openingRows(items: AnalyzedGame[], color: Color): OpeningRow[] {
  const map = new Map<string, AnalyzedGame[]>();
  for (const x of items) {
    if (x.color !== color) continue;
    const full = x.game.openingName || x.analysis.openingName || 'Sin apertura';
    const name = full.split(':')[0].trim();
    (map.get(name) ?? map.set(name, []).get(name)!).push(x);
  }
  return [...map].map(([name, xs]) => ({
    name, games: xs.length,
    wins: xs.filter((x) => x.outcome === 'win').length, draws: xs.filter((x) => x.outcome === 'draw').length,
    losses: xs.filter((x) => x.outcome === 'loss').length, accuracy: avg(xs.map((x) => x.accuracy)),
  }));
}

export interface PhaseRow { phase: Phase; inaccuracy: number; mistake: number; blunder: number; moves: number; accuracy: number }

export function phaseStats(items: AnalyzedGame[]): PhaseRow[] {
  const rows: PhaseRow[] = PHASES.map((phase) => ({ phase, inaccuracy: 0, mistake: 0, blunder: 0, moves: 0, accuracy: 0 }));
  const accSum = [0, 0, 0];
  for (const x of items) {
    const phases = movePhases(x.analysis.moves);
    x.analysis.moves.forEach((m, i) => {
      if (m.color !== x.color) return;
      const k = PHASES.indexOf(phases[i]);
      rows[k].moves++; accSum[k] += m.accuracy;
      if (m.classification === 'inaccuracy' || m.classification === 'mistake' || m.classification === 'blunder') rows[k][m.classification]++;
      else if (m.classification === 'miss') rows[k].mistake++;
    });
  }
  rows.forEach((r, k) => { r.accuracy = r.moves ? accSum[k] / r.moves : 0; });
  return rows;
}

export interface TimeClassRow { timeClass: TimeClass; games: number; winPct: number; accuracy: number }

export function timeClassRows(items: AnalyzedGame[]): TimeClassRow[] {
  return TIME_CLASSES.map((tc) => {
    const xs = items.filter((x) => x.game.timeClass === tc);
    const decided = xs.filter((x) => x.outcome);
    return { timeClass: tc, games: xs.length, winPct: decided.length ? (decided.filter((x) => x.outcome === 'win').length / decided.length) * 100 : 0, accuracy: avg(xs.map((x) => x.accuracy)) };
  }).filter((r) => r.games > 0);
}
