import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Chess } from 'chess.js';
import { db, getSettings } from '../db/db';
import type { Color, RepertoireMove, Settings } from '../types';
import { DEFAULT_SETTINGS } from '../types';
import { fenKey, loadOpenings, lookupOpening } from '../analysis/openings';
import { Board } from '../components/Board';
import { IconRepertoire, IconTrash } from '../components/Icons';
import { playMoveSound } from '../lib/sound';
import { useToast } from '../lib/toast';
import {
  START_FEN, addMoveAt, buildTree, countSublines, deleteSubtree, exportRepertoirePgn, importRepertoirePgn,
} from '../repertoire/repertoire';
import './Repertoire.css';

interface Step { san: string; uci: string; fen: string }

export default function RepertoirePage() {
  const toast = useToast();
  const [side, setSide] = useState<Color>('w');
  const [line, setLine] = useState<Step[]>([]);
  const [edit, setEdit] = useState(true);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [openingsReady, setOpeningsReady] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [commentId, setCommentId] = useState<string | null>(null);

  useEffect(() => { void getSettings().then(setSettings); void loadOpenings().then(() => setOpeningsReady(true)); }, []);

  const edges = useLiveQuery(() => db.repertoire.where('side').equals(side).toArray(), [side]);
  const tree = useMemo(() => buildTree(edges ?? []), [edges]);

  const fen = line.length ? line[line.length - 1].fen : START_FEN;
  const key = fenKey(fen);
  const here = useMemo(
    () => (tree.children.get(key) ?? []).slice().sort((a, b) => a.createdAt - b.createdAt),
    [tree, key],
  );
  const opening = useMemo(() => {
    if (!openingsReady) return null;
    const fens = [START_FEN, ...line.map((s) => s.fen)];
    for (let i = fens.length - 1; i >= 0; i--) { const o = lookupOpening(fens[i]); if (o) return o; }
    return null;
  }, [line, openingsReady]);

  const switchSide = (s: Color) => { setSide(s); setLine([]); setConfirmId(null); setCommentId(null); };

  const playUci = (uci: string, sound = true) => {
    const c = new Chess(fen);
    try {
      const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      if (sound && settings.soundOn) playMoveSound(m.isCapture());
      setLine((l) => [...l, { san: m.san, uci, fen: c.fen() }]);
      return true;
    } catch { return false; }
  };

  const onDrop = (from: string, to: string) => {
    const c = new Chess(fen);
    let uci: string;
    try {
      const m = c.move({ from, to, promotion: 'q' });
      uci = m.from + m.to + (m.promotion ?? '');
    } catch { return false; }
    const known = here.some((e) => e.uci === uci);
    if (!edit && !known) { toast('Esa jugada no está en tu repertorio', 'error'); return false; }
    if (edit && !known) void addMoveAt(side, fen, uci);
    return playUci(uci);
  };

  const goTo = (n: number) => { setLine((l) => l.slice(0, n)); setConfirmId(null); };

  const remove = async (e: RepertoireMove) => {
    const n = await deleteSubtree(side, fen, e.uci);
    setConfirmId(null);
    toast(n > 1 ? `Se borraron ${n} jugadas` : 'Jugada borrada');
  };

  const exportPgn = async () => {
    const pgn = await exportRepertoirePgn(side);
    const url = URL.createObjectURL(new Blob([pgn], { type: 'application/x-chess-pgn' }));
    const a = document.createElement('a');
    a.href = url; a.download = `repertorio-${side === 'w' ? 'blancas' : 'negras'}.pgn`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const arrows = here.map((e) => {
    const mine = new Chess(fen).turn() === side;
    return { from: e.uci.slice(0, 2), to: e.uci.slice(2, 4), color: mine ? 'rgba(111, 174, 79, .85)' : 'rgba(91, 143, 217, .8)' };
  });
  const lastMove = line.length ? { from: line[line.length - 1].uci.slice(0, 2), to: line[line.length - 1].uci.slice(2, 4) } : undefined;
  const myTurn = new Chess(fen).turn() === side;
  const total = edges?.length ?? 0;
  const loading = edges === undefined;

  return (
    <div className="page rep-page">
      <div className="page-header">
        <div>
          <h1>Repertorio</h1>
          <p>Armá tus líneas de apertura jugándolas en el tablero. Después las vas a ver marcadas en la revisión de tus partidas.</p>
        </div>
        <div className="tabs">
          <button className={`tab${side === 'w' ? ' active' : ''}`} onClick={() => switchSide('w')}>Con blancas</button>
          <button className={`tab${side === 'b' ? ' active' : ''}`} onClick={() => switchSide('b')}>Con negras</button>
        </div>
      </div>

      <div className="rep-layout">
        <section className="rep-board-col">
          <div className="rep-board"><Board fen={fen} orientation={side === 'w' ? 'white' : 'black'} theme={settings.boardTheme} lastMove={lastMove} arrows={arrows} onDrop={onDrop} /></div>
          <div className="rep-board-bar">
            <label className="switch">
              <input type="checkbox" checked={edit} onChange={(e) => setEdit(e.target.checked)} />
              <span className="switch-track"><span className="switch-dot" /></span>
              <span>Modo edición</span>
            </label>
            <span className="faint small">{edit ? 'Cada jugada que hagas se guarda en el repertorio.' : 'Solo navegás: podés jugar las jugadas del repertorio.'}</span>
          </div>
        </section>

        <aside className="card rep-panel">
          <header className="rep-head">
            <IconRepertoire />
            <div className="grow">
              <h2>{side === 'w' ? 'Repertorio con blancas' : 'Repertorio con negras'}</h2>
              <div className="faint small">{total} {total === 1 ? 'jugada guardada' : 'jugadas guardadas'}</div>
            </div>
          </header>

          <div className="rep-body">
            <nav className="crumbs" aria-label="Línea actual">
              <button className={`crumb${line.length === 0 ? ' active' : ''}`} onClick={() => goTo(0)}>Inicio</button>
              {line.map((s, i) => (
                <button key={i} className={`crumb${i === line.length - 1 ? ' active' : ''}`} onClick={() => goTo(i + 1)}>
                  {i % 2 === 0 && <span className="crumb-n">{i / 2 + 1}.</span>}{s.san}
                </button>
              ))}
            </nav>

            <div className="rep-opening">
              <span className="faint">Apertura</span>
              <b>{opening ? `${opening.eco} · ${opening.name}` : 'Sin nombre en esta posición'}</b>
            </div>

            <div className="rep-section-title">
              <h3>{myTurn ? 'Tus jugadas preparadas' : 'Respuestas del rival que cubrís'}</h3>
              <span className="faint small">{here.length}</span>
            </div>

            {!loading && here.length === 0 && (total === 0 && line.length === 0 ? (
              <div className="empty rep-empty">
                <div className="rep-empty-icon"><IconRepertoire /></div>
                <h2>Tu repertorio está vacío</h2>
                <p>Jugá en el tablero las jugadas que querés tener preparadas, tanto las tuyas como las respuestas del rival que esperás. Por ejemplo <b>1.e4 e5 2.Nf3</b>.</p>
                <p>También podés traer líneas ya armadas con <b>Importar PGN</b> (se aceptan variantes).</p>
              </div>
            ) : (
              <p className="muted rep-none">{edit ? 'No hay jugadas guardadas acá. Jugá una en el tablero para agregarla.' : 'No hay jugadas guardadas en esta posición.'}</p>
            ))}

            <ul className="rep-moves">
              {here.map((e) => {
                const subs = countSublines(tree, e);
                const confirming = confirmId === e.id;
                return (
                  <li key={e.id} className="rep-move">
                    <div className="rep-move-main">
                      <button className="rep-san" onClick={() => playUci(e.uci)} title="Jugar esta jugada">{e.san}</button>
                      <span className="badge">{subs} {subs === 1 ? 'línea' : 'líneas'}</span>
                      <span className="grow" />
                      {confirming ? (
                        <span className="confirm">
                          <span className="small">¿Borrar{subs > 1 ? ` con ${subs} líneas` : ''}?</span>
                          <button className="btn btn-icon danger" onClick={() => void remove(e)}>Sí</button>
                          <button className="btn btn-ghost btn-icon" onClick={() => setConfirmId(null)}>No</button>
                        </span>
                      ) : (
                        <>
                          <button className="btn btn-ghost btn-icon small-btn" title="Comentario" onClick={() => setCommentId(commentId === e.id ? null : e.id)}>✎</button>
                          <button className="btn btn-ghost btn-icon small-btn" title="Borrar" onClick={() => setConfirmId(e.id)}><IconTrash /></button>
                        </>
                      )}
                    </div>
                    {commentId === e.id
                      ? <CommentEditor value={e.comment ?? ''} onDone={(v) => { void db.repertoire.update(e.id, { comment: v.trim() || undefined }); setCommentId(null); }} />
                      : e.comment && <button className="rep-comment" onClick={() => setCommentId(e.id)}>{e.comment}</button>}
                  </li>
                );
              })}
            </ul>
          </div>

          <footer className="rep-foot">
            <button className="btn" onClick={() => setImportOpen(true)}>Importar PGN</button>
            <button className="btn" disabled={!total} onClick={() => void exportPgn()}>Exportar PGN</button>
            <span className="grow" />
            <button className="btn btn-ghost" disabled={!line.length} onClick={() => goTo(0)}>Volver al inicio</button>
          </footer>
        </aside>
      </div>

      {importOpen && <ImportModal side={side} onClose={() => setImportOpen(false)} onDone={(r) => { toast(`Se importaron ${r.moves} jugadas de ${r.lines} líneas`); setImportOpen(false); }} />}
    </div>
  );
}

function CommentEditor({ value, onDone }: { value: string; onDone: (v: string) => void }) {
  const [v, setV] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <input
      ref={ref} className="input rep-comment-input" value={v} placeholder="Escribí una nota para esta jugada…"
      onChange={(e) => setV(e.target.value)} onBlur={() => onDone(v)}
      onKeyDown={(e) => { if (e.key === 'Enter') onDone(v); else if (e.key === 'Escape') onDone(value); }}
    />
  );
}

function ImportModal({ side, onClose, onDone }: { side: Color; onClose: () => void; onDone: (r: { lines: number; moves: number }) => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const run = async () => {
    setBusy(true);
    try {
      const r = await importRepertoirePgn(side, text);
      if (!r.moves) toast('No se encontraron jugadas válidas en el PGN', 'error'); else onDone(r);
    } finally { setBusy(false); }
  };
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="card modal" role="dialog" aria-label="Importar PGN" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Importar PGN al repertorio {side === 'w' ? 'de blancas' : 'de negras'}</h2>
        <p className="muted">Pegá una o varias partidas. Las variantes entre paréntesis también se importan.</p>
        <textarea className="textarea" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={'1. e4 e5 2. Nf3 Nc6 (2... d6 3. d4) 3. Bb5 *'} />
        <div className="row modal-actions">
          <label className="btn btn-ghost file-btn">
            Elegir archivo…
            <input type="file" accept=".pgn,.txt" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} />
          </label>
          <span className="grow" />
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={!text.trim() || busy} onClick={() => void run()}>Importar</button>
        </div>
      </div>
    </div>
  );
}
