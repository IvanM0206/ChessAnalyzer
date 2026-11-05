import { Chess, type Square } from 'chess.js';
import type { Classification, ClassificationThresholds, Color, PositionEval } from '../types';
import { winPctFor } from './winprob';

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export interface ClassifyInput {
  color: Color;
  fenBefore: string;
  fenAfter: string;
  uci: string;
  evalBefore: PositionEval;
  evalAfter: PositionEval;
  isBook: boolean;
  /** classification of the opponent's previous move, if any */
  prevOpponent?: Classification;
  /** opponent's previous move in UCI, to skip obvious recaptures */
  prevUci?: string;
  prevWasCapture?: boolean;
  thresholds: ClassificationThresholds;
}

export interface ClassifyResult { classification: Classification; winBefore: number; winAfter: number; loss: number }

/** Mover-POV win% of a position after the move; handles terminal positions. */
export function winAfterFor(fenAfter: string, ev: PositionEval, color: Color): number {
  if (!ev.lines.length) {
    const c = new Chess(fenAfter);
    if (c.isCheckmate()) return 100; // side to move is mated => mover won
    return 50;
  }
  return winPctFor(ev.lines[0].score, color);
}

/** True if the mover leaves a piece (value >= 3) en prise after the move. */
export function isSacrifice(fenBefore: string, fenAfter: string, uci: string, color: Color): boolean {
  const after = new Chess(fenAfter);
  const before = new Chess(fenBefore);
  const opp: Color = color === 'w' ? 'b' : 'w';
  const captured = before.get(uci.slice(2, 4) as Square);
  const capturedVal = captured ? VALUE[captured.type] : 0;
  if (after.isCheckmate()) return false;
  const board = after.board();
  for (const row of board) for (const sq of row) {
    if (!sq || sq.color !== color || VALUE[sq.type] < 3) continue;
    const attackers = after.attackers(sq.square, opp);
    if (!attackers.length) continue;
    const minAtt = Math.min(...attackers.map((s) => VALUE[after.get(s)!.type] || 100));
    const defended = after.attackers(sq.square, color).length > 0;
    const val = VALUE[sq.type];
    const hanging = !defended || minAtt < val;
    if (!hanging) continue;
    const netLoss = (defended ? val - minAtt : val) - (sq.square === uci.slice(2, 4) ? capturedVal : 0);
    if (netLoss < 2) continue;
    // Was it already hanging before the move? Then it's not a fresh sacrifice
    // unless it is the piece that just moved.
    if (sq.square !== uci.slice(2, 4)) {
      const prevAtt = before.attackers(sq.square, opp);
      if (prevAtt.length && before.get(sq.square)?.type === sq.type) continue;
    }
    return true;
  }
  return false;
}

export function classifyMove(i: ClassifyInput): ClassifyResult {
  const t = i.thresholds;
  const best = i.evalBefore.lines[0];
  const winBefore = best ? winPctFor(best.score, i.color) : 50;
  const winAfter = winAfterFor(i.fenAfter, i.evalAfter, i.color);
  const loss = Math.max(0, winBefore - winAfter) / 100;
  const isBest = best?.uci === i.uci || loss <= 0.002;
  const res = (classification: Classification): ClassifyResult => ({ classification, winBefore, winAfter, loss });

  if (new Chess(i.fenBefore).moves().length === 1) return res('forced');
  if (i.isBook && loss <= t.good) return res('book');

  let base: Classification;
  if (isBest) base = 'best';
  else if (loss <= t.excellent) base = 'excellent';
  else if (loss <= t.good) base = 'good';
  else if (loss <= t.inaccuracy) base = 'inaccuracy';
  else if (loss <= t.mistake) base = 'mistake';
  else base = 'blunder';

  if (base === 'best' || base === 'excellent') {
    // Brilliant: a sound piece sacrifice, not in an already trivially won/lost position.
    if (winAfter >= 50 && winBefore < 97 && isSacrifice(i.fenBefore, i.fenAfter, i.uci, i.color)) return res('brilliant');
    // Great: the only good move (second-best line is clearly worse), or punishing an opponent error.
    const second = i.evalBefore.lines[1];
    const recapture = !!i.prevWasCapture && i.prevUci?.slice(2, 4) === i.uci.slice(2, 4);
    if (base === 'best' && second && winBefore < 97 && !recapture) {
      const gap = (winBefore - winPctFor(second.score, i.color)) / 100;
      if (gap >= t.greatGap) return res('great');
    }
    if (base === 'best' && !recapture && (i.prevOpponent === 'blunder' || i.prevOpponent === 'mistake') && winAfter - (100 - winBefore) > 0 && winBefore >= 60 && winBefore < 97) {
      return res('great');
    }
  }

  // Miss: failed to capitalise on the opponent's error.
  if ((base === 'mistake' || base === 'blunder' || base === 'inaccuracy') &&
      (i.prevOpponent === 'blunder' || i.prevOpponent === 'mistake' || i.prevOpponent === 'miss') &&
      loss > t.inaccuracy * 0.8 && winAfter >= 35) {
    return res('miss');
  }
  return res(base);
}
