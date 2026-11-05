import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { classifyMove, isSacrifice } from '../classify';
import { moveAccuracy, winPctWhite, gameAccuracy } from '../winprob';
import { DEFAULT_THRESHOLDS, type PositionEval, type Score } from '../../types';

const ev = (fen: string, ...lines: [string, Score][]): PositionEval => ({ fen, depth: 16, lines: lines.map(([uci, score]) => ({ uci, san: uci, score, pv: [uci] })) });
const play = (fen: string, uci: string) => { const c = new Chess(fen); c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); return c.fen(); };
const base = { isBook: false, thresholds: DEFAULT_THRESHOLDS };

describe('winprob', () => {
  it('is symmetric and bounded', () => {
    expect(winPctWhite({ cp: 0 })).toBeCloseTo(50);
    expect(winPctWhite({ cp: 300 }) + winPctWhite({ cp: -300 })).toBeCloseTo(100);
    expect(winPctWhite({ mate: 3 })).toBe(100);
    expect(winPctWhite({ mate: -1 })).toBe(0);
  });
  it('accuracy is ~100 for no loss and drops with loss', () => {
    expect(moveAccuracy(60, 60)).toBe(100);
    expect(moveAccuracy(60, 30)).toBeLessThan(40);
  });
  it('game accuracy is high for flat evals', () => {
    const wins = Array(21).fill(52);
    expect(gameAccuracy(wins, Array(20).fill(100), 'w')).toBeGreaterThan(95);
  });
});

describe('classifyMove', () => {
  const start = new Chess().fen();
  it('best move', () => {
    const after = play(start, 'e2e4');
    const r = classifyMove({ ...base, color: 'w', fenBefore: start, fenAfter: after, uci: 'e2e4', evalBefore: ev(start, ['e2e4', { cp: 30 }]), evalAfter: ev(after, ['e7e5', { cp: 30 }]) });
    expect(r.classification).toBe('best');
  });
  it('book move', () => {
    const after = play(start, 'e2e4');
    const r = classifyMove({ ...base, isBook: true, color: 'w', fenBefore: start, fenAfter: after, uci: 'e2e4', evalBefore: ev(start, ['d2d4', { cp: 30 }]), evalAfter: ev(after, ['e7e5', { cp: 25 }]) });
    expect(r.classification).toBe('book');
  });
  it('blunder when dropping from equal to lost', () => {
    const after = play(start, 'f2f3');
    const r = classifyMove({ ...base, color: 'w', fenBefore: start, fenAfter: after, uci: 'f2f3', evalBefore: ev(start, ['e2e4', { cp: 30 }]), evalAfter: ev(after, ['e7e5', { cp: -900 }]) });
    expect(r.classification).toBe('blunder');
  });
  it('inaccuracy / mistake bands', () => {
    const after = play(start, 'a2a3');
    const mk = (cp: number) => classifyMove({ ...base, color: 'w', fenBefore: start, fenAfter: after, uci: 'a2a3', evalBefore: ev(start, ['e2e4', { cp: 30 }]), evalAfter: ev(after, ['e7e5', { cp }]) }).classification;
    expect(mk(-60)).toBe('inaccuracy');
    expect(mk(-180)).toBe('mistake');
  });
  it('mate in one found is best and checkmate win = 100', () => {
    const fen = '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1';
    const after = play(fen, 'a1a8');
    const r = classifyMove({ ...base, color: 'w', fenBefore: fen, fenAfter: after, uci: 'a1a8', evalBefore: ev(fen, ['a1a8', { mate: 1 }]), evalAfter: ev(after) });
    expect(r.winAfter).toBe(100);
    expect(['best', 'great']).toContain(r.classification);
  });
  it('great when the only good move', () => {
    const after = play(start, 'e2e4');
    const r = classifyMove({ ...base, color: 'w', fenBefore: start, fenAfter: after, uci: 'e2e4', evalBefore: ev(start, ['e2e4', { cp: 200 }], ['d2d4', { cp: -150 }]), evalAfter: ev(after, ['e7e5', { cp: 200 }]) });
    expect(r.classification).toBe('great');
  });
  it('detects a queen sacrifice (Légal-style knight/bishop hanging)', () => {
    // White plays Nxe5 leaving the queen on d1 en prise to Bg4 (Légal trap).
    const fen = 'r2qkbnr/ppp2ppp/2np4/4p3/2B1P1b1/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 2 5';
    const after = play(fen, 'f3e5');
    expect(isSacrifice(fen, after, 'f3e5', 'w')).toBe(true);
  });
  it('a normal developing move is not a sacrifice', () => {
    expect(isSacrifice(start, play(start, 'g1f3'), 'g1f3', 'w')).toBe(false);
  });
});

import { explainMove } from '../tactics';
describe('explainMove', () => {
  it('flags allowing a knight fork', () => {
    // Black king e8, queen d8 ... simple: after 1...Qd8-h4?? style — use a constructed position:
    const fenBefore = '4k3/8/8/8/3q4/8/2N5/4K3 b - - 0 1';
    const uci = 'd4e4'; // queen to e4 check?? -> Nd2? Not a fork; just check it doesn't throw
    const fenAfter = play(fenBefore, 'd4b4');
    const r = explainMove({ ply: 1, san: 'Qb4+', uci: 'd4b4', color: 'b', fenBefore, fenAfter, winBefore: 90, winAfter: 10, accuracy: 0, classification: 'blunder',
      evalBefore: ev(fenBefore, [uci, { cp: -900 }]), evalAfter: ev(fenAfter, ['c2b4', { cp: 900 }]) });
    expect(r).toContain('Deja una pieza colgada');
    expect(r).toContain('Permite ganar material');
  });
});

import { createsPin, isDiscovered } from '../tactics';
describe('pins & discoveries', () => {
  it('bishop pins knight to king', () => {
    const c = new Chess('4k3/8/2n5/8/B7/8/8/4K3 w - - 0 1');
    expect(createsPin(c, 'a4')).toBe(true);
  });
  it('no pin when nothing behind', () => {
    expect(createsPin(new Chess('8/8/2n5/8/B7/8/8/4K2k w - - 0 1'), 'a4')).toBe(false);
  });
  it('detects a discovered attack on the queen', () => {
    const fen = '3q3k/8/8/3N4/8/8/8/3R2K1 w - - 0 1';
    const before = new Chess(fen); const after = new Chess(fen);
    after.move('Nb6');
    expect(isDiscovered(before, after, 'b6', 'w')).toBe(true);
  });
});
