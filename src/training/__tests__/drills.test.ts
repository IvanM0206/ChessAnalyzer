import { describe, expect, it } from 'vitest';
import { gradeDrill, isAcceptable, selectNewDrills } from '../drills';
import type { AnalyzedMove, Drill, Game, GameAnalysis } from '../../types';

const base: Drill = {
  id: 'g:3', gameId: 'g', ply: 3, fen: 'x', color: 'w', bestUci: 'e2e4', bestSan: 'e4', playedSan: 'a3',
  classification: 'mistake', createdAt: 0, due: 0, interval: 0, ease: 2.5, reps: 0, lapses: 0,
};

describe('gradeDrill', () => {
  it('progresses 1 -> 3 -> ease-scaled days', () => {
    const a = gradeDrill(base, true, 0);
    expect(a.interval).toBe(1); expect(a.due).toBe(86_400_000);
    const b = gradeDrill(a, true, 0);
    expect(b.interval).toBe(3); expect(b.ease).toBeCloseTo(2.7);
    const c = gradeDrill(b, true, 0);
    expect(c.interval).toBe(Math.round(3 * 2.7));
  });
  it('caps ease at 3', () => {
    expect(gradeDrill({ ...base, ease: 2.95 }, true).ease).toBe(3);
  });
  it('fail resets and is due in 10 minutes', () => {
    const f = gradeDrill({ ...base, reps: 4, interval: 9, ease: 1.4 }, false, 1000);
    expect(f).toMatchObject({ reps: 0, interval: 0, lapses: 1, due: 1000 + 600_000, lastResult: 'fail' });
    expect(f.ease).toBe(1.3);
  });
});

const mv = (ply: number, color: 'w' | 'b', classification: AnalyzedMove['classification'], lines: { uci: string; cp: number }[] = []): AnalyzedMove => ({
  ply, san: 's' + ply, uci: 'a1a2', color, fenBefore: 'f' + ply, fenAfter: '', winBefore: 50, winAfter: 50,
  evalBefore: { fen: '', depth: 1, lines: lines.map((l) => ({ uci: l.uci, san: l.uci, score: { cp: l.cp }, pv: [] })) },
  evalAfter: { fen: '', depth: 1, lines: [] }, classification, bestUci: 'e2e4', bestSan: 'e4', accuracy: 50,
});
const analysis = (gameId: string, moves: AnalyzedMove[]) => ({ gameId, moves } as GameAnalysis);

describe('selectNewDrills', () => {
  const games = [{ id: 'a', userColor: 'w' }, { id: 'b' }] as Game[];
  const an = [
    analysis('a', [mv(1, 'w', 'blunder'), mv(2, 'b', 'blunder'), mv(3, 'w', 'good'), mv(5, 'w', 'miss'), mv(7, 'w', 'inaccuracy')]),
    analysis('b', [mv(1, 'w', 'blunder')]),
  ];
  it('only my mistake/blunder/miss moves, skipping games without color', () => {
    const d = selectNewDrills(games, an, new Set());
    expect(d.map((x) => x.id)).toEqual(['a:1', 'a:5']);
    expect(d[0]).toMatchObject({ fen: 'f1', reps: 0, ease: 2.5, interval: 0 });
  });
  it('skips existing', () => {
    expect(selectNewDrills(games, an, new Set(['a:1'])).map((x) => x.id)).toEqual(['a:5']);
  });
});

describe('isAcceptable', () => {
  const a = analysis('g', [mv(3, 'w', 'mistake', [{ uci: 'e2e4', cp: 50 }, { uci: 'd2d4', cp: 40 }, { uci: 'h2h4', cp: -200 }])]);
  it('accepts best and near-equal alternatives only', () => {
    expect(isAcceptable(base, 'e2e4', a)).toBe(true);
    expect(isAcceptable(base, 'd2d4', a)).toBe(true);
    expect(isAcceptable(base, 'h2h4', a)).toBe(false);
    expect(isAcceptable(base, 'a2a3')).toBe(false);
  });
});
