import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Chess } from 'chess.js';
import { db, getSettings } from '../db/db';
import type { PositionEval, Score, Settings } from '../types';
import { DEFAULT_SETTINGS } from '../types';
import { Engine } from '../engine/engine';
import { fenKey, loadOpenings, lookupOpening } from '../analysis/openings';
import { Board } from '../components/Board';
import { EvalBar } from '../components/EvalBar';
import { MoveList } from '../components/MoveList';
import { IconChevronLeft, IconChevronRight, IconFirst, IconFlip, IconLast } from '../components/Icons';
import { formatScore } from '../lib/format';
import { playMoveSound } from '../lib/sound';
import { useToast } from '../lib/toast';
import './Explorer.css';

interface Step { san: string; uci: string; fen: string }

const validFen = (f: string | null): string | null => {
  if (!f) return null;
  try { return new Chess(f.trim()).fen(); } catch { return null; }
};

export default function ExplorerPage() {
  const toast = useToast();
  const [params] = useSearchParams();
  const fenParam = params.get('fen');
  const [startFen, setStartFen] = useState(() => validFen(fenParam) ?? new Chess().fen());
  const [steps, setSteps] = useState<Step[]>([]);
  const [ply, setPly] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [openingsReady, setOpeningsReady] = useState(false);
  const [fenText, setFenText] = useState('');
  const [engine, setEngine] = useState<Engine | null>(null);
  const [ev, setEv] = useState<PositionEval | null>(null);
  const [lastScore, setLastScore] = useState<Score | undefined>();
  const token = useRef(0);

  const fen = ply === 0 ? startFen : steps[ply - 1].fen;

  useEffect(() => { void getSettings().then(setSettings); void loadOpenings().then(() => setOpeningsReady(true)); }, []);

  // Load a position coming from the URL.
  const firstParam = useRef(true);
  useEffect(() => {
    if (firstParam.current) { firstParam.current = false; return; }
    const f = validFen(fenParam);
    if (f) { setStartFen(f); setSteps([]); setPly(0); }
  }, [fenParam]);

  useEffect(() => { setFenText(fen); }, [fen]);

  // Dedicated engine instance, terminated on unmount.
  useEffect(() => {
    let e: Engine | null = null;
    try { e = new Engine(); } catch { e = null; }
    setEngine(e);
    return () => { e?.terminate(); };
  }, []);

  const terminal = useMemo(() => {
    const c = new Chess(fen);
    if (c.isCheckmate()) return { cp: c.turn() === 'w' ? -100000 : 100000 } as Score;
    if (c.isDraw() || c.isStalemate()) return { cp: 0 } as Score;
    return null;
  }, [fen]);

  useEffect(() => {
    if (!engine) return;
    const my = ++token.current;
    engine.stopAll();
    setEv(null);
    if (terminal) { setLastScore(terminal); return; }
    const apply = (e: PositionEval) => {
      if (token.current !== my) return;
      setEv(e);
      if (e.lines[0]) setLastScore(e.lines[0].score);
    };
    engine.analyze(fen, 22, 3, apply).then(apply).catch((err: Error) => {
      if (err?.message !== 'cancelled') console.warn(err);
    });
  }, [engine, fen, terminal]);

  const playMove = useCallback((from: string, to: string, promotion = 'q') => {
    const c = new Chess(fen);
    let m;
    try { m = c.move({ from, to, promotion }); } catch { return false; }
    const uci = m.from + m.to + (m.promotion ?? '');
    if (settings.soundOn) playMoveSound(m.isCapture());
    if (steps[ply]?.uci === uci) { setPly(ply + 1); return true; }
    setSteps([...steps.slice(0, ply), { san: m.san, uci, fen: c.fen() }]);
    setPly(ply + 1);
    return true;
  }, [fen, steps, ply, settings.soundOn]);

  const playSans = (sans: string[]) => {
    const c = new Chess(fen);
    const added: Step[] = [];
    for (const s of sans) {
      try { const m = c.move(s); added.push({ san: m.san, uci: m.from + m.to + (m.promotion ?? ''), fen: c.fen() }); } catch { break; }
    }
    if (!added.length) return;
    if (settings.soundOn) playMoveSound(added[0].san.includes('x'));
    setSteps([...steps.slice(0, ply), ...added]);
    setPly(ply + added.length);
  };

  const go = useCallback((p: number) => setPly(Math.max(0, Math.min(steps.length, p))), [steps.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = (e.target as HTMLElement)?.tagName;
      if (t === 'INPUT' || t === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') { e.preventDefault(); go(ply + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(ply - 1); }
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(steps.length);
      else if (e.key === 'f') setFlipped((f) => !f);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, ply, steps.length]);

  const loadFen = () => {
    const f = validFen(fenText);
    if (!f) { toast('FEN inválido', 'error'); return; }
    setStartFen(f); setSteps([]); setPly(0);
  };
  const reset = () => { setStartFen(new Chess().fen()); setSteps([]); setPly(0); };
  const copyFen = async () => {
    try { await navigator.clipboard.writeText(fen); toast('FEN copiado'); } catch { toast('No se pudo copiar', 'error'); }
  };

  const key = fenKey(fen);
  const repHits = useLiveQuery(() => db.repertoire.where('fenKey').equals(key).toArray(), [key]);
  const repSides = (['w', 'b'] as const).map((s) => ({ side: s, moves: (repHits ?? []).filter((r) => r.side === s) })).filter((x) => x.moves.length);

  const opening = useMemo(() => {
    if (!openingsReady) return null;
    for (let i = ply; i >= 0; i--) { const o = lookupOpening(i === 0 ? startFen : steps[i - 1].fen); if (o) return o; }
    return null;
  }, [openingsReady, ply, steps, startFen]);

  const lines = ev && ev.fen === fen ? ev.lines : [];
  const best = lines[0];
  const lastMove = ply > 0 ? { from: steps[ply - 1].uci.slice(0, 2), to: steps[ply - 1].uci.slice(2, 4) } : undefined;
  const arrows = best ? [{ from: best.uci.slice(0, 2), to: best.uci.slice(2, 4), color: 'rgba(124, 179, 66, .85)' }] : [];
  const turn = fen.split(' ')[1];
  const startNum = Number(startFen.split(' ')[5] ?? 1);
  const startBlack = startFen.split(' ')[1] === 'b';

  return (
    <div className="page ex-page">
      <div className="page-header">
        <div>
          <h1>Análisis libre</h1>
          <p>Movés las piezas como quieras y el motor analiza la posición en vivo.</p>
        </div>
        <div className="ex-tags">
          {opening && <span className="badge ex-opening">{opening.eco} · {opening.name}</span>}
          {repSides.map((r) => (
            <span key={r.side} className="badge ex-rep" title={r.moves.map((m) => m.san).join(', ')}>
              En tu repertorio ({r.side === 'w' ? 'blancas' : 'negras'}): {r.moves.map((m) => m.san).join(', ')}
            </span>
          ))}
        </div>
      </div>

      <div className="ex-layout">
        <section className="ex-board-col">
          <div className="ex-board-row">
            <EvalBar score={lastScore} flipped={flipped} />
            <div className="ex-board">
              <Board fen={fen} orientation={flipped ? 'black' : 'white'} theme={settings.boardTheme} lastMove={lastMove} arrows={arrows} onDrop={(f, t) => playMove(f, t)} />
            </div>
          </div>
          <div className="ex-nav">
            <button className="btn btn-ghost btn-icon" onClick={() => setFlipped(!flipped)} title="Girar tablero (F)"><IconFlip /></button>
            <div className="row">
              <button className="btn btn-icon" onClick={() => go(0)} title="Inicio"><IconFirst /></button>
              <button className="btn btn-icon ex-nav-main" onClick={() => go(ply - 1)} title="Anterior (←)"><IconChevronLeft /></button>
              <button className="btn btn-icon ex-nav-main" onClick={() => go(ply + 1)} title="Siguiente (→)"><IconChevronRight /></button>
              <button className="btn btn-icon" onClick={() => go(steps.length)} title="Final"><IconLast /></button>
            </div>
            <button className="btn btn-ghost" onClick={reset}>Reiniciar</button>
          </div>
        </section>

        <aside className="ex-side">
          <div className="card ex-engine">
            <header className="ex-card-head">
              <h3>Motor</h3>
              <span className="faint small">{terminal ? 'Partida terminada' : ev && ev.fen === fen ? `Profundidad ${ev.depth}` : 'Pensando…'}</span>
              <span className="grow" />
              <span className="faint small">Mueve {turn === 'w' ? 'blancas' : 'negras'}</span>
            </header>
            <div className="ex-lines">
              {terminal && <p className="muted ex-pad">{terminal.cp === 0 ? 'Tablas.' : 'Jaque mate.'}</p>}
              {!terminal && lines.length === 0 && [0, 1, 2].map((i) => <div key={i} className="ex-line skeleton" />)}
              {lines.map((l, i) => (
                <div key={i} className="ex-line">
                  <span className={`score-pill ${scoreSide(l.score)}`}>{formatScore(l.score)}</span>
                  <div className="ex-pv">
                    {l.pv.map((san, k) => (
                      <button key={k} className="ex-pv-move" onClick={() => playSans(l.pv.slice(0, k + 1))}>
                        {pvLabel(fen, k, san)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card ex-moves">
            <header className="ex-card-head"><h3>Jugadas</h3><span className="faint small">{ply}/{steps.length}</span></header>
            {steps.length === 0
              ? <p className="muted ex-pad">Jugá una jugada en el tablero o hacé clic en una variante del motor.</p>
              : <MoveList moves={steps} ply={ply} onSelect={go} offset={startBlack ? 1 : 0} startNumber={startNum} />}
          </div>

          <div className="card ex-fen">
            <label className="field">FEN
              <input className="input" value={fenText} spellCheck={false} onChange={(e) => setFenText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadFen()} />
            </label>
            <div className="row">
              <button className="btn" onClick={loadFen}>Cargar</button>
              <button className="btn btn-ghost" onClick={() => void copyFen()}>Copiar</button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

const scoreSide = (s: Score) => ((s.mate !== undefined ? s.mate : s.cp ?? 0) >= 0 ? 'w' : 'b');

/** SAN prefixed with the move number when it starts a pair (or the first move shown). */
function pvLabel(fen: string, k: number, san: string): string {
  const [, turn, , , , num] = fen.split(' ');
  const white = (turn === 'w') === (k % 2 === 0);
  const n = Number(num) + (turn === 'b' ? Math.floor((k + 1) / 2) : Math.floor(k / 2));
  if (white) return `${n}.${san}`;
  return k === 0 ? `${n}...${san}` : san;
}
