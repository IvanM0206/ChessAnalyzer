import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { IconImport, IconSearch, IconTrash } from '../components/Icons';
import { useToast } from '../lib/toast';
import { syncNewGames } from '../import/sync';
import type { Color, Game, TimeClass } from '../types';
import './Library.css';

const PAGE = 50;
const SOURCE_LABEL = { chesscom: 'Chess.com', lichess: 'Lichess', pgn: 'PGN' } as const;
const TC_LABEL: Record<TimeClass, string> = {
  bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rápida', classical: 'Clásica', daily: 'Diaria', unknown: '—',
};

type Outcome = 'win' | 'loss' | 'draw';
function outcome(g: Game): Outcome | undefined {
  if (!g.userColor || g.result === '*') return undefined;
  if (g.result === '1/2-1/2') return 'draw';
  const whiteWon = g.result === '1-0';
  return (g.userColor === 'w') === whiteWon ? 'win' : 'loss';
}
const OUT_LABEL = { win: 'Ganada', loss: 'Perdida', draw: 'Tablas' } as const;

function fmtDate(d: string) {
  if (!d) return 'Sin fecha';
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
}

function SourceIcon({ source }: { source: Game['source'] }) {
  const cls = `src-dot src-${source}`;
  return <span className={cls} aria-hidden>{source === 'chesscom' ? '♞' : source === 'lichess' ? '♘' : '⎘'}</span>;
}

interface Filters {
  q: string; result: '' | Outcome; color: '' | Color; tc: '' | TimeClass; source: '' | Game['source']; analyzed: '' | 'yes' | 'no';
}
const EMPTY: Filters = { q: '', result: '', color: '', tc: '', source: '', analyzed: '' };

export default function LibraryPage() {
  const toast = useToast();
  const games = useLiveQuery(() => db.games.toArray(), []);
  const accuracies = useLiveQuery(async () => {
    const m: Record<string, [number, number]> = {};
    await db.analyses.each((a) => { m[a.gameId] = [a.white.accuracy, a.black.accuracy]; });
    return m;
  }, []);
  const [f, setF] = useState<Filters>(EMPTY);
  const [limit, setLimit] = useState(PAGE);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const sorted = useMemo(
    () => (games ?? []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.importedAt - a.importedAt),
    [games],
  );

  const filtered = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    return sorted.filter((g) => {
      if (q && !`${g.white} ${g.black} ${g.openingName ?? ''} ${g.eco ?? ''}`.toLowerCase().includes(q)) return false;
      if (f.result && outcome(g) !== f.result) return false;
      if (f.color && g.userColor !== f.color) return false;
      if (f.tc && g.timeClass !== f.tc) return false;
      if (f.source && g.source !== f.source) return false;
      if (f.analyzed === 'yes' && !g.analyzed) return false;
      if (f.analyzed === 'no' && g.analyzed) return false;
      return true;
    });
  }, [sorted, f]);

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => { setF((p) => ({ ...p, [k]: v })); setLimit(PAGE); };
  const hasFilters = JSON.stringify(f) !== JSON.stringify(EMPTY);

  const remove = async (id: string) => {
    await db.transaction('rw', db.games, db.analyses, async () => {
      await db.games.delete(id);
      await db.analyses.delete(id);
    });
    setConfirmId(null);
    toast('Partida eliminada.');
  };

  if (games === undefined) {
    return (
      <div className="page lib-page">
        <div className="page-header"><h1>Mis partidas</h1></div>
        <div className="stack">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="game-row skeleton" />)}</div>
      </div>
    );
  }

  if (games.length === 0) {
    return (
      <div className="page lib-page">
        <div className="page-header"><h1>Mis partidas</h1></div>
        <div className="card empty lib-empty">
          <div className="lib-empty-icon">♟</div>
          <h2>Todavía no hay partidas</h2>
          <p>Importá tus partidas desde Chess.com, Lichess o un PGN para empezar a analizarlas.</p>
          <Link to="/import" className="btn btn-primary btn-lg"><IconImport width={18} height={18} />Importar partidas</Link>
        </div>
      </div>
    );
  }

  const shown = filtered.slice(0, limit);

  return (
    <div className="page lib-page">
      <div className="page-header">
        <div>
          <h1>Mis partidas</h1>
          <p>{filtered.length === games.length ? `${games.length} partidas` : `${filtered.length} de ${games.length} partidas`}</p>
        </div>
        <div className="row">
          <SyncButton />
          <Link to="/import" className="btn"><IconImport width={18} height={18} />Importar</Link>
        </div>
      </div>

      <div className="lib-filters card">
        <div className="lib-search">
          <IconSearch width={16} height={16} />
          <input className="input" placeholder="Buscar jugador o apertura…" value={f.q} onChange={(e) => set('q', e.target.value)} />
        </div>
        <select className="select" value={f.result} onChange={(e) => set('result', e.target.value as Filters['result'])} aria-label="Resultado">
          <option value="">Resultado</option><option value="win">Ganadas</option><option value="loss">Perdidas</option><option value="draw">Tablas</option>
        </select>
        <select className="select" value={f.color} onChange={(e) => set('color', e.target.value as Filters['color'])} aria-label="Color">
          <option value="">Color</option><option value="w">Blancas</option><option value="b">Negras</option>
        </select>
        <select className="select" value={f.tc} onChange={(e) => set('tc', e.target.value as Filters['tc'])} aria-label="Ritmo">
          <option value="">Ritmo</option>
          {(['bullet', 'blitz', 'rapid', 'classical', 'daily'] as const).map((t) => <option key={t} value={t}>{TC_LABEL[t]}</option>)}
        </select>
        <select className="select" value={f.source} onChange={(e) => set('source', e.target.value as Filters['source'])} aria-label="Origen">
          <option value="">Origen</option><option value="chesscom">Chess.com</option><option value="lichess">Lichess</option><option value="pgn">PGN</option>
        </select>
        <select className="select" value={f.analyzed} onChange={(e) => set('analyzed', e.target.value as Filters['analyzed'])} aria-label="Análisis">
          <option value="">Análisis</option><option value="yes">Analizadas</option><option value="no">Sin analizar</option>
        </select>
        {hasFilters && <button className="btn btn-ghost" onClick={() => { setF(EMPTY); setLimit(PAGE); }}>Limpiar</button>}
      </div>

      {filtered.length === 0 ? (
        <div className="card empty">
          <h2>Sin resultados</h2>
          <p>Ninguna partida coincide con los filtros.</p>
          <button className="btn" onClick={() => setF(EMPTY)}>Limpiar filtros</button>
        </div>
      ) : (
        <div className="stack lib-list">
          {shown.map((g) => {
            const o = outcome(g);
            const acc = g.analyzed ? accuracies?.[g.id] : undefined;
            const me = g.userColor;
            return (
              <div key={g.id} className="game-row card">
                <div className="gr-result">
                  {o ? <span className={`badge badge-${o}`}>{OUT_LABEL[o]}</span> : <span className="badge">{g.result}</span>}
                  {me && <span className={`color-dot ${me === 'w' ? 'dot-w' : 'dot-b'}`} title={me === 'w' ? 'Jugaste con blancas' : 'Jugaste con negras'} />}
                </div>
                <div className="gr-players grow">
                  <div className={`gr-p${me === 'w' ? ' me' : ''}`}>
                    <span className="color-dot dot-w" /><span className="gr-name">{g.white}</span>
                    {g.whiteElo && <span className="faint">({g.whiteElo})</span>}
                  </div>
                  <div className={`gr-p${me === 'b' ? ' me' : ''}`}>
                    <span className="color-dot dot-b" /><span className="gr-name">{g.black}</span>
                    {g.blackElo && <span className="faint">({g.blackElo})</span>}
                  </div>
                </div>
                <div className="gr-meta">
                  <div className="gr-opening" title={g.openingName}>{g.openingName ?? (g.eco ? `ECO ${g.eco}` : 'Apertura desconocida')}</div>
                  <div className="gr-sub faint">
                    <span>{fmtDate(g.date)}</span>
                    <span>·</span>
                    <span>{TC_LABEL[g.timeClass]}</span>
                    <span>·</span>
                    <span className="gr-source"><SourceIcon source={g.source} />{SOURCE_LABEL[g.source]}</span>
                  </div>
                </div>
                <div className="gr-analysis">
                  {g.analyzed ? (
                    <span className="badge badge-analyzed" title="Partida analizada">
                      ✓ Analizada{acc ? ` · ${acc[0].toFixed(0)}% / ${acc[1].toFixed(0)}%` : ''}
                    </span>
                  ) : <span className="faint">Sin analizar</span>}
                </div>
                <div className="gr-actions">
                  {confirmId === g.id ? (
                    <span className="gr-confirm">
                      <button className="btn btn-ghost" onClick={() => setConfirmId(null)}>Cancelar</button>
                      <button className="btn btn-danger" onClick={() => void remove(g.id)}>Eliminar</button>
                    </span>
                  ) : (
                    <>
                      <button className="btn btn-ghost btn-icon gr-del" title="Eliminar partida" aria-label="Eliminar partida" onClick={() => setConfirmId(g.id)}>
                        <IconTrash width={18} height={18} />
                      </button>
                      <Link to={`/review/${encodeURIComponent(g.id)}`} className="btn btn-primary">Revisar</Link>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {filtered.length > shown.length && (
            <button className="btn lib-more" onClick={() => setLimit((l) => l + PAGE)}>
              Mostrar más ({filtered.length - shown.length} restantes)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SyncButton() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async () => {
    setBusy('Buscando…');
    try {
      const r = await syncNewGames(setBusy);
      if (!r.sources.length) toast('Configurá tu usuario de Chess.com o Lichess en Configuración.', 'error');
      else toast(r.added ? `${r.added} partidas nuevas de ${r.sources.join(' y ')}` : 'No hay partidas nuevas');
    } catch (e) {
      toast((e as Error).message || 'No se pudieron traer las partidas.', 'error');
    } finally { setBusy(null); }
  };
  return (
    <button className="btn btn-primary" onClick={run} disabled={!!busy}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={busy ? 'spin' : undefined}><path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5" /></svg>
      {busy ?? 'Traer nuevas'}
    </button>
  );
}
