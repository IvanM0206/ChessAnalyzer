import { useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSettings } from '../db/db';
import { DEFAULT_SETTINGS, type Classification } from '../types';
import { ClassIcon } from './ClassIcon';
import { getPieces } from './pieceSets';

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
  const pieceSet = useLiveQuery(() => getSettings().then((x) => x.pieceSet), [], DEFAULT_SETTINGS.pieceSet);
  // Selection is tied to the position it was made in, so it resets automatically when the FEN changes.
  const [sel, setSel] = useState<{ fen: string; sq: string } | null>(null);
  const selected = sel && sel.fen === fen ? sel.sq : null;
  const setSelected = (sq: string | null) => setSel(sq ? { fen, sq } : null);
  // Legal destination squares for the selected piece (empty when the board is read-only).
  const targets = useMemo(() => {
    if (!selected || !onDrop) return new Map<string, boolean>();
    try {
      return new Map(new Chess(fen).moves({ square: selected as never, verbose: true }).map((m) => [m.to, m.isCapture()]));
    } catch { return new Map<string, boolean>(); }
  }, [selected, fen, onDrop]);
  const tryMove = (from: string, to: string) => {
    setSelected(null);
    return onDrop ? onDrop(from, to) : false;
  };
  const hl = lastMove?.classification ? `color-mix(in srgb, var(--c-${lastMove.classification}) 55%, transparent)` : 'rgba(255, 214, 80, .45)';
  return (
    <Chessboard
      options={{
        position: fen,
        boardOrientation: orientation,
        animationDurationInMs: 220,
        pieces: getPieces(pieceSet),
        allowDragging: !!onDrop,
        onPieceDrag: onDrop ? ({ square }) => setSelected(square) : undefined,
        onPieceDragCancel: () => setSelected(null),
        onSquareClick: onDrop
          ? ({ piece, square }) => {
              if (selected && targets.has(square)) { tryMove(selected, square); return; }
              setSelected(piece && square !== selected ? square : null);
            }
          : undefined,
        allowDrawingArrows: true,
        lightSquareStyle: { backgroundColor: t.light },
        darkSquareStyle: { backgroundColor: t.dark },
        lightSquareNotationStyle: { color: t.dark, fontWeight: 700 },
        darkSquareNotationStyle: { color: t.light, fontWeight: 700 },
        boardStyle: { borderRadius: 6, overflow: 'hidden', boxShadow: '0 6px 24px rgba(0,0,0,.35)' },
        arrows: arrows.map((a) => ({ startSquare: a.from, endSquare: a.to, color: a.color })),
        onPieceDrop: onDrop ? ({ sourceSquare, targetSquare }) => (targetSquare ? tryMove(sourceSquare, targetSquare) : false) : undefined,
        squareRenderer: ({ square, children }) => (
          <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            {lastMove && (square === lastMove.from || square === lastMove.to) && (
              <div style={{ position: 'absolute', inset: 0, background: hl, pointerEvents: 'none', transition: 'background 200ms' }} />
            )}
            {square === selected && targets.size > 0 && (
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(255, 235, 59, .5)', pointerEvents: 'none' }} />
            )}
            {children}
            {targets.has(square) && (
              <div
                style={{
                  position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 10,
                  ...(targets.get(square)
                    ? { background: 'radial-gradient(transparent 0%, transparent 79%, rgba(0,0,0,.16) 80%)' }
                    : { background: 'radial-gradient(rgba(0,0,0,.16) 19%, transparent 20%)' }),
                }}
              />
            )}
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
