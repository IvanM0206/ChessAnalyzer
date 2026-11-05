import type { Score } from '../types';
import { winPctWhite } from '../analysis/winprob';
import { formatScore } from '../lib/format';
import './EvalBar.css';

export function EvalBar({ score, flipped }: { score?: Score; flipped: boolean }) {
  const w = score ? winPctWhite(score) : 50;
  const whiteAhead = w >= 50;
  const label = formatScore(score).replace('+', '');
  return (
    <div className={`evalbar${flipped ? ' flipped' : ''}`}>
      <div className="evalbar-white" style={{ height: `${w}%` }} />
      <span className={`evalbar-label ${whiteAhead ? 'bottom' : 'top'}`}>{label}</span>
    </div>
  );
}
