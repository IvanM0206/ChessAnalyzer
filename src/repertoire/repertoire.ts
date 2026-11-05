import { Chess } from 'chess.js';
import { db } from '../db/db';
import { fenKey } from '../analysis/openings';
import type { Color, RepertoireMove } from '../types';

export const START_FEN = new Chess().fen();
export const START_KEY = fenKey(START_FEN);

export type RepertoireStatus = 'in' | 'deviated' | 'opponent-left' | undefined;

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

export interface LineStep { fenKey: string; uci: string; san: string }

/** Plays SAN moves from `startFen`; stops silently at the first illegal move. */
export function playLine(sans: string[], startFen: string = START_FEN): LineStep[] {
  const chess = new Chess(startFen);
  const out: LineStep[] = [];
  for (const s of sans) {
    const key = fenKey(chess.fen());
    try {
      const m = chess.move(s);
      out.push({ fenKey: key, uci: m.from + m.to + (m.promotion ?? ''), san: m.san });
    } catch { break; }
  }
  return out;
}

export interface ParsedLine { sans: string[]; startFen?: string }

/** Tokenizer for PGN movetext: drops comments, NAGs, move numbers and results. */
function tokenizeMovetext(text: string): string[] {
  const clean = text
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/;[^\n]*/g, ' ')
    .replace(/^%[^\n]*/gm, ' ')
    .replace(/\$\d+/g, ' ')
    .replace(/([()])/g, ' $1 ');
  const tokens: string[] = [];
  for (const raw of clean.split(/\s+/)) {
    if (!raw) continue;
    if (raw === '(' || raw === ')') { tokens.push(raw); continue; }
    if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(raw)) continue;
    let t = raw.replace(/^\d+\.+/, '').replace(/[!?]+$/, '');
    if (!t || /^\.+$/.test(t)) continue;
    t = t.replace(/^\.+/, '');
    if (t) tokens.push(t);
  }
  return tokens;
}

/** Recursive RAV parser. Emits every (sub)line as a full sequence of SAN moves from the start. */
function parseMovetext(text: string): string[][] {
  const tokens = tokenizeMovetext(text);
  const lines: string[][] = [];
  let pos = 0;
  const parse = (prefix: string[]): void => {
    const line = [...prefix];
    while (pos < tokens.length) {
      const t = tokens[pos++];
      if (t === ')') break;
      if (t === '(') {
        // A variation replaces the last move of the current line.
        parse(line.slice(0, -1));
        continue;
      }
      line.push(t);
    }
    if (line.length) lines.push(line);
  };
  parse([]);
  return lines;
}

/** Splits PGN text into games and returns every line (main lines and variations). */
export function parsePgnLines(pgn: string): ParsedLine[] {
  const games: { fen?: string; move: string[] }[] = [];
  let cur: { fen?: string; move: string[] } | null = null;
  for (const rawLine of pgn.replace(/\r/g, '').split('\n')) {
    const tag = rawLine.match(/^\s*\[(\w+)\s+"(.*)"\]\s*$/);
    if (tag) {
      if (!cur || cur.move.length) { cur = { move: [] }; games.push(cur); }
      if (tag[1] === 'FEN') cur.fen = tag[2];
    } else {
      if (!cur) { cur = { move: [] }; games.push(cur); }
      cur.move.push(rawLine);
    }
  }
  const out: ParsedLine[] = [];
  for (const g of games) {
    for (const sans of parseMovetext(g.move.join('\n'))) out.push({ sans, startFen: g.fen });
  }
  return out;
}

/** Position -> set of repertoire UCI moves, for one side. */
export type RepLookup = Map<string, Set<string>>;

export function buildLookup(edges: RepertoireMove[]): RepLookup {
  const m: RepLookup = new Map();
  for (const e of edges) {
    let s = m.get(e.fenKey);
    if (!s) m.set(e.fenKey, (s = new Set()));
    s.add(e.uci);
  }
  return m;
}

/** Pure walker behind checkGameAgainstRepertoire. */
export function walkRepertoire(
  moves: { uci: string; color: Color; fenBefore: string }[],
  userColor: Color,
  lookup: RepLookup,
): RepertoireStatus[] {
  const out: RepertoireStatus[] = moves.map(() => undefined);
  for (let i = 0; i < moves.length; i++) {
    const entries = lookup.get(fenKey(moves[i].fenBefore));
    if (!entries || !entries.size) break;
    if (entries.has(moves[i].uci)) { out[i] = 'in'; continue; }
    out[i] = moves[i].color === userColor ? 'deviated' : 'opponent-left';
    break;
  }
  return out;
}

/** Tree view of a side's edges: children by position, and the position reached by each edge. */
export interface RepTree {
  children: Map<string, RepertoireMove[]>;
  next: (e: RepertoireMove) => string | null;
}

export function buildTree(edges: RepertoireMove[]): RepTree {
  const children = new Map<string, RepertoireMove[]>();
  for (const e of edges) {
    const arr = children.get(e.fenKey);
    if (arr) arr.push(e); else children.set(e.fenKey, [e]);
  }
  const cache = new Map<string, string | null>();
  const next = (e: RepertoireMove) => {
    if (cache.has(e.id)) return cache.get(e.id)!;
    let res: string | null = null;
    try {
      const c = new Chess(`${e.fenKey} 0 1`);
      c.move({ from: e.uci.slice(0, 2), to: e.uci.slice(2, 4), promotion: e.uci[4] });
      res = fenKey(c.fen());
    } catch { res = null; }
    cache.set(e.id, res);
    return res;
  };
  return { children, next };
}

function reach(tree: RepTree, roots: string[], skipId?: string): Set<string> {
  const seen = new Set<string>();
  const stack = [...roots];
  while (stack.length) {
    const k = stack.pop()!;
    if (seen.has(k)) continue;
    seen.add(k);
    for (const e of tree.children.get(k) ?? []) {
      if (e.id === skipId) continue;
      const n = tree.next(e);
      if (n) stack.push(n);
    }
  }
  return seen;
}

/** Ids to delete when removing `uci` at `fen`: that edge plus every edge reachable only through it. */
export function computeSubtreeDeletion(edges: RepertoireMove[], fen: string, uci: string): string[] {
  const key = fenKey(fen);
  const target = edges.find((e) => e.fenKey === key && e.uci === uci);
  if (!target) return [];
  const tree = buildTree(edges);
  const roots = [START_KEY];
  if (!reach(tree, roots).has(key)) roots.push(key); // line started from a custom position
  const before = reach(tree, roots);
  const after = reach(tree, roots, target.id);
  const ids = new Set<string>([target.id]);
  for (const e of edges) if (before.has(e.fenKey) && !after.has(e.fenKey)) ids.add(e.id);
  return [...ids];
}

/** Number of leaf lines reachable after the edge `e` (1 for a dead end). */
export function countSublines(tree: RepTree, e: RepertoireMove): number {
  const walk = (key: string | null, seen: Set<string>): number => {
    if (!key || seen.has(key)) return 1;
    const kids = tree.children.get(key);
    if (!kids?.length) return 1;
    const s = new Set(seen).add(key);
    return kids.reduce((n, k) => n + walk(tree.next(k), s), 0);
  };
  return walk(tree.next(e), new Set([e.fenKey]));
}

/** PGN with variations from a side's edges, starting at the initial position. */
export function edgesToPgn(side: Color, edges: RepertoireMove[]): string {
  const tree = buildTree(edges);
  const num = (fen: string, force: boolean) => {
    const parts = fen.split(' ');
    const n = parts[5] ?? '1';
    return parts[1] === 'w' ? `${n}. ` : force ? `${n}... ` : '';
  };
  const writeFrom = (fen: string, path: Set<string>, forceNum: boolean): string => {
    const key = fenKey(fen);
    const kids = (tree.children.get(key) ?? []).slice().sort((a, b) => a.createdAt - b.createdAt);
    if (!kids.length || path.has(key)) return '';
    const p2 = new Set(path).add(key);
    // Renders one move followed by its continuation; `needNum` forces "N..." for black moves.
    const render = (e: RepertoireMove, needNum: boolean, contNum: boolean): string | null => {
      const c = new Chess(fen);
      let m;
      try { m = c.move({ from: e.uci.slice(0, 2), to: e.uci.slice(2, 4), promotion: e.uci[4] }); } catch { return null; }
      const comment = e.comment ? ` {${e.comment.replace(/[{}]/g, '')}}` : '';
      const rest = writeFrom(c.fen(), p2, contNum || !!comment);
      return `${num(fen, needNum)}${m.san}${comment}${rest ? ' ' + rest : ''}`;
    };
    const [first, ...others] = kids;
    const vars = others.map((o) => render(o, true, false)).filter((v): v is string => !!v);
    const head = render(first, forceNum, vars.length > 0);
    if (!head) return '';
    if (!vars.length) return head;
    // Insert variations right after the first move (before its continuation).
    const c = new Chess(fen);
    const m = c.move({ from: first.uci.slice(0, 2), to: first.uci.slice(2, 4), promotion: first.uci[4] });
    const prefix = `${num(fen, forceNum)}${m.san}${first.comment ? ` {${first.comment.replace(/[{}]/g, '')}}` : ''}`;
    return `${prefix} ${vars.map((v) => `(${v})`).join(' ')}${head.length > prefix.length ? head.slice(prefix.length) : ''}`;
  };
  const body = writeFrom(START_FEN, new Set(), false);
  const sideName = side === 'w' ? 'Blancas' : 'Negras';
  return `[Event "Repertorio ${sideName}"]\n[Site "Chess Analyzer"]\n[Result "*"]\n\n${body} *\n`;
}

/* ------------------------------------------------------------------ */
/* DB-backed API                                                       */
/* ------------------------------------------------------------------ */

async function upsert(side: Color, steps: LineStep[]): Promise<number> {
  if (!steps.length) return 0;
  const rows = new Map<string, RepertoireMove>();
  for (const s of steps) {
    const id = `${side}|${s.fenKey}|${s.uci}`;
    rows.set(id, { id, side, fenKey: s.fenKey, uci: s.uci, san: s.san, createdAt: Date.now() });
  }
  const ids = [...rows.keys()];
  const existing = await db.repertoire.bulkGet(ids);
  existing.forEach((old, i) => {
    if (old) rows.set(ids[i], { ...rows.get(ids[i])!, comment: old.comment, createdAt: old.createdAt });
  });
  await db.repertoire.bulkPut([...rows.values()]);
  return rows.size;
}

/** Adds every move of the line (mine and the opponent's replies). Returns the number of edges written. */
export async function addLine(side: Color, line: string[] | string, startFen?: string): Promise<number> {
  const sans = Array.isArray(line) ? line : parsePgnLines(line)[0]?.sans ?? [];
  return upsert(side, playLine(sans, startFen ?? START_FEN));
}

/** Adds one move (given as UCI) at a position. Returns false if it is illegal. */
export async function addMoveAt(side: Color, fen: string, uci: string): Promise<RepertoireMove | null> {
  try {
    const c = new Chess(fen);
    const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    const steps = [{ fenKey: fenKey(fen), uci, san: m.san }];
    await upsert(side, steps);
    return (await db.repertoire.get(`${side}|${steps[0].fenKey}|${uci}`)) ?? null;
  } catch { return null; }
}

/** Imports PGN text (multiple games, nested variations). Returns { lines, moves }. */
export async function importRepertoirePgn(side: Color, pgn: string): Promise<{ lines: number; moves: number }> {
  const lines = parsePgnLines(pgn);
  const all = new Map<string, LineStep>();
  let valid = 0;
  for (const l of lines) {
    const steps = playLine(l.sans, l.startFen);
    if (steps.length) valid++;
    for (const s of steps) all.set(`${s.fenKey}|${s.uci}`, s);
  }
  await upsert(side, [...all.values()]);
  return { lines: valid, moves: all.size };
}

export function getMoves(side: Color, key: string): Promise<RepertoireMove[]> {
  return db.repertoire.where('[side+fenKey]').equals([side, key]).toArray();
}

export function getAllMoves(side: Color): Promise<RepertoireMove[]> {
  return db.repertoire.where('side').equals(side).toArray();
}

export async function deleteSubtree(side: Color, fen: string, uci: string): Promise<number> {
  const ids = computeSubtreeDeletion(await getAllMoves(side), fen, uci);
  await db.repertoire.bulkDelete(ids);
  return ids.length;
}

export async function exportRepertoirePgn(side: Color): Promise<string> {
  return edgesToPgn(side, await getAllMoves(side));
}

export async function checkGameAgainstRepertoire(
  moves: { uci: string; color: Color; fenBefore: string }[],
  userColor: Color,
): Promise<RepertoireStatus[]> {
  const lookup = buildLookup(await getAllMoves(userColor));
  return walkRepertoire(moves, userColor, lookup);
}
