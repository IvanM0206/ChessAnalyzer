import { Chessboard } from 'react-chessboard';
import type { Classification } from '../types';
import { ClassIcon } from './ClassIcon';

export const BOARD_THEMES = {
  green: { light: '#ebecd0', dark: '#779556' },
  brown: { light: '#f0d9b5', dark: '#b58863' },
  blue: { light: '#dee3e6', dark: '#8ca2ad' },
} as const;

export interface BoardArrow { from: string; to: string; color: string }

interface Props {
  fen: string;
  orientation: 'white' | 'black';
  theme: keyof typeof BOARD_THEMES;
  lastMove?: { from: string; to: string; classification?: Classification };
  arrows?: BoardArrow[];
  onDrop?: (from: string, to: string) => boolean;
}

export function Board({ fen, orientation, theme, lastMove, arrows = [], onDrop }: Props) {
  const t = BOARD_THEMES[theme];
  const hl = lastMove?.classification ? `color-mix(in srgb, var(--c-${lastMove.classification}) 55%, transparent)` : 'rgba(255, 214, 80, .45)';
  return (
    <Chessboard
      options={{
        position: fen,
        boardOrientation: orientation,
        animationDurationInMs: 220,
        allowDragging: !!onDrop,
        allowDrawingArrows: true,
        lightSquareStyle: { backgroundColor: t.light },
        darkSquareStyle: { backgroundColor: t.dark },
        lightSquareNotationStyle: { color: t.dark, fontWeight: 700 },
        darkSquareNotationStyle: { color: t.light, fontWeight: 700 },
        boardStyle: { borderRadius: 6, overflow: 'hidden', boxShadow: '0 6px 24px rgba(0,0,0,.35)' },
        arrows: arrows.map((a) => ({ startSquare: a.from, endSquare: a.to, color: a.color })),
        onPieceDrop: onDrop ? ({ sourceSquare, targetSquare }) => (targetSquare ? onDrop(sourceSquare, targetSquare) : false) : undefined,
        squareRenderer: ({ square, children }) => (
          <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            {lastMove && (square === lastMove.from || square === lastMove.to) && (
              <div style={{ position: 'absolute', inset: 0, background: hl, pointerEvents: 'none', transition: 'background 200ms' }} />
            )}
            {children}
            {lastMove?.classification && square === lastMove.to && (
              <div key={`${fen}-${square}`} style={{ position: 'absolute', top: '-12%', right: '-12%', zIndex: 20, pointerEvents: 'none' }}>
                <ClassIcon c={lastMove.classification} size={26} pop />
              </div>
            )}
          </div>
        ),
      }}
    />
  );
}
