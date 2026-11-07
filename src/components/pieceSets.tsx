import type { PieceRenderObject } from 'react-chessboard';
import type { PieceSet } from '../types';

// Open-license SVG sets (Lichess), bundled by Vite as URLs.
const files = import.meta.glob('../assets/pieces/*/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export const PIECE_SETS: { id: PieceSet; label: string }[] = [
  { id: 'cburnett', label: 'Clásico' },
  { id: 'merida', label: 'Merida' },
  { id: 'california', label: 'California' },
];

const CODES = ['wP', 'wN', 'wB', 'wR', 'wQ', 'wK', 'bP', 'bN', 'bB', 'bR', 'bQ', 'bK'] as const;

export function pieceUrl(set: PieceSet, code: string): string {
  return files[`../assets/pieces/${set}/${code}.svg`] ?? '';
}

const cache = new Map<PieceSet, PieceRenderObject>();

export function getPieces(set: PieceSet): PieceRenderObject {
  let p = cache.get(set);
  if (!p) {
    p = Object.fromEntries(
      CODES.map((code) => [
        code,
        (props) => (
          <img
            src={pieceUrl(set, code)}
            alt=""
            draggable={false}
            style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none', ...props?.svgStyle }}
          />
        ),
      ]),
    ) as PieceRenderObject;
    cache.set(set, p);
  }
  return p;
}
