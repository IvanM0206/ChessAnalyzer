import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Chess } from 'chess.js';
import { db, getSettings } from '../db/db';
import { DEFAULT_SETTINGS, type Color, type Game, type Settings } from '../types';
import { Board } from '../components/Board';
import { lookupOpening, loadOpenings } from '../analysis/openings';
import './Openings.css';

const MAX_PLY = 24;
type Parsed = { game: Game; sans: string[]; ucis: string[]; score: 1 | 0.5 | 0; acc?: number };

function myScore(g: Game): 1 | 0.5 | 0 {
  if (g.result === '1/2-1/2' || g.result === '*') return 0.5;
  return (g.result === '1-0') === (g.userColor === 'w') ? 1 : 0;
}

export default function OpeningsPage() {
  const [side, setSide] = useState<Color>('w');
  const [path, setPath] = useState<string[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [, force] = useState(0);
  useEffect(() => { void getSettings().then(setSettings); void loadOpenings().then(() => force((x) => x + 1)); }, []);

  const data = useLiveQuery(async () => {
    const games = await db.games.filter((g) => !!g.userColor).toArray();
    const analyses = new Map((await db.analyses.toArray()).map((a) => [a.gameId, a]));
    return games.map((game): Parsed | null => {
      try {
        const c = new Chess(); c.loadPgn(game.pgn);
        const h = c.history({ verbose: true }).slice(0, MAX_PLY);
        const a = analyses.get(game.id);
        return { game, sans: h.map((m) => m.san), ucis: h.map((m) => m.from + m.to), score: myScore(game), acc: a ? a[game.userColor === 'w' ? 'white' : 'black'].accuracy : undefined };
      } catch { return null; }
    }).filter((x): x is Parsed => !!x);
  }, []);

  const mine = useMemo(() => (data ?? []).filter((d) => d.game.userColor === side), [data, side]);
  const here = useMemo(() => mine.filter((d) => path.every((s, i) => d.sans[i] === s)), [mine, path]);

  const fen = useMemo(() => { const c = new Chess(); path.forEach((s) => c.move(s)); return c.fen(); }, [path]);
  const opening = lookupOpening(fen);

  const next = useMemo(() => {
    const m = new Map<string, { san: string; uci: string; games: Parsed[] }>();
    for (const d of here) {
      const san = d.sans[path.length];
      if (!san) continue;
      const e = m.get(san) ?? { san, uci: d.ucis[path.length], games: [] };
      e.games.push(d); m.set(san, e);
    }
    return [...m.values()].sort((a, b) => b.games.length - a.games.length);
  }, [here, path.length]);

  const stats = (gs: Parsed[]) => {
    const w = gs.filter((g) => g.score === 1).length, d = gs.filter((g) => g.score === 0.5).length;
    const accs = gs.map((g) => g.acc).filter((x): x is number => x !== undefined);
    return { n: gs.length, w, d, l: gs.length - w - d, acc: accs.length ? accs.reduce((a, b) => a + b, 0) / accs.length : undefined };
  };
  const myTurn = (path.length % 2 === 0) === (side === 'w');
  const maxN = next[0]?.games.length ?? 1;
  const arrows = next.slice(0, 3).map((n, i) => ({ from: n.uci.slice(0, 2), to: n.uci.slice(2, 4), color: i === 0 ? 'rgba(111,174,79,.85)' : 'rgba(111,174,79,.45)' }));

  if (data && !data.some((d) => d.game.userColor)) {
    return (
      <div className="page"><div className="card empty"><h2>No hay partidas tuyas todavía</h2>
        <p>Configurá tu usuario en Configuración para que la app sepa con qué color jugaste.</p>
        <Link className="btn btn-primary" to="/settings">Ir a Configuración</Link></div></div>
    );
  }

  const s = stats(here);
  return (
    <div className="page op-page">
      <div className="page-header">
        <div><h1>Mis aperturas</h1><p>Compará tus partidas que pasaron por la misma posición: qué jugaste y cómo te fue.</p></div>
        <div className="tabs">
          <button className={`tab${side === 'w' ? ' active' : ''}`} onClick={() => { setSide('w'); setPath([]); }}>Con blancas</button>
          <button className={`tab${side === 'b' ? ' active' : ''}`} onClick={() => { setSide('b'); setPath([]); }}>Con negras</button>
        </div>
      </div>
      <div className="op-layout">
        <div className="op-board">
          <Board fen={fen} orientation={side === 'w' ? 'white' : 'black'} theme={settings.boardTheme} arrows={arrows}
            onDrop={(from, to) => { const n = next.find((x) => x.uci === from + to); if (n) setPath([...path, n.san]); return !!n; }} />
        </div>
        <div className="stack op-side">
          <div className="card card-pad">
            <div className="op-crumbs">
              <button className="chip" onClick={() => setPath([])}>Inicio</button>
              {path.map((san, i) => (
                <button key={i} className={`chip${i === path.length - 1 ? ' active' : ''}`} onClick={() => setPath(path.slice(0, i + 1))}>
                  {i % 2 === 0 ? `${i / 2 + 1}.` : ''}{san}
                </button>
              ))}
            </div>
            <div className="op-head">
              <div>
                <div className="op-name">{opening ? `${opening.eco} · ${opening.name}` : path.length ? 'Fuera de teoría' : 'Posición inicial'}</div>
                <div className="faint">{s.n} {s.n === 1 ? 'partida' : 'partidas'} · {s.acc !== undefined ? `precisión media ${s.acc.toFixed(1)}` : 'sin analizar'}</div>
              </div>
              <WDL {...s} />
            </div>
          </div>

          <div className="card">
            <div className="op-table-head"><span>{myTurn ? 'Tus jugadas' : 'Jugadas del rival'}</span><span>Partidas</span><span>Resultado</span><span>Prec.</span></div>
            {next.length === 0 && <p className="faint op-none">No hay más jugadas en tus partidas desde acá.</p>}
            {next.map((n) => {
              const st = stats(n.games);
              return (
                <button key={n.san} className="op-row" onClick={() => setPath([...path, n.san])}>
                  <span className="op-san">{n.san}</span>
                  <span className="op-count"><span className="op-freq" style={{ width: `${(n.games.length / maxN) * 100}%` }} />{n.games.length}</span>
                  <WDL {...st} />
                  <span className="op-acc">{st.acc?.toFixed(1) ?? '—'}</span>
                </button>
              );
            })}
          </div>

          <div className="card">
            <div className="op-table-head games"><span>Partidas en esta posición</span></div>
            <div className="op-games">
              {here.slice(0, 50).map((d) => (
                <Link key={d.game.id} to={`/review/${encodeURIComponent(d.game.id)}`} className="op-game">
                  <span className={`badge ${d.score === 1 ? 'badge-win' : d.score === 0 ? 'badge-loss' : 'badge-draw'}`}>{d.score === 1 ? 'Ganada' : d.score === 0 ? 'Perdida' : 'Tablas'}</span>
                  <span className="grow">vs {side === 'w' ? d.game.black : d.game.white}<span className="faint"> · {d.game.date || 'sin fecha'}</span></span>
                  <span className="faint">siguió {d.sans[path.length] ?? '—'}</span>
                  <span className="op-acc">{d.acc?.toFixed(1) ?? '—'}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function WDL({ n, w, d, l }: { n: number; w: number; d: number; l: number }) {
  if (!n) return <span className="wdl empty" />;
  const pct = (x: number) => `${(x / n) * 100}%`;
  return (
    <span className="wdl" title={`${w} ganadas · ${d} tablas · ${l} perdidas`}>
      <span className="wdl-w" style={{ width: pct(w) }}>{w ? Math.round((w / n) * 100) : ''}</span>
      <span className="wdl-d" style={{ width: pct(d) }}>{d / n > 0.15 ? Math.round((d / n) * 100) : ''}</span>
      <span className="wdl-l" style={{ width: pct(l) }}>{l ? Math.round((l / n) * 100) : ''}</span>
    </span>
  );
}
