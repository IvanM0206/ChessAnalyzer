import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Chess } from 'chess.js';
import { db, getSettings } from '../db/db';
import type { AnalyzedMove, Classification, GameAnalysis, Settings } from '../types';
import { DEFAULT_SETTINGS } from '../types';
import { analyzeGame, ALL_CLASSES, parseGame } from '../engine/analyzeGame';
import { Board } from '../components/Board';
import { EvalBar } from '../components/EvalBar';
import { EvalGraph } from '../components/EvalGraph';
import { MoveList } from '../components/MoveList';
import { CLASS_META, ClassIcon } from '../components/ClassIcon';
import { IconChevronLeft, IconChevronRight, IconFirst, IconFlip, IconLast, IconAnalysis } from '../components/Icons';
import { formatScore } from '../lib/format';
import { fenKey } from '../analysis/openings';
import { getMoves } from '../repertoire/repertoire';
import { playMoveSound } from '../lib/sound';
import { useToast } from '../lib/toast';
import { explainMove } from '../analysis/tactics';
import { buildAnnotatedPgn, downloadText } from '../lib/annotatedPgn';
import './Review.css';

const GOOD = new Set<Classification>(['brilliant', 'great', 'best', 'book', 'forced']);
const SUMMARY_ROWS: Classification[] = ALL_CLASSES.filter((c) => c !== 'forced');

export default function ReviewPage() {
  const { id = '' } = useParams();
  const toast = useToast();
  const game = useLiveQuery(() => db.games.get(id), [id]);
  const stored = useLiveQuery(() => db.analyses.get(id), [id]);
  const [analysis, setAnalysis] = useState<GameAnalysis | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [mode, setMode] = useState<'summary' | 'review'>('summary');
  const [ply, setPly] = useState(0);
  const [flipped, setFlipped] = useState<boolean | null>(null);
  const [showBest, setShowBest] = useState(false);

  const curForRep = analysis?.moves[ply - 1];
  const repMoves = useLiveQuery(
    () => (curForRep && game?.userColor && (curForRep.repertoire === 'deviated' || curForRep.repertoire === 'opponent-left')
      ? getMoves(game.userColor, fenKey(curForRep.fenBefore)) : Promise.resolve([])),
    [curForRep?.fenBefore, curForRep?.repertoire, game?.userColor],
  );

  useEffect(() => { void getSettings().then(setSettings); }, []);
  useEffect(() => { if (stored) setAnalysis(stored); }, [stored]);

  const raw = useMemo(() => {
    if (!game) return [];
    try { return parseGame(game.pgn); } catch { return []; }
  }, [game]);
  const moves: AnalyzedMove[] | null = analysis?.moves ?? null;
  const total = raw.length;

  const go = useCallback((p: number, sound = true) => {
    setPly((cur) => {
      const next = Math.max(0, Math.min(total, p));
      if (sound && settings.soundOn && next === cur + 1 && raw[next - 1]) playMoveSound(raw[next - 1].san.includes('x'));
      return next;
    });
    setShowBest(false);
  }, [total, raw, settings.soundOn]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'ArrowRight') { e.preventDefault(); go(ply + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(ply - 1); }
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(total);
      else if (e.key === 'f') setFlipped((f) => !f);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, ply, total]);

  const runAnalysis = async () => {
    if (!game) return;
    setProgress({ done: 0, total: total + 1 });
    try {
      const a = await analyzeGame(game, (done, t) => setProgress({ done, total: t }));
      setAnalysis(a);
      toast('Análisis completo');
    } catch (e) {
      if ((e as Error).message !== 'cancelled') toast(`Error al analizar: ${(e as Error).message}`, 'error');
    } finally { setProgress(null); }
  };

  if (game === undefined) return <div className="page" />;
  if (game === null || !game) return <div className="page empty"><h2>Partida no encontrada</h2><Link className="btn" to="/">Volver</Link></div>;

  const userBlack = game.userColor === 'b';
  const isFlipped = flipped ?? userBlack;
  const orientation = isFlipped ? 'black' : 'white';
  const fen = ply === 0 ? (raw[0]?.before ?? new Chess().fen()) : raw[ply - 1].after;
  const cur = moves && ply > 0 ? moves[ply - 1] : null;
  const scoreNow = moves ? (ply === 0 ? moves[0]?.evalBefore.lines[0]?.score : cur?.evalAfter.lines[0]?.score ?? (cur ? matedScore(cur) : undefined)) : undefined;
  const lastMove = ply > 0 ? { from: raw[ply - 1].uci.slice(0, 2), to: raw[ply - 1].uci.slice(2, 4), classification: mode === 'review' ? cur?.classification : undefined } : undefined;
  const bestArrow = cur && cur.bestUci && !GOOD.has(cur.classification) && (settings.showArrows || showBest)
    ? [{ from: cur.bestUci.slice(0, 2), to: cur.bestUci.slice(2, 4), color: 'rgba(124, 179, 66, .85)' }] : [];

  const top = isFlipped ? { name: game.white, elo: game.whiteElo, color: 'w' as const } : { name: game.black, elo: game.blackElo, color: 'b' as const };
  const bottom = isFlipped ? { name: game.black, elo: game.blackElo, color: 'b' as const } : { name: game.white, elo: game.whiteElo, color: 'w' as const };

  return (
    <div className="page review-page">
      <div className="review">
        <section className="board-col">
          <PlayerStrip {...top} acc={analysis ? analysis[top.color === 'w' ? 'white' : 'black'].accuracy : undefined} me={game.userColor === top.color} />
          <div className="board-row">
            <EvalBar score={scoreNow} flipped={isFlipped} />
            <div className="board-wrap">
              <Board fen={fen} orientation={orientation} theme={settings.boardTheme} lastMove={lastMove} arrows={mode === 'review' ? bestArrow : []} />
            </div>
          </div>
          <PlayerStrip {...bottom} acc={analysis ? analysis[bottom.color === 'w' ? 'white' : 'black'].accuracy : undefined} me={game.userColor === bottom.color} />
        </section>

        <aside className="panel card">
          <header className="panel-head">
            <IconAnalysis />
            <h2>Revisión de partida</h2>
            {analysis && (
              <div className="tabs small">
                <button className={`tab${mode === 'summary' ? ' active' : ''}`} onClick={() => setMode('summary')}>Resumen</button>
                <button className={`tab${mode === 'review' ? ' active' : ''}`} onClick={() => { setMode('review'); if (ply === 0) go(1, false); }}>Jugadas</button>
              </div>
            )}
          </header>

          {!analysis && (
            <div className="panel-body center">
              <div className="intro-icon"><IconAnalysis /></div>
              <h2>{game.white} vs {game.black}</h2>
              <p className="muted">{[game.date, game.openingName, `${Math.ceil(total / 2)} jugadas`].filter(Boolean).join(' · ')}</p>
              {progress ? (
                <div className="analyzing">
                  <div className="progress"><div style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
                  <p className="muted">Analizando posición {progress.done} de {progress.total}… (profundidad {settings.depth})</p>
                </div>
              ) : (
                <button className="btn btn-primary btn-lg full" onClick={runAnalysis}>Analizar partida</button>
              )}
              <MoveList moves={raw} ply={ply} onSelect={(p) => go(p)} />
            </div>
          )}

          {analysis && mode === 'summary' && moves && (
            <div className="panel-body">
              <EvalGraph moves={moves} ply={ply} onSelect={(p) => go(p, false)} />
              <div className="acc-row">
                <AccCard name={game.white} acc={analysis.white.accuracy} light />
                <span className="acc-label">Precisión</span>
                <AccCard name={game.black} acc={analysis.black.accuracy} />
              </div>
              <div className="class-table">
                {SUMMARY_ROWS.map((c) => (
                  <div className="class-row" key={c}>
                    <span className="cnt" style={{ color: analysis.white.counts[c] ? `var(--c-${c})` : undefined }}>{analysis.white.counts[c]}</span>
                    <span className="lbl"><ClassIcon c={c} size={20} />{CLASS_META[c].label}</span>
                    <span className="cnt" style={{ color: analysis.black.counts[c] ? `var(--c-${c})` : undefined }}>{analysis.black.counts[c]}</span>
                  </div>
                ))}
              </div>
              {analysis.openingName && <p className="opening"><span className="faint">Apertura</span> {analysis.eco} · {analysis.openingName}</p>}
              <RepertoireSummary moves={moves} />
              <button className="btn btn-primary btn-lg full" onClick={() => { setMode('review'); go(Math.max(ply, 1), false); }}>Empezar revisión</button>
              <div className="row">
                <button className="btn grow" onClick={() => downloadText(`${game.white}-vs-${game.black}.pgn`.replace(/[^\w.-]+/g, '_'), buildAnnotatedPgn(game, analysis))}>Exportar PGN anotado</button>
                <button className="btn btn-ghost" onClick={() => { void db.analyses.delete(game.id); setAnalysis(null); }}>Re-analizar</button>
              </div>
            </div>
          )}

          {analysis && mode === 'review' && moves && (
            <div className="panel-body review-body">
              <Feedback move={cur} showBest={showBest} onShowBest={() => setShowBest((s) => !s)} repMoves={repMoves ?? []} fen={fen} />
              <EvalGraph moves={moves} ply={ply} onSelect={(p) => go(p, false)} />
              <MoveList moves={moves} ply={ply} onSelect={(p) => go(p)} />
            </div>
          )}

          <footer className="nav-bar">
            <div className="row">
              <button className="btn btn-ghost btn-icon" onClick={() => setFlipped(!isFlipped)} title="Girar tablero (F)"><IconFlip /></button>
              <Link className="btn btn-ghost nav-analyze" to={`/analysis?fen=${encodeURIComponent(fen)}`} title="Abrir esta posición en el análisis libre">Analizar</Link>
            </div>
            <div className="row">
              <button className="btn btn-icon" onClick={() => go(0)} title="Inicio"><IconFirst /></button>
              <button className="btn btn-icon nav-main" onClick={() => go(ply - 1)} title="Anterior (←)"><IconChevronLeft /></button>
              <button className="btn btn-icon nav-main" onClick={() => go(ply + 1)} title="Siguiente (→)"><IconChevronRight /></button>
              <button className="btn btn-icon" onClick={() => go(total)} title="Final"><IconLast /></button>
            </div>
            <span className="faint ply-count">{ply}/{total}</span>
          </footer>
        </aside>
      </div>
    </div>
  );
}

/** Terminal positions have no engine lines: represent checkmate as a huge cp score. */
function matedScore(m: AnalyzedMove) { return m.winAfter === 100 ? { cp: m.color === 'w' ? 100000 : -100000 } : undefined; }

function RepertoireSummary({ moves }: { moves: AnalyzedMove[] }) {
  const inCount = moves.filter((m) => m.repertoire === 'in').length;
  const exit = moves.find((m) => m.repertoire === 'deviated' || m.repertoire === 'opponent-left');
  if (!inCount && !exit) return null;
  const n = Math.ceil(inCount / 2) || 1;
  const exitNum = exit ? Math.ceil(exit.ply / 2) : 0;
  return (
    <p className="opening rep-summary">
      <span className="faint">Repertorio</span>{' '}
      {inCount ? `seguiste tu preparación hasta la jugada ${n}` : 'te desviaste desde la primera jugada'}
      {exit && <span className="faint"> · {exit.repertoire === 'deviated' ? `te desviaste en la ${exitNum}` : `tu rival salió en la ${exitNum}`}</span>}
    </p>
  );
}

function PlayerStrip({ name, elo, color, acc, me }: { name: string; elo?: number; color: 'w' | 'b'; acc?: number; me: boolean }) {
  return (
    <div className="player-strip">
      <span className={`avatar ${color}`}>{name.slice(0, 1).toUpperCase()}</span>
      <span className={`pname${me ? ' me' : ''}`}>{name}</span>
      {elo ? <span className="faint">({elo})</span> : null}
      {acc !== undefined && <span className="badge acc-badge">{acc.toFixed(1)}%</span>}
    </div>
  );
}

function AccCard({ name, acc, light }: { name: string; acc: number; light?: boolean }) {
  return (
    <div className="acc-card">
      <span className="acc-name">{name}</span>
      <span className={`acc-num${light ? ' light' : ''}`}>{acc.toFixed(1)}</span>
    </div>
  );
}

function Feedback({ move, showBest, onShowBest, repMoves, fen }: { move: AnalyzedMove | null; showBest: boolean; onShowBest: () => void; repMoves: { san: string }[]; fen: string }) {
  if (!move) return <div className="feedback"><p className="muted">Posición inicial. Usá → para avanzar.</p></div>;
  const meta = CLASS_META[move.classification];
  const good = GOOD.has(move.classification) || move.classification === 'excellent' || move.classification === 'good';
  const line = move.evalBefore.lines[0];
  return (
    <div className="feedback" key={move.ply} style={{ ['--fc' as string]: `var(--c-${move.classification})` }}>
      <div className="feedback-head">
        <ClassIcon c={move.classification} size={30} pop />
        <div className="grow">
          <div className="feedback-title"><b>{move.san}</b> {meta.phrase}</div>
          {move.openingName && move.classification === 'book' && <div className="faint small">{move.openingName}</div>}
        </div>
        <span className={`score-pill ${(move.evalAfter.lines[0]?.score.cp ?? (move.color === 'w' ? 1 : -1)) >= 0 ? 'w' : 'b'}`}>{formatScore(move.evalAfter.lines[0]?.score)}</span>
      </div>
      {explainMove(move).length > 0 && (
        <div className="tactic-tags">{explainMove(move).map((t) => <span key={t} className="tactic-tag">{t}</span>)}</div>
      )}
      {!good && move.bestSan && (
        <div className="best-line">
          <span className="muted">La mejor era</span>
          <button className="best-btn" onClick={onShowBest}><ClassIcon c="best" size={16} /> {move.bestSan}</button>
          {showBest && line && <div className="pv faint">{line.pv.slice(0, 8).join(' ')}</div>}
        </div>
      )}
      {move.repertoire === 'deviated' && (
        <div className="rep-banner deviated">
          <b>Te desviaste de tu repertorio</b>
          <span>{repMoves.length ? <>tu jugada preparada era {repMoves.map((r, i) => <span key={i}>{i > 0 && ' o '}<b className="rep-san-tag">{r.san}</b></span>)}</> : 'esta posición estaba en tu repertorio'}</span>
        </div>
      )}
      {move.repertoire === 'opponent-left' && (
        <div className="rep-banner left">
          <b>Tu rival salió de tu repertorio</b>
          {repMoves.length > 0 && <span>esperabas {repMoves.map((r) => r.san).join(' o ')}</span>}
        </div>
      )}
      <Link className="analyze-link" to={`/analysis?fen=${encodeURIComponent(fen)}`}>Analizar esta posición →</Link>
    </div>
  );
}
