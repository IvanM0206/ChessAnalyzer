import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { fenKey } from '../../analysis/openings';
import type { RepertoireMove } from '../../types';
import { buildLookup, buildTree, computeSubtreeDeletion, countSublines, edgesToPgn, parsePgnLines, playLine, walkRepertoire } from '../repertoire';

const edgesOf = (lines: string[][], side: 'w' | 'b' = 'w'): RepertoireMove[] => {
  const m = new Map<string, RepertoireMove>();
  let t = 0;
  for (const l of lines) for (const s of playLine(l)) {
    const id = `${side}|${s.fenKey}|${s.uci}`;
    if (!m.has(id)) m.set(id, { id, side, fenKey: s.fenKey, uci: s.uci, san: s.san, createdAt: t++ });
  }
  return [...m.values()];
};

const gameMoves = (sans: string[]) => {
  const c = new Chess();
  return sans.map((s) => { const fenBefore = c.fen(); const m = c.move(s); return { uci: m.from + m.to + (m.promotion ?? ''), color: m.color, fenBefore }; });
};

describe('parsePgnLines', () => {
  it('handles comments, NAGs, numbers, results and nested variations', () => {
    const pgn = '[Event "x"]\n\n1. e4 {best} e5 $1 (1... c5 2. Nf3 (2. c3) d6) 2. Nf3 Nc6?! 1-0\n\n[Event "y"]\n\n1.d4 d5 *';
    const lines = parsePgnLines(pgn).map((l) => l.sans.join(' '));
    expect(lines).toContain('e4 e5 Nf3 Nc6');
    expect(lines).toContain('e4 c5 Nf3 d6');
    expect(lines).toContain('e4 c5 c3');
    expect(lines).toContain('d4 d5');
  });
});

describe('walkRepertoire', () => {
  const edges = edgesOf([['e4', 'e5', 'Nf3', 'Nc6'], ['e4', 'c5']]);
  const lookup = buildLookup(edges);
  it('marks in-book moves then deviation of mine', () => {
    expect(walkRepertoire(gameMoves(['e4', 'e5', 'Bc4']), 'w', lookup)).toEqual(['in', 'in', 'deviated']);
  });
  it('marks opponent leaving', () => {
    expect(walkRepertoire(gameMoves(['e4', 'e6', 'd4']), 'w', lookup)).toEqual(['in', 'opponent-left', undefined]);
  });
  it('stops when position is unknown', () => {
    expect(walkRepertoire(gameMoves(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']), 'w', lookup)).toEqual(['in', 'in', 'in', 'in', undefined, undefined]);
  });
});

describe('subtree helpers', () => {
  const edges = edgesOf([['e4', 'e5', 'Nf3'], ['e4', 'c5', 'Nf3', 'd6'], ['d4', 'd5']]);
  it('deletes only what is reachable after the move', () => {
    const ids = computeSubtreeDeletion(edges, new Chess().fen(), 'e2e4');
    expect(ids).toHaveLength(6);
    expect(ids.every((id) => !id.includes('d2d4'))).toBe(true);
  });
  it('keeps transposed continuation reachable elsewhere', () => {
    const e = edgesOf([['Nf3', 'd5', 'e3'], ['e3', 'd5', 'Nf3']]);
    const afterNf3d5e3 = new Chess(); ['Nf3', 'd5', 'e3'].forEach((s) => afterNf3d5e3.move(s));
    expect(computeSubtreeDeletion(e, new Chess().fen(), 'g1f3')).toHaveLength(3);
    expect(fenKey(afterNf3d5e3.fen())).toBeTruthy();
  });
  it('counts sublines', () => {
    const tree = buildTree(edges);
    const e4 = edges.find((e) => e.uci === 'e2e4')!;
    expect(countSublines(tree, e4)).toBe(2);
  });
});

describe('edgesToPgn', () => {
  it('round-trips through the parser', () => {
    const edges = edgesOf([['e4', 'e5', 'Nf3', 'Nc6'], ['e4', 'c5', 'Nf3'], ['d4', 'd5']]);
    const pgn = edgesToPgn('w', edges);
    const lines = parsePgnLines(pgn).map((l) => l.sans.join(' '));
    expect(lines).toContain('e4 e5 Nf3 Nc6');
    expect(lines).toContain('e4 c5 Nf3');
    expect(lines).toContain('d4 d5');
    expect(pgn).toMatch(/\(/);
  });
});
