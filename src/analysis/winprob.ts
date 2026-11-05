import type { Color, Score } from '../types';

/** Win probability (0..100) for White from an engine score (Lichess model). */
export function winPctWhite(s: Score): number {
  if (s.mate !== undefined) return s.mate > 0 ? 100 : s.mate < 0 ? 0 : 50;
  const cp = Math.max(-1000, Math.min(1000, s.cp ?? 0));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

export const winPctFor = (s: Score, c: Color) => (c === 'w' ? winPctWhite(s) : 100 - winPctWhite(s));

/** Per-move accuracy from win% before/after (mover POV). */
export function moveAccuracy(winBefore: number, winAfter: number): number {
  const diff = Math.max(0, winBefore - winAfter);
  const raw = 103.1668 * Math.exp(-0.04354 * diff) - 3.1669 + 1;
  return Math.max(0, Math.min(100, raw));
}

/**
 * Game accuracy for one player: average of a volatility-weighted mean and the
 * harmonic mean of per-move accuracies (Lichess-style).
 * @param whiteWins win% for White at every position (length = moves + 1)
 */
export function gameAccuracy(whiteWins: number[], moveAccs: number[], color: Color): number {
  const n = whiteWins.length - 1;
  if (n <= 0) return 0;
  const win = Math.max(2, Math.min(8, Math.floor(n / 10)));
  const weights: number[] = [];
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, Math.min(i - Math.floor(win / 2), whiteWins.length - win));
    const slice = whiteWins.slice(lo, lo + win);
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    const sd = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / slice.length);
    weights.push(Math.max(0.5, Math.min(12, sd)));
  }
  const start = color === 'w' ? 0 : 1;
  let wSum = 0, wAcc = 0, hSum = 0, cnt = 0;
  for (let i = start; i < n; i += 2) {
    const a = moveAccs[i];
    wSum += weights[i]; wAcc += a * weights[i];
    hSum += 1 / Math.max(a, 1); cnt++;
  }
  if (!cnt) return 0;
  return (wAcc / wSum + cnt / hSum) / 2;
}
