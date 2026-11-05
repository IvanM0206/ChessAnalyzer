import { useEffect, useRef } from 'react';
import type { AnalyzedMove } from '../types';
import { ClassIcon } from './ClassIcon';
import './MoveList.css';

const SHOW_ICON = new Set(['brilliant', 'great', 'best', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder']);

export function MoveList({ moves, ply, onSelect, offset = 0, startNumber = 1 }: { offset?: number; startNumber?: number; moves: { san: string; classification?: AnalyzedMove['classification'] }[]; ply: number; onSelect: (ply: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.querySelector('.mv.active') as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [ply]);
  const rows: number[] = [];
  for (let i = -offset; i < moves.length; i += 2) rows.push(i);
  const cell = (i: number) => {
    const m = i >= 0 ? moves[i] : undefined;
    if (!m) return <span />;
    const c = m.classification;
    return (
      <button className={`mv${ply === i + 1 ? ' active' : ''}`} onClick={() => onSelect(i + 1)}>
        {c && SHOW_ICON.has(c) ? <ClassIcon c={c} size={15} /> : <span className="mv-spacer" />}
        <span style={c && ['inaccuracy', 'mistake', 'miss', 'blunder', 'brilliant', 'great'].includes(c) ? { color: `var(--c-${c})` } : undefined}>{m.san}</span>
      </button>
    );
  };
  return (
    <div className="movelist" ref={ref}>
      {rows.map((i) => (
        <div key={i} className="mv-row">
          <span className="mv-num">{startNumber + (i + offset) / 2}{i < 0 ? '…' : '.'}</span>
          {cell(i)}
          {cell(i + 1)}
        </div>
      ))}
    </div>
  );
}
