import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Chess } from 'chess.js';
import { db, getSettings } from '../db/db';
import { Board } from '../components/Board';
import { CLASS_META } from '../components/ClassIcon';
import { IconLibrary, IconPlay } from '../components/Icons';
import { playMoveSound } from '../lib/sound';
import { gradeAndSave, isAcceptable, syncDrills } from '../training/drills';
import type { Drill, Game, GameAnalysis, Settings } from '../types';
import { DEFAULT_SETTINGS } from '../types';
import './Trainer.css';

type FilterKey = 'all' | 'blunder' | 'mistake' | 'miss';
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'Todos' }, { key: 'blunder', label: 'Errores graves' },
  { key: 'mistake', label: 'Errores' }, { key: 'miss', label: 'Oportunidades perdidas' },
];
type Phase = 'ask' | 'checking' | 'wrong' | 'correct' | 'solution';

function fmtDate(d: string) {
  if (!d) return 'sin fecha';
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtWhen(ts: number, now = Date.now()) {
  const min = Math.max(1, Math.round((ts - now) / 60000));
  if (min < 60) return `en ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `en ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'mañana' : `en ${d} días`;
}

const sq = (uci: string) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4) });

export default function TrainerPage() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [synced, setSynced] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [now, setNow] = useState(() => Date.now());
  const drills = useLiveQuery(() => db.drills.toArray(), []);
  const games = useLiveQuery(() => db.games.toArray(), []);
  const analyzedCount = useLiveQuery(() => db.analyses.count(), []);

  const [current, setCurrent] = useState<Drill | null>(null);
  const [started, setStarted] = useState(false);
  const [phase, setPhase] = useState<Phase>('ask');
  const [analysis, setAnalysis] = useState<GameAnalysis | undefined>();
  const [boardFen, setBoardFen] = useState('');
  const [shown, setShown] = useState<{ from: string; to: string; kind: 'best' | 'blunder' } | undefined>();
  const [graded, setGraded] = useState(false);
  const [wasRetry, setWasRetry] = useState(false);
  const timer = useRef<number>(0);

  useEffect(() => { getSettings().then(setSettings); syncDrills().finally(() => setSynced(true)); }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const gameMap = useMemo(() => new Map((games ?? []).map((g) => [g.id, g] as [string, Game])), [games]);
  const matches = useCallback((d: Drill) => filter === 'all' || d.classification === filter, [filter]);

  const due = useMemo(
    () => (drills ?? []).filter((d) => d.due <= now && matches(d)).sort((a, b) => a.due - b.due),
    [drills, now, matches],
  );
  const dueAll = useMemo(() => (drills ?? []).filter((d) => d.due <= now), [drills, now]);
  const nextDue = useMemo(() => {
    const later = (drills ?? []).filter((d) => d.due > now && matches(d)).map((d) => d.due);
    return later.length ? Math.min(...later) : undefined;
  }, [drills, now, matches]);
  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { all: 0, blunder: 0, mistake: 0, miss: 0 };
    dueAll.forEach((d) => { c.all++; if (d.classification in c) c[d.classification as FilterKey]++; });
    return c;
  }, [dueAll]);
  const answered = (drills ?? []).filter((d) => d.lastResult);
  const accuracy = answered.length ? Math.round((answered.filter((d) => d.lastResult === 'pass').length / answered.length) * 100) : null;

  const load = useCallback((d: Drill | null) => {
    window.clearTimeout(timer.current);
    setCurrent(d); setPhase('ask'); setShown(undefined); setGraded(false); setWasRetry(false);
    setBoardFen(d?.fen ?? '');
    setAnalysis(undefined);
    if (d) db.analyses.get(d.gameId).then((a) => setAnalysis(a));
  }, []);

  // Pick the first drill once data is ready, and again when the filter changes.
  const pickKey = useRef('');
  useEffect(() => {
    if (!synced || drills === undefined) return;
    const key = `${filter}`;
    if (!started || pickKey.current !== key) {
      pickKey.current = key; setStarted(true);
      const t = Date.now(); setNow(t);
      load(drills.filter((d) => d.due <= t && matches(d)).sort((a, b) => a.due - b.due)[0] ?? null);
    }
  }, [synced, drills, filter, started, matches, load]);

  const next = () => {
    const t = Date.now(); setNow(t);
    const rest = (drills ?? []).filter((d) => d.due <= t && matches(d) && d.id !== current?.id).sort((a, b) => a.due - b.due);
    load(rest[0] ?? null);
  };

  const grade = async (d: Drill, pass: boolean) => {
    if (graded) return;
    setGraded(true);
    setCurrent(await gradeAndSave(d, pass));
  };

  const onDrop = (from: string, to: string): boolean => {
    if (!current || (phase !== 'ask')) return false;
    const chess = new Chess(current.fen);
    let mv;
    try { mv = chess.move({ from, to, promotion: 'q' }); } catch { return false; }
    if (!mv) return false;
    const uci = mv.from + mv.to + (mv.promotion ?? '');
    const ok = isAcceptable(current, uci, analysis);
    if (settings.soundOn) playMoveSound(mv.isCapture());
    setBoardFen(chess.fen());
    if (ok) {
      setShown({ from: mv.from, to: mv.to, kind: 'best' });
      setPhase('correct');
      if (!graded) void grade(current, true);
    } else {
      setShown({ from: mv.from, to: mv.to, kind: 'blunder' });
      setPhase('checking');
      void grade(current, false);
      timer.current = window.setTimeout(() => { setBoardFen(current.fen); setShown(undefined); setPhase('wrong'); }, 1000);
    }
    return true;
  };

  const retry = () => { setPhase('ask'); setWasRetry(true); };
  const showSolution = () => {
    if (!current) return;
    void grade(current, false);
    setPhase('solution'); setBoardFen(current.fen); setShown(undefined);
  };

  const header = (
    <div className="page-header">
      <div>
        <h1>Entrenador</h1>
        <p>Practicá las posiciones donde te equivocaste, con repetición espaciada.</p>
      </div>
    </div>
  );

  if (drills === undefined || games === undefined || analyzedCount === undefined || !synced) {
    return <div className="page tr-page">{header}<div className="tr-skel card" /></div>;
  }

  if (drills.length === 0) {
    return (
      <div className="page tr-page">
        {header}
        <div className="card empty tr-empty">
          <div className="tr-empty-icon">♞</div>
          <h2>{analyzedCount === 0 ? 'Todavía no hay partidas analizadas' : 'No hay errores para entrenar'}</h2>
          <p>{analyzedCount === 0
            ? 'Analizá tus partidas y acá aparecerán tus errores como ejercicios para practicar.'
            : 'Verificá que tu usuario esté configurado, o analizá más partidas para encontrar errores.'}</p>
          <Link to="/" className="btn btn-primary btn-lg"><IconLibrary width={18} height={18} />Ir a mis partidas</Link>
        </div>
      </div>
    );
  }

  const game = current ? gameMap.get(current.gameId) : undefined;
  const orientation = current?.color === 'b' ? 'black' : 'white';
  const bestSq = current ? sq(current.bestUci) : undefined;
  const opponent = game ? (current?.color === 'w' ? game.black : game.white) : '';
  const moveNo = current ? Math.ceil(current.ply / 2) : 0;
  const meta = current ? CLASS_META[current.classification] : undefined;

  return (
    <div className="page tr-page">
      {header}

      <div className="tr-stats">
        <div className="card tr-stat"><b>{dueAll.length}</b><span>Pendientes hoy</span></div>
        <div className="card tr-stat"><b>{drills.length}</b><span>Ejercicios en total</span></div>
        <div className="card tr-stat"><b>{accuracy === null ? '—' : `${accuracy}%`}</b><span>Aciertos</span></div>
      </div>

      <div className="tabs tr-filters" role="tablist">
        {FILTERS.map((f) => (
          <button key={f.key} role="tab" aria-selected={filter === f.key} className={`tab${filter === f.key ? ' active' : ''}`} onClick={() => setFilter(f.key)}>
            {f.label}{counts[f.key] > 0 && <span className="tr-count">{counts[f.key]}</span>}
          </button>
        ))}
      </div>

      {!current ? (
        <div className="card empty tr-empty">
          <div className="tr-empty-icon tr-done">✓</div>
          <h2>¡Al día!</h2>
          <p>{nextDue ? `No tenés ejercicios pendientes. El próximo vence ${fmtWhen(nextDue, now)}.` : 'No tenés ejercicios pendientes en esta categoría.'}</p>
          {filter !== 'all' && <button className="btn" onClick={() => setFilter('all')}>Ver todos</button>}
        </div>
      ) : (
        <div className="tr-session" key={current.id}>
          <div className={`tr-board${phase === 'correct' ? ' ok' : ''}${phase === 'checking' || phase === 'wrong' ? ' bad' : ''}`}>
            <Board
              fen={boardFen} orientation={orientation} theme={settings.boardTheme}
              lastMove={shown ? { from: shown.from, to: shown.to, classification: shown.kind === 'best' ? 'best' : 'blunder' } : undefined}
              arrows={phase === 'solution' && bestSq ? [{ ...bestSq, color: 'rgba(124,179,66,.9)' }] : []}
              onDrop={phase === 'ask' ? onDrop : undefined}
            />
            {phase === 'correct' && <div className="tr-burst" aria-hidden><span>✓</span></div>}
          </div>

          <div className="card card-pad tr-panel">
            <div className="tr-ctx">
              <span className="row"><span className={`color-dot dot-${current.color}`} />Jugás con {current.color === 'w' ? 'blancas' : 'negras'}</span>
              <span className="faint">·</span>
              <span>vs {opponent || 'rival'}</span>
              <span className="faint">·</span>
              <span>{fmtDate(game?.date ?? '')}</span>
              <span className="faint">·</span>
              <span>jugada {moveNo}</span>
            </div>

            {(phase === 'ask' || phase === 'checking') && (
              <div className="tr-msg" key={wasRetry ? 'retry' : 'ask'}>
                <h2>{wasRetry ? 'Probá de nuevo' : 'Encontrá la mejor jugada'}</h2>
                <p className="muted">{phase === 'checking' ? 'Esa no es…' : 'Arrastrá una pieza para jugar tu respuesta.'}</p>
              </div>
            )}

            {phase === 'wrong' && (
              <div className="tr-msg tr-bad">
                <h2><span className="tr-x">✕</span> No es esa</h2>
                <p className="muted">Esa jugada no resuelve la posición. Podés intentarlo otra vez o ver la solución.</p>
                <div className="row tr-actions">
                  <button className="btn btn-primary" onClick={retry}>Reintentar</button>
                  <button className="btn" onClick={showSolution}>Ver solución</button>
                </div>
              </div>
            )}

            {phase === 'correct' && (
              <div className="tr-msg tr-good">
                <h2><span className="tr-check">✓</span> ¡Correcto!</h2>
                <p className="muted">
                  {wasRetry ? 'Bien, a la segunda. ' : ''}En la partida jugaste <b className="tr-san">{current.playedSan}</b>
                  {meta && <> ({meta.label.toLowerCase()})</>}.
                </p>
                <div className="row tr-actions">
                  <button className="btn btn-primary" autoFocus onClick={next}><IconPlay width={16} height={16} />Siguiente</button>
                </div>
              </div>
            )}

            {phase === 'solution' && (
              <div className="tr-msg">
                <h2>La mejor jugada era <span className="tr-san tr-san-best">{current.bestSan}</span></h2>
                <p className="muted">
                  En la partida jugaste <b className="tr-san">{current.playedSan}</b>{meta && <> ({meta.label.toLowerCase()})</>}.
                   Volverá a aparecer en unos minutos.
                </p>
                <div className="row tr-actions">
                  <button className="btn btn-primary" autoFocus onClick={next}><IconPlay width={16} height={16} />Siguiente</button>
                </div>
              </div>
            )}

            <div className="tr-foot">
              <Link className="btn btn-ghost" to={`/review/${encodeURIComponent(current.gameId)}`}>Ver partida</Link>
              <span className="faint tr-left">{due.length} pendiente{due.length === 1 ? '' : 's'}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
