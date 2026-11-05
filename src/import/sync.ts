import { db, getSettings } from '../db/db';
import type { Source } from '../types';
import { fetchChesscomGames } from './chesscom';
import { fetchLichessGames } from './lichess';
import { saveGames } from './pgn';

async function newestDate(source: Source): Promise<number | null> {
  const games = await db.games.where('source').equals(source).toArray();
  const ts = games.map((g) => Date.parse(g.date)).filter((n) => !Number.isNaN(n));
  return ts.length ? Math.max(...ts) : null;
}

/** Fetches games newer than the latest imported one for the configured usernames. */
export async function syncNewGames(onStatus?: (s: string) => void): Promise<{ added: number; sources: string[] }> {
  const s = await getSettings();
  let added = 0;
  const sources: string[] = [];
  if (s.chesscomUser) {
    onStatus?.('Buscando en Chess.com…');
    const last = await newestDate('chesscom');
    const months = last ? Math.min(12, Math.max(1, Math.ceil((Date.now() - last) / (30 * 864e5)) + 1)) : 3;
    const r = await saveGames(await fetchChesscomGames(s.chesscomUser, { months }));
    added += r.added; sources.push('Chess.com');
  }
  if (s.lichessUser) {
    onStatus?.('Buscando en Lichess…');
    const last = await newestDate('lichess');
    const r = await saveGames(await fetchLichessGames(s.lichessUser, { max: last ? 300 : 100, since: last ?? undefined }));
    added += r.added; sources.push('Lichess');
  }
  return { added, sources };
}
