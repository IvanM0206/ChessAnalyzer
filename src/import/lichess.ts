import type { Game, TimeClass } from '../types';
import { pgnToGame } from './pgn';

export interface LichessOptions {
  max: number;
  onProgress?: (p: { games: number; total: number }) => void;
  signal?: AbortSignal;
}

interface LichessGame {
  id?: string;
  pgn?: string;
  speed?: string;
  variant?: string;
  opening?: { eco?: string; name?: string };
}

const SPEED: Record<string, TimeClass> = {
  ultraBullet: 'bullet', bullet: 'bullet', blitz: 'blitz', rapid: 'rapid',
  classical: 'classical', correspondence: 'daily',
};

export function mapLichessGame(o: LichessGame): Game | null {
  if (!o.pgn) return null;
  if (o.variant && o.variant !== 'standard') return null;
  const tc = o.speed ? SPEED[o.speed] : undefined;
  return pgnToGame(o.pgn, 'lichess', {
    externalId: o.id,
    url: o.id ? `https://lichess.org/${o.id}` : undefined,
    ...(tc ? { timeClass: tc } : {}),
    ...(o.opening?.eco ? { eco: o.opening.eco } : {}),
    ...(o.opening?.name ? { openingName: o.opening.name } : {}),
  });
}

/** Parse one NDJSON line; returns null for blanks / malformed lines. */
function parseLine(line: string): Game | null {
  const t = line.trim();
  if (!t) return null;
  try {
    return mapLichessGame(JSON.parse(t) as LichessGame);
  } catch {
    return null;
  }
}

export async function fetchLichessGames(user: string, opts: LichessOptions): Promise<Game[]> {
  const name = user.trim();
  if (!name) throw new Error('Ingresá un usuario de Lichess.');
  const url =
    `https://lichess.org/api/games/user/${encodeURIComponent(name)}` +
    `?max=${opts.max}&pgnInJson=true&opening=true&clocks=false`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/x-ndjson' }, signal: opts.signal });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new Error('No se pudo conectar con Lichess. Revisá tu conexión e intentá de nuevo.');
  }
  if (res.status === 404) throw new Error(`No encontramos al usuario "${name}" en Lichess.`);
  if (res.status === 429) throw new Error('Lichess está limitando las solicitudes. Esperá un minuto e intentá de nuevo.');
  if (!res.ok) throw new Error(`Lichess respondió con un error (${res.status}).`);

  const out: Game[] = [];
  const push = (g: Game | null) => {
    if (!g) return;
    out.push(g);
    opts.onProgress?.({ games: out.length, total: opts.max });
  };

  if (!res.body) {
    for (const line of (await res.text()).split('\n')) push(parseLine(line));
    return out;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        push(parseLine(buf.slice(0, nl)));
        buf = buf.slice(nl + 1);
      }
    }
    buf += decoder.decode();
    push(parseLine(buf));
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    if (!out.length) throw new Error('Se interrumpió la descarga desde Lichess.');
  }
  return out;
}
