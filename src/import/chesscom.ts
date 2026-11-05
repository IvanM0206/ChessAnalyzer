import type { Game } from '../types';
import { pgnToGame, type GameExtra } from './pgn';
import type { TimeClass } from '../types';

export interface ImportProgress { done: number; total: number; games: number }
export interface ChesscomOptions {
  months: number;
  onProgress?: (p: ImportProgress) => void;
  signal?: AbortSignal;
}

interface ChesscomGame { url?: string; pgn?: string; time_class?: string; rules?: string; end_time?: number }

const BASE = 'https://api.chess.com/pub/player';
const TC: Record<string, TimeClass> = { bullet: 'bullet', blitz: 'blitz', rapid: 'rapid', daily: 'daily' };

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new Error('No se pudo conectar con Chess.com. Revisá tu conexión e intentá de nuevo.');
  }
  if (res.status === 404) throw new Error('NOT_FOUND');
  if (res.status === 429) throw new Error('Chess.com está limitando las solicitudes. Esperá un momento e intentá de nuevo.');
  if (!res.ok) throw new Error(`Chess.com respondió con un error (${res.status}).`);
  try {
    return (await res.json()) as T;
  } catch {
    throw new Error('Chess.com devolvió una respuesta inválida.');
  }
}

export function mapChesscomGame(g: ChesscomGame, extra: GameExtra = {}): Game | null {
  if (!g.pgn || (g.rules && g.rules !== 'chess')) return null;
  const externalId = g.url ? g.url.split('/').filter(Boolean).pop() : undefined;
  const tc = g.time_class ? TC[g.time_class] : undefined;
  const game = pgnToGame(g.pgn, 'chesscom', {
    externalId,
    url: g.url,
    ...(tc ? { timeClass: tc } : {}),
    ...extra,
  });
  return game;
}

export async function fetchChesscomGames(user: string, opts: ChesscomOptions): Promise<Game[]> {
  const name = user.trim().toLowerCase();
  if (!name) throw new Error('Ingresá un usuario de Chess.com.');
  let archives: string[];
  try {
    const data = await getJson<{ archives?: string[] }>(`${BASE}/${encodeURIComponent(name)}/games/archives`, opts.signal);
    archives = data.archives ?? [];
  } catch (e) {
    if ((e as Error).message === 'NOT_FOUND') throw new Error(`No encontramos al usuario "${user.trim()}" en Chess.com.`);
    throw e;
  }
  const picked = archives.slice(-Math.max(1, opts.months)).reverse(); // newest first
  const out: Game[] = [];
  opts.onProgress?.({ done: 0, total: picked.length, games: 0 });
  for (let i = 0; i < picked.length; i++) {
    try {
      const data = await getJson<{ games?: ChesscomGame[] }>(picked[i], opts.signal);
      for (const g of data.games ?? []) {
        const game = mapChesscomGame(g);
        if (game) out.push(game);
      }
    } catch (e) {
      if ((e as Error).message === 'NOT_FOUND') {
        // archive vanished; skip it
      } else throw e;
    }
    opts.onProgress?.({ done: i + 1, total: picked.length, games: out.length });
  }
  return out;
}
