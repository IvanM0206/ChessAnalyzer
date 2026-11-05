import { Area, AreaChart, ReferenceLine, ResponsiveContainer, YAxis, XAxis, Tooltip } from 'recharts';
import type { AnalyzedMove } from '../types';
import { winPctWhite } from '../analysis/winprob';
import { formatScore } from '../lib/format';
import './EvalGraph.css';

const MARKED = new Set(['brilliant', 'great', 'blunder', 'mistake', 'miss']);

export function EvalGraph({ moves, ply, onSelect }: { moves: AnalyzedMove[]; ply: number; onSelect: (ply: number) => void }) {
  const data = [
    { ply: 0, w: moves[0]?.evalBefore.lines[0] ? winPctWhite(moves[0].evalBefore.lines[0].score) : 50, m: undefined as AnalyzedMove | undefined },
    ...moves.map((m) => ({ ply: m.ply, w: m.color === 'w' ? m.winAfter : 100 - m.winAfter, m })),
  ];
  return (
    <div className="evalgraph">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}
          onClick={(e) => { const i = Number(e?.activeTooltipIndex); if (!Number.isNaN(i)) onSelect(i); }}>
          <XAxis dataKey="ply" hide type="number" domain={[0, Math.max(1, moves.length)]} />
          <YAxis hide domain={[0, 100]} />
          <ReferenceLine y={50} stroke="rgba(255,255,255,.18)" />
          <Tooltip cursor={{ stroke: 'rgba(255,255,255,.4)' }} isAnimationActive={false}
            content={({ active, payload }) => {
              const d = payload?.[0]?.payload as (typeof data)[number] | undefined;
              if (!active || !d?.m) return null;
              return <div className="evalgraph-tip">{Math.ceil(d.ply / 2)}{d.m.color === 'w' ? '.' : '...'} {d.m.san} <b>{formatScore(d.m.evalAfter.lines[0]?.score)}</b></div>;
            }} />
          <Area type="monotone" dataKey="w" stroke="#d8d6d0" strokeWidth={1} fill="#f1f0ec" fillOpacity={0.92} baseValue={0}
            isAnimationActive animationDuration={700}
            dot={(p: { cx?: number; cy?: number; payload?: (typeof data)[number]; index?: number }) => {
              const c = p.payload?.m?.classification;
              if (!c || !MARKED.has(c) || p.cx == null || p.cy == null) return <g key={p.index} />;
              return <circle key={p.index} cx={p.cx} cy={p.cy} r={3.6} fill={`var(--c-${c})`} stroke="#1b1a17" strokeWidth={1} />;
            }} />
          <ReferenceLine x={ply} stroke="var(--accent)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
