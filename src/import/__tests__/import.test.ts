import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectUserColor, pgnToGame, splitPgn, timeClassFromControl } from '../pgn';
import { fetchChesscomGames } from '../chesscom';
import { fetchLichessGames } from '../lichess';
import sample from './fixtures/sample.pgn?raw';

const games = splitPgn(sample);

afterEach(() => vi.unstubAllGlobals());

describe('splitPgn', () => {
  it('splits three games', () => {
    expect(games).toHaveLength(3);
    expect(games[0]).toContain('Paul Morphy');
    expect(games[2]).toContain('abcd1234');
  });
  it('handles CRLF, BOM and extra blank lines', () => {
    const text = '﻿' + sample.replace(/\n/g, '\r\n').replace(/\r\n\r\n\[Event/g, '\r\n\r\n\r\n\r\n[Event');
    expect(splitPgn(text)).toHaveLength(3);
  });
  it('handles games without a blank line between them', () => {
    expect(splitPgn('[White "a"]\n[Black "b"]\n\n1. e4 e5 *\n[White "c"]\n[Black "d"]\n\n1. d4 d5 *')).toHaveLength(2);
  });
  it('returns [] for empty input', () => {
    expect(splitPgn('  \n ')).toEqual([]);
  });
});

describe('pgnToGame', () => {
  it('parses headers', () => {
    const g = pgnToGame(games[1], 'pgn')!;
    expect(g).not.toBeNull();
    expect(g.white).toBe('magnus_fan');
    expect(g.whiteElo).toBe(1523);
    expect(g.result).toBe('0-1');
    expect(g.date).toBe('2024-03-05');
    expect(g.timeClass).toBe('rapid');
    expect(g.eco).toBe('A45');
    expect(g.url).toBe('https://www.chess.com/game/live/100200300');
  });
  it('unknown date becomes empty string; site url from lichess', () => {
    expect(pgnToGame(games[0], 'pgn')!.date).toBe('');
    expect(pgnToGame(games[2], 'pgn')!.url).toBe('https://lichess.org/abcd1234');
  });
  it('produces stable ids', () => {
    expect(pgnToGame(games[0], 'pgn')!.id).toBe(pgnToGame(games[0], 'pgn')!.id);
    expect(pgnToGame(games[0], 'pgn')!.id).not.toBe(pgnToGame(games[1], 'pgn')!.id);
    expect(pgnToGame(games[0], 'pgn')!.id.startsWith('pgn:')).toBe(true);
  });
  it('returns null for invalid pgn', () => {
    expect(pgnToGame('[White "a"]\n\n1. e4 e5 2. Ke5 *', 'pgn')).toBeNull();
    expect(pgnToGame('garbage', 'pgn')).toBeNull();
  });
  it('detects user color case-insensitively', () => {
    const g = pgnToGame(games[1], 'pgn', { settings: { chesscomUser: 'MAGNUS_FAN' } })!;
    expect(g.userColor).toBe('w');
    expect(detectUserColor({ white: 'a', black: 'B' }, { lichessUser: 'b' })).toBe('b');
    expect(detectUserColor({ white: 'a', black: 'b' }, {})).toBeUndefined();
  });
  it('classifies time controls', () => {
    expect(timeClassFromControl('60')).toBe('bullet');
    expect(timeClassFromControl('180+2')).toBe('blitz');
    expect(timeClassFromControl('600')).toBe('rapid');
    expect(timeClassFromControl('1800')).toBe('classical');
    expect(timeClassFromControl('1/86400')).toBe('daily');
    expect(timeClassFromControl('-')).toBe('daily');
    expect(timeClassFromControl(undefined)).toBe('unknown');
  });
});

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

describe('fetchChesscomGames', () => {
  it('fetches last N months and skips non-chess rules', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      if (url.endsWith('/games/archives'))
        return json({ archives: ['https://api.chess.com/pub/player/x/games/2024/01', 'https://api.chess.com/pub/player/x/games/2024/02'] });
      return json({
        games: [
          { url: 'https://www.chess.com/game/live/111', pgn: games[1], time_class: 'blitz', rules: 'chess' },
          { url: 'https://www.chess.com/game/live/222', pgn: games[1], time_class: 'bullet', rules: 'chess960' },
        ],
      });
    }));
    const progress = vi.fn();
    const res = await fetchChesscomGames('X', { months: 1, onProgress: progress });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('2024/02');
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe('chesscom:111');
    expect(res[0].source).toBe('chesscom');
    expect(res[0].timeClass).toBe('blitz');
    expect(progress).toHaveBeenLastCalledWith({ done: 1, total: 1, games: 1 });
  });
  it('reports user not found', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 404)));
    await expect(fetchChesscomGames('nobody', { months: 1 })).rejects.toThrow(/No encontramos/);
  });
  it('reports network errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fail'); }));
    await expect(fetchChesscomGames('x', { months: 1 })).rejects.toThrow(/conectar/);
  });
});

function ndjsonResponse(lines: string[], chunk = 50) {
  const bytes = new TextEncoder().encode(lines.join('\n'));
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += chunk) c.enqueue(bytes.slice(i, i + chunk));
      c.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe('fetchLichessGames', () => {
  it('parses chunked NDJSON, skips variants', async () => {
    const lines = [
      JSON.stringify({ id: 'abcd1234', pgn: games[2], speed: 'blitz', variant: 'standard', opening: { eco: 'D35', name: 'QGD Exchange' } }),
      JSON.stringify({ id: 'zzzz9999', pgn: games[2], speed: 'blitz', variant: 'atomic' }),
      JSON.stringify({ id: 'corr0001', pgn: games[1], speed: 'correspondence', variant: 'standard' }),
    ];
    const fetchMock = vi.fn(async () => ndjsonResponse(lines));
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetchLichessGames('me', { max: 10 });
    expect(res.map((g) => g.id)).toEqual(['lichess:abcd1234', 'lichess:corr0001']);
    expect(res[0].url).toBe('https://lichess.org/abcd1234');
    expect(res[0].openingName).toBe('QGD Exchange');
    expect(res[1].timeClass).toBe('daily');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('max=10');
    expect((init.headers as Record<string, string>).Accept).toBe('application/x-ndjson');
  });
  it('handles 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    await expect(fetchLichessGames('nobody', { max: 5 })).rejects.toThrow(/No encontramos/);
  });
});
