import { Chess } from 'chess.js';
import { db, getSettings } from '../db/db';
import type { Color, Game, GameResult, Settings, Source, TimeClass } from '../types';

/** Split a (possibly multi-game) PGN file into individual game strings. */
export function splitPgn(text: string): string[] {
  const norm = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = norm.split('\n');
  const games: string[] = [];
  let cur: string[] = [];
  let inMoves = false; // true once we've seen movetext after headers

  const flush = () => {
    const s = cur.join('\n').trim();
    if (s) games.push(s);
    cur = [];
    inMoves = false;
  };

  for (const line of lines) {
    const t = line.trim();
    const isHeader = /^\[\s*\w+\s+".*"\s*\]$/.test(t);
    if (isHeader) {
      if (inMoves) flush(); // header after movetext => new game
      cur.push(line);
    } else if (t === '') {
      cur.push(line);
    } else {
      inMoves = true;
      cur.push(line);
    }
  }
  flush();
  // Drop chunks that have neither headers nor moves-looking text
  return games.filter((g) => /\[\s*\w+\s+"/.test(g) || /\b1\.\s*\S/.test(g));
}

/** Fast, stable 53-bit string hash (cyrb53). */
export function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function timeClassFromControl(tc?: string): TimeClass {
  if (!tc) return 'unknown';
  const t = tc.trim();
  if (t === '' || t === '?') return 'unknown';
  if (t === '-' || t.startsWith('1/')) return 'daily';
  const m = /^(\d+)(?:\+(\d+))?$/.exec(t);
  if (!m) return 'unknown';
  const total = Number(m[1]) + 40 * Number(m[2] ?? 0);
  if (total < 180) return 'bullet';
  if (total < 480) return 'blitz';
  if (total < 1500) return 'rapid';
  return 'classical';
}

function normalizeDate(raw?: string): string {
  if (!raw || raw.includes('?')) return '';
  const m = /^(\d{4})[.-](\d{2})[.-](\d{2})$/.exec(raw.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

function num(v?: string): number | undefined {
  if (!v) return undefined;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function detectUserColor(
  game: Pick<Game, 'white' | 'black'>,
  settings: Pick<Settings, 'chesscomUser' | 'lichessUser'>,
): Color | undefined {
  const names = [settings.chesscomUser, settings.lichessUser]
    .map((n) => n?.trim().toLowerCase())
    .filter((n): n is string => !!n);
  if (!names.length) return undefined;
  const w = game.white.trim().toLowerCase();
  const b = game.black.trim().toLowerCase();
  const isW = names.includes(w);
  const isB = names.includes(b);
  if (isW && !isB) return 'w';
  if (isB && !isW) return 'b';
  return undefined;
}

export type GameExtra = Partial<Game> & {
  /** If provided, userColor is computed from these usernames. */
  settings?: Pick<Settings, 'chesscomUser' | 'lichessUser'>;
};

/** Parse + validate a single PGN into a Game. Returns null when invalid. */
export function pgnToGame(pgn: string, source: Source, extra: GameExtra = {}): Game | null {
  const text = pgn.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  if (!text) return null;
  const chess = new Chess();
  try {
    chess.loadPgn(text);
  } catch {
    return null;
  }
  const h = chess.getHeaders() as Record<string, string | undefined>;
  if (chess.history().length === 0) return null;

  const clean = (v?: string) => (v && v !== '?' && v !== '-' ? v : undefined);
  const white = clean(h.White) ?? 'Blancas';
  const black = clean(h.Black) ?? 'Negras';
  const resRaw = h.Result ?? '*';
  const result: GameResult = (['1-0', '0-1', '1/2-1/2', '*'] as const).includes(resRaw as GameResult)
    ? (resRaw as GameResult)
    : '*';
  const date = normalizeDate(clean(h.Date)) || normalizeDate(clean(h.UTCDate));
  const timeControl = clean(h.TimeControl);
  const site = h.Link ?? h.Site;
  const url = site && /^https?:\/\//.test(site) ? site : undefined;

  const { settings, ...over } = extra;
  const movetext = chess.history().join(' ');
  const id =
    over.id ??
    `${source}:${over.externalId ?? cyrb53(`${movetext}|${white}|${black}|${date}`)}`;

  const game: Game = {
    id,
    source,
    pgn: text,
    white,
    black,
    whiteElo: num(h.WhiteElo),
    blackElo: num(h.BlackElo),
    result,
    date,
    timeControl,
    timeClass: timeClassFromControl(timeControl),
    eco: clean(h.ECO),
    openingName: clean(h.Opening),
    termination: clean(h.Termination),
    url,
    importedAt: Date.now(),
    analyzed: false,
    ...over,
  };
  game.id = id;
  if (game.userColor === undefined && settings) game.userColor = detectUserColor(game, settings);
  return game;
}

/** Bulk-add games, skipping ids that already exist. */
export async function saveGames(games: Game[]): Promise<{ added: number; skipped: number }> {
  if (!games.length) return { added: 0, skipped: 0 };
  const settings = await getSettings();
  // de-dupe within the batch
  const unique = new Map<string, Game>();
  for (const g of games) if (!unique.has(g.id)) unique.set(g.id, g);
  const list = [...unique.values()];
  const existing = new Set(
    (await db.games.bulkGet(list.map((g) => g.id))).filter(Boolean).map((g) => g!.id),
  );
  const fresh = list
    .filter((g) => !existing.has(g.id))
    .map((g) => (g.userColor === undefined ? { ...g, userColor: detectUserColor(g, settings) } : g));
  if (fresh.length) await db.games.bulkAdd(fresh);
  return { added: fresh.length, skipped: games.length - fresh.length };
}
