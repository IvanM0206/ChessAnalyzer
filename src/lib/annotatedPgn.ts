import { Chess } from 'chess.js';
import type { Classification, Game, GameAnalysis, Score } from '../types';
import { CLASS_META } from '../components/ClassIcon';

const NAG: Partial<Record<Classification, string>> = { brilliant: '$3', great: '$1', inaccuracy: '$6', mistake: '$2', miss: '$2', blunder: '$4' };

const evalTag = (s?: Score) => (!s ? '' : s.mate !== undefined ? `#${s.mate}` : ((s.cp ?? 0) / 100).toFixed(2));

/** PGN with original headers, [%eval] per move, NAGs and best-move comments for errors. */
export function buildAnnotatedPgn(game: Game, a: GameAnalysis): string {
  const c = new Chess();
  c.loadPgn(game.pgn);
  const headers = c.getHeaders();
  headers.Annotator = 'Chess Analyzer';
  headers.WhiteAccuracy = a.white.accuracy.toFixed(1);
  headers.BlackAccuracy = a.black.accuracy.toFixed(1);
  const head = Object.entries(headers).map(([k, v]) => `[${k} "${String(v).replace(/"/g, "'")}"]`).join('\n');
  const parts: string[] = [];
  for (const m of a.moves) {
    if (m.color === 'w') parts.push(`${Math.ceil(m.ply / 2)}.`);
    else if (m.ply === 1 || parts.at(-1)?.endsWith('}')) parts.push(`${Math.ceil(m.ply / 2)}...`);
    parts.push(m.san + (NAG[m.classification] ? ` ${NAG[m.classification]}` : ''));
    const notes: string[] = [];
    const ev = evalTag(m.evalAfter.lines[0]?.score);
    if (ev) notes.push(`[%eval ${ev}]`);
    if (NAG[m.classification]) {
      notes.push(CLASS_META[m.classification].label + (m.bestSan && m.bestSan !== m.san ? `. Mejor era ${m.bestSan}` : ''));
    }
    if (m.repertoire === 'deviated') notes.push('Fuera de tu repertorio');
    if (notes.length) parts.push(`{ ${notes.join(' ')} }`);
  }
  parts.push(game.result);
  return `${head}\n\n${parts.join(' ')}\n`;
}

export function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/x-chess-pgn' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
