import { describe, expect, it } from 'vitest';
import { computeKpis, filterGames, isEndgameFen, movePhases, joinGames, openingRows } from './stats';
import type { AnalyzedMove, Game, GameAnalysis } from '../types';

describe('phase heuristic', () => {
  it('detects endgames', () => {
    expect(isEndgameFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toBe(false);
    expect(isEndgameFen('8/5pk1/6p1/8/8/6P1/5PK1/3R4 w - - 0 40')).toBe(true);
    expect(isEndgameFen('r1bq1rk1/pp3ppp/2n5/8/8/2N5/PP3PPP/R1BQ1RK1 w - - 0 20')).toBe(false);
    expect(isEndgameFen('r4rk1/pp3ppp/2n5/8/8/2N5/PP3PPP/R4RK1 w - - 0 20')).toBe(true);
  });
  it('opening for first 20 plies', () => {
    const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const ms = Array.from({ length: 30 }, (_, i) => ({ ply: i + 1, fenBefore: start, classification: 'good' }) as AnalyzedMove);
    const p = movePhases(ms);
    expect(p[19]).toBe('opening'); expect(p[20]).toBe('middlegame');
  });
});

describe('kpis/filters', () => {
  const g = (id: string, result: Game['result'], date: string): Game => ({ id, result, date, userColor: 'w', timeClass: 'blitz', white: 'me', black: 'x', importedAt: 0, openingName: 'Italian Game: Giuoco' }) as Game;
  const an = (id: string, acc: number, blunders: number) => ({ gameId: id, moves: [], white: { accuracy: acc, counts: { blunder: blunders } }, black: { accuracy: 0, counts: {} } }) as unknown as GameAnalysis;
  const items = joinGames([g('a', '1-0', '2026-11-01'), g('b', '0-1', '2025-01-01'), g('c', '1/2-1/2', '2026-10-30')], [an('a', 80, 1), an('b', 60, 3), an('c', 70, 0)]);
  it('computes', () => {
    const k = computeKpis(items);
    expect(k).toMatchObject({ games: 3, wins: 1, draws: 1, losses: 1, avgAccuracy: 70 });
    expect(k.blundersPerGame).toBeCloseTo(4 / 3);
  });
  it('filters by period', () => {
    expect(filterGames(items, { periodDays: 30, timeClass: '', color: '' }, Date.parse('2026-11-05')).length).toBe(2);
  });
  it('groups openings by family', () => {
    expect(openingRows(items, 'w')).toEqual([expect.objectContaining({ name: 'Italian Game', games: 3 })]);
  });
});
