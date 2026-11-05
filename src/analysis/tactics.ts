import { Chess, type Square } from 'chess.js';
import type { AnalyzedMove } from '../types';
import { isSacrifice } from './classify';

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const ERRORS = new Set(['inaccuracy', 'mistake', 'miss', 'blunder']);

function playUci(c: Chess, uci?: string) {
  if (!uci) return null;
  try { return c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); } catch { return null; }
}

/** True if the piece on `sq` attacks two or more valuable enemy pieces (king counts). */
function isFork(c: Chess, sq: Square): boolean {
  const piece = c.get(sq);
  if (!piece) return false;
  const enemy = piece.color === 'w' ? 'b' : 'w';
  let hits = 0;
  for (const row of c.board()) for (const t of row) {
    if (!t || t.color !== enemy) continue;
    if (t.type !== 'k' && VALUE[t.type] < 3) continue;
    if (!c.attackers(t.square, piece.color).includes(sq)) continue;
    // A real fork target: the king, a more valuable piece, or an undefended one.
    if (t.type === 'k' || VALUE[t.type] > VALUE[piece.type] || c.attackers(t.square, enemy).length === 0) hits++;
  }
  return hits >= 2;
}

const FILES = 'abcdefgh';
const sqName = (f: number, r: number) => `${FILES[f]}${r + 1}` as Square;
const DIRS: Record<string, [number, number][]> = {
  b: [[1, 1], [1, -1], [-1, 1], [-1, -1]],
  r: [[1, 0], [-1, 0], [0, 1], [0, -1]],
};
DIRS.q = [...DIRS.b, ...DIRS.r];

/** Slider on `sq` pins an enemy piece to a more valuable one (or the king) behind it. */
export function createsPin(c: Chess, sq: Square): boolean {
  const p = c.get(sq);
  if (!p || !DIRS[p.type]) return false;
  const f0 = FILES.indexOf(sq[0]), r0 = Number(sq[1]) - 1;
  for (const [df, dr] of DIRS[p.type]) {
    const seen: { type: string; color: string }[] = [];
    for (let f = f0 + df, r = r0 + dr; f >= 0 && f < 8 && r >= 0 && r < 8; f += df, r += dr) {
      const t = c.get(sqName(f, r));
      if (!t) continue;
      seen.push(t);
      if (seen.length === 2) break;
    }
    const [front, back] = seen;
    if (!front || !back || front.color === p.color || back.color === p.color || front.type === 'k') continue;
    if (back.type === 'k' || VALUE[back.type] > VALUE[front.type]) return VALUE[front.type] >= 3 || back.type === 'k';
  }
  return false;
}

/** The move uncovered an attack by another piece on a valuable enemy piece. */
export function isDiscovered(before: Chess, after: Chess, moved: Square, mover: 'w' | 'b'): boolean {
  for (const row of after.board()) for (const t of row) {
    if (!t || t.color === mover || (t.type !== 'k' && VALUE[t.type] < 5)) continue;
    const now = after.attackers(t.square, mover).filter((a) => a !== moved);
    const prev = new Set(before.attackers(t.square, mover));
    if (now.some((a) => !prev.has(a))) return true;
  }
  return false;
}

/** Short human explanations for an error (Spanish UI strings). */
export function explainMove(m: AnalyzedMove): string[] {
  if (!ERRORS.has(m.classification)) return [];
  const out: string[] = [];
  const reply = m.evalAfter.lines[0];
  const best = m.evalBefore.lines[0];
  const sign = m.color === 'w' ? 1 : -1;

  if (reply?.score.mate !== undefined && reply.score.mate * sign < 0) out.push(`Permite mate en ${Math.abs(reply.score.mate)}`);
  if (best?.score.mate !== undefined && best.score.mate * sign > 0 && !(m.evalAfter.lines[0]?.score.mate)) out.push(`Había mate en ${best.score.mate * sign}`);
  if (isSacrifice(m.fenBefore, m.fenAfter, m.uci, m.color)) out.push('Deja una pieza colgada');

  // Opponent's refutation: fork / winning capture.
  const after = new Chess(m.fenAfter);
  const afterSnapshot = new Chess(m.fenAfter);
  const r = playUci(after, reply?.uci);
  if (r) {
    if (isFork(after, r.to as Square)) out.push('Permite una horquilla');
    else if (isDiscovered(afterSnapshot, after, r.to as Square, r.color)) out.push('Permite un ataque descubierto');
    else if (createsPin(after, r.to as Square)) out.push('Permite una clavada');
    else if (r.captured && VALUE[r.captured] >= 3) out.push('Permite ganar material');
  }
  // What the best move would have done.
  const before = new Chess(m.fenBefore);
  const b = playUci(before, best?.uci);
  if (b && best?.uci !== m.uci) {
    if (isFork(before, b.to as Square)) out.push(`Te perdiste una horquilla con ${b.san}`);
    else if (isDiscovered(new Chess(m.fenBefore), before, b.to as Square, b.color)) out.push(`Te perdiste un ataque descubierto con ${b.san}`);
    else if (createsPin(before, b.to as Square)) out.push(`Te perdiste una clavada con ${b.san}`);
    else if (b.captured && VALUE[b.captured] >= 3 && m.classification !== 'inaccuracy') out.push(`Te perdiste ganar material con ${b.san}`);
  }
  return [...new Set(out)].slice(0, 3);
}
