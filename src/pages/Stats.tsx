import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { db } from '../db/db';
import { IconLibrary } from '../components/Icons';
import {
  accuracySeries, computeKpis, filterGames, joinGames, openingRows, phaseStats, timeClassRows,
  type OpeningRow, type StatsFilters,
} from '../stats/stats';
import type { Color, TimeClass } from '../types';
import './Stats.css';

const TC_LABEL: Record<TimeClass, string> = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rápida', classical: 'Clásica', daily: 'Diaria', unknown: '—' };
const PHASE_LABEL = { opening: 'Apertura', middlegame: 'Medio juego', endgame: 'Final' } as const;
const PERIODS: { label: string; days: number | null }[] = [
  { label: 'Últimos 30 días', days: 30 }, { label: 'Últimos 90 días', days: 90 }, { label: 'Último año', days: 365 }, { label: 'Todo', days: null },
];
// Series colours come from the theme tokens (see index.css) so charts match the rest of the UI.
const COL = { acc: '#5b8fd9', avg: '#6fae4f', raw: '#75726b', inacc: '#f0c43c', mistake: '#f0913e', blunder: '#e5484d', grid: '#3a3832', surface: '#2b2a26', axis: '#a9a69e' };

const pct = (n: number) => `${Math.round(n)}%`;
const f1 = (n: number) => n.toFixed(1);

function Tip({ active, payload, label, render }: { active?: boolean; payload?: { payload: never }[]; label?: string; render: (p: never, label?: string) => React.ReactNode }) {
  if (!active || !payload?.length) return null;
  return <div className="st-tip">{render(payload[0].payload, label)}</div>;
}

function WdlBar({ w, d, l }: { w: number; d: number; l: number }) {
  const n = w + d + l || 1;
  return (
    <div className="wdl" title={`${w} ganadas · ${d} tablas · ${l} perdidas`} role="img" aria-label={`${w} ganadas, ${d} tablas, ${l} perdidas`}>
      {w > 0 && <i className="w" style={{ flexGrow: w / n }}>{w / n > 0.14 ? w : ''}</i>}
      {d > 0 && <i className="d" style={{ flexGrow: d / n }}>{d / n > 0.14 ? d : ''}</i>}
      {l > 0 && <i className="l" style={{ flexGrow: l / n }}>{l / n > 0.14 ? l : ''}</i>}
    </div>
  );
}

type SortKey = 'games' | 'accuracy' | 'name';
function OpeningTable({ title, color, rows }: { title: string; color: Color; rows: OpeningRow[] }) {
  const [sort, setSort] = useState<SortKey>('games');
  const [limit, setLimit] = useState(8);
  const sorted = useMemo(() => rows.slice().sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : b[sort] - a[sort] || b.games - a.games)), [rows, sort]);
  const th = (k: SortKey, label: string) => <button className={`st-sort${sort === k ? ' on' : ''}`} onClick={() => setSort(k)}>{label}{sort === k ? ' ↓' : ''}</button>;
  return (
    <div className="card card-pad st-card">
      <div className="st-card-h"><h3><span className={`color-dot dot-${color}`} /> {title}</h3><span className="faint">{rows.reduce((s, r) => s + r.games, 0) === 1 ? '1 partida' : `${rows.reduce((s, r) => s + r.games, 0)} partidas`}</span></div>
      {rows.length === 0 ? <p className="faint st-none">Sin partidas con este color.</p> : (
        <>
          <div className="st-table st-op">
            <div className="st-tr st-th"><span>{th('name', 'Apertura')}</span><span className="num">{th('games', 'Part.')}</span><span>V / T / D</span><span className="num">{th('accuracy', 'Prec.')}</span></div>
            {sorted.slice(0, limit).map((r) => (
              <div className="st-tr" key={r.name}>
                <span className="st-name" title={r.name}>{r.name}</span>
                <span className="num">{r.games}</span>
                <WdlBar w={r.wins} d={r.draws} l={r.losses} />
                <span className="num">{f1(r.accuracy)}</span>
              </div>
            ))}
          </div>
          {sorted.length > limit && <button className="btn btn-ghost st-more" onClick={() => setLimit((l) => l + 10)}>Ver más ({sorted.length - limit})</button>}
        </>
      )}
    </div>
  );
}

export default function StatsPage() {
  const games = useLiveQuery(() => db.games.toArray(), []);
  const analyses = useLiveQuery(() => db.analyses.toArray(), []);
  const [f, setF] = useState<StatsFilters>({ periodDays: null, timeClass: '', color: '' });

  const all = useMemo(() => (games && analyses ? joinGames(games, analyses) : []), [games, analyses]);
  const eff = f;
  const items = useMemo(() => filterGames(all, eff), [all, f]);
  const kpi = useMemo(() => computeKpis(items), [items]);
  const series = useMemo(() => accuracySeries(items), [items]);
  const phases = useMemo(() => phaseStats(items), [items]);
  const tcRows = useMemo(() => timeClassRows(items), [items]);
  const white = useMemo(() => openingRows(items, 'w'), [items]);
  const black = useMemo(() => openingRows(items, 'b'), [items]);

  if (games === undefined || analyses === undefined) {
    return <div className="page st-page"><div className="page-header"><h1>Estadísticas</h1></div><div className="st-skel card" /></div>;
  }

  if (all.length === 0) {
    return (
      <div className="page st-page">
        <div className="page-header"><h1>Estadísticas</h1></div>
        <div className="card empty st-empty">
          <div className="st-empty-icon">📊</div>
          <h2>Todavía no hay datos para mostrar</h2>
          <p>Las estadísticas se calculan con tus partidas analizadas. Verificá que tu usuario esté configurado y analizá algunas partidas.</p>
          <Link to="/" className="btn btn-primary btn-lg"><IconLibrary width={18} height={18} />Ir a mis partidas</Link>
        </div>
      </div>
    );
  }

  const phaseData = phases.map((p) => ({ ...p, name: PHASE_LABEL[p.phase] }));
  const setFilter = <K extends keyof StatsFilters>(k: K, v: StatsFilters[K]) => { setF((p) => ({ ...p, [k]: v })); };

  return (
    <div className="page st-page">
      <div className="page-header">
        <div><h1>Estadísticas</h1><p>{items.length} de {all.length} partidas analizadas</p></div>
      </div>

      <div className="st-filters card">
        <div className="tabs" role="tablist" aria-label="Período">
          {PERIODS.map((p) => (
            <button key={p.label} role="tab" aria-selected={eff.periodDays === p.days} className={`tab${eff.periodDays === p.days ? ' active' : ''}`} onClick={() => setFilter('periodDays', p.days)}>{p.label}</button>
          ))}
        </div>
        <select className="select" aria-label="Ritmo" value={f.timeClass} onChange={(e) => setFilter('timeClass', e.target.value as StatsFilters['timeClass'])}>
          <option value="">Todos los ritmos</option>
          {(['bullet', 'blitz', 'rapid', 'classical', 'daily'] as const).map((t) => <option key={t} value={t}>{TC_LABEL[t]}</option>)}
        </select>
        <select className="select" aria-label="Color" value={f.color} onChange={(e) => setFilter('color', e.target.value as StatsFilters['color'])}>
          <option value="">Ambos colores</option><option value="w">Blancas</option><option value="b">Negras</option>
        </select>
      </div>

      {items.length === 0 ? (
        <div className="card empty"><h2>Sin partidas</h2><p>Ninguna partida analizada coincide con los filtros.</p></div>
      ) : (
        <div className="st-body" key={`${eff.periodDays}-${f.timeClass}-${f.color}`}>
          <div className="st-kpis">
            <div className="card st-kpi"><span>Partidas</span><b>{kpi.games}</b><small>{kpi.wins} V · {kpi.draws} T · {kpi.losses} D</small></div>
            <div className="card st-kpi st-kpi-wdl">
              <span>Resultados</span>
              <b>{pct(kpi.winPct)} <em>victorias</em></b>
              <WdlBar w={kpi.wins} d={kpi.draws} l={kpi.losses} />
              <small>{pct(kpi.drawPct)} tablas · {pct(kpi.lossPct)} derrotas</small>
            </div>
            <div className="card st-kpi"><span>Precisión promedio</span><b>{f1(kpi.avgAccuracy)}</b><small>de 100, tus jugadas</small></div>
            <div className="card st-kpi"><span>Errores graves por partida</span><b>{kpi.blundersPerGame.toFixed(2)}</b><small>{Math.round(kpi.blundersPerGame * kpi.games)} en total</small></div>
          </div>

          <div className="card card-pad st-card">
            <div className="st-card-h">
              <h3>Precisión por partida</h3>
              <div className="st-legend"><span><i style={{ background: COL.raw }} />Partida</span><span><i style={{ background: COL.avg }} />Media móvil (5)</span></div>
            </div>
            <div className="st-chart">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                  <CartesianGrid stroke={COL.grid} strokeDasharray="3 4" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: COL.axis, fontSize: 11.5 }} tickLine={false} axisLine={{ stroke: COL.grid }} minTickGap={32} />
                  <YAxis domain={[(m: number) => Math.max(0, Math.floor(m / 10) * 10 - 10), 100]} tick={{ fill: COL.axis, fontSize: 11.5 }} tickLine={false} axisLine={false} width={44} />
                  <Tooltip cursor={{ stroke: COL.axis, strokeDasharray: '3 3' }} content={<Tip render={(p: never) => {
                    const d = p as { label: string; accuracy: number; avg: number; opponent: string };
                    return <><b>{d.label}</b><div className="faint">vs {d.opponent}</div><div><i style={{ background: COL.raw }} />Precisión <b>{f1(d.accuracy)}</b></div><div><i style={{ background: COL.avg }} />Media móvil <b>{f1(d.avg)}</b></div></>;
                  }} />} />
                  <Line type="monotone" dataKey="accuracy" stroke={COL.raw} strokeWidth={1.5} strokeOpacity={0.7} dot={{ r: 3.5, fill: COL.raw, stroke: COL.surface, strokeWidth: 2 }} activeDot={{ r: 5, stroke: COL.surface, strokeWidth: 2 }} isAnimationActive={false} />
                  <Line type="monotone" dataKey="avg" stroke={COL.avg} strokeWidth={2.5} dot={false} activeDot={{ r: 5, stroke: COL.surface, strokeWidth: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="st-two">
            <OpeningTable title="Blancas" color="w" rows={white} />
            <OpeningTable title="Negras" color="b" rows={black} />
          </div>

          <div className="st-two">
            <div className="card card-pad st-card">
              <div className="st-card-h">
                <h3>Errores por fase</h3>
                <div className="st-legend">
                  <span><i style={{ background: COL.inacc }} />Imprecisión</span><span><i style={{ background: COL.mistake }} />Error</span><span><i style={{ background: COL.blunder }} />Error grave</span>
                </div>
              </div>
              <div className="st-chart">
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={phaseData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }} barCategoryGap="30%">
                    <CartesianGrid stroke={COL.grid} strokeDasharray="3 4" vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: COL.axis, fontSize: 12 }} tickLine={false} axisLine={{ stroke: COL.grid }} />
                    <YAxis allowDecimals={false} tick={{ fill: COL.axis, fontSize: 11.5 }} tickLine={false} axisLine={false} />
                    <Tooltip cursor={{ fill: 'rgba(255,255,255,.04)' }} content={<Tip render={(p: never) => {
                      const d = p as (typeof phaseData)[number];
                      return <><b>{d.name}</b><div className="faint">{d.moves} jugadas tuyas</div>
                        <div><i style={{ background: COL.blunder }} />Errores graves <b>{d.blunder}</b></div>
                        <div><i style={{ background: COL.mistake }} />Errores <b>{d.mistake}</b></div>
                        <div><i style={{ background: COL.inacc }} />Imprecisiones <b>{d.inaccuracy}</b></div></>;
                    }} />} />
                    <Bar dataKey="inaccuracy" stackId="e" fill={COL.inacc} stroke={COL.surface} strokeWidth={2} />
                    <Bar dataKey="mistake" stackId="e" fill={COL.mistake} stroke={COL.surface} strokeWidth={2} />
                    <Bar dataKey="blunder" stackId="e" fill={COL.blunder} stroke={COL.surface} strokeWidth={2} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="st-phase-acc">
                {phases.map((p) => (
                  <div key={p.phase}><span>{PHASE_LABEL[p.phase]}</span><b>{p.moves ? f1(p.accuracy) : '—'}</b><small>precisión por jugada</small></div>
                ))}
              </div>
            </div>

            <div className="card card-pad st-card">
              <div className="st-card-h"><h3>Rendimiento por ritmo</h3></div>
              <div className="st-table st-tc">
                <div className="st-tr st-th"><span>Ritmo</span><span className="num">Part.</span><span>% victorias</span><span className="num">Prec.</span></div>
                {tcRows.map((r) => (
                  <div className="st-tr" key={r.timeClass}>
                    <span className="st-name">{TC_LABEL[r.timeClass]}</span>
                    <span className="num">{r.games}</span>
                    <span className="st-meter"><span className="progress"><div style={{ width: `${r.winPct}%` }} /></span><b>{pct(r.winPct)}</b></span>
                    <span className="num">{f1(r.accuracy)}</span>
                  </div>
                ))}
                {tcRows.length === 0 && <p className="faint st-none">Sin datos de ritmo.</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
