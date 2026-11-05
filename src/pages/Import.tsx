import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { getSettings, saveSettings } from '../db/db';
import { fetchChesscomGames } from '../import/chesscom';
import { fetchLichessGames } from '../import/lichess';
import { pgnToGame, saveGames, splitPgn } from '../import/pgn';
import { IconImport, IconLibrary } from '../components/Icons';
import { useToast } from '../lib/toast';
import type { Game } from '../types';
import './Import.css';

type Tab = 'chesscom' | 'lichess' | 'pgn';
interface Summary { added: number; skipped: number; invalid?: number }

const MONTH_OPTIONS = [1, 2, 3, 6, 12];
const GAME_OPTIONS = [50, 100, 200, 500, 1000];

export default function ImportPage() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('chesscom');
  const [users, setUsers] = useState({ chesscom: '', lichess: '' });
  const [months, setMonths] = useState(3);
  const [max, setMax] = useState(200);
  const [pgnText, setPgnText] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ pct: number; label: string } | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getSettings().then((s) => setUsers({ chesscom: s.chesscomUser ?? '', lichess: s.lichessUser ?? '' }));
  }, []);

  const switchTab = (t: Tab) => {
    if (busy) return;
    setTab(t);
    setSummary(null);
    setProgress(null);
  };

  const finish = async (games: Game[], invalid = 0) => {
    const res = await saveGames(games);
    setSummary({ ...res, invalid });
    return res;
  };

  const runRemote = async () => {
    const kind = tab as 'chesscom' | 'lichess';
    const user = users[kind].trim();
    if (!user) {
      toast(`Ingresá tu usuario de ${kind === 'chesscom' ? 'Chess.com' : 'Lichess'}.`, 'error');
      return;
    }
    setBusy(true);
    setSummary(null);
    setProgress({ pct: 0, label: 'Conectando…' });
    try {
      let games: Game[];
      if (kind === 'chesscom') {
        games = await fetchChesscomGames(user, {
          months,
          onProgress: (p) =>
            setProgress({
              pct: p.total ? (p.done / p.total) * 100 : 0,
              label: `Mes ${p.done} de ${p.total} · ${p.games} partidas encontradas`,
            }),
        });
      } else {
        games = await fetchLichessGames(user, {
          max,
          onProgress: (p) =>
            setProgress({ pct: Math.min(100, (p.games / p.total) * 100), label: `${p.games} de ${p.total} partidas descargadas` }),
        });
      }
      setProgress({ pct: 100, label: 'Guardando…' });
      await finish(games);
      setProgress(null);
      await saveSettings(kind === 'chesscom' ? { chesscomUser: user } : { lichessUser: user });
    } catch (e) {
      toast((e as Error).message || 'No se pudo importar.', 'error');
      setProgress(null);
    } finally {
      setBusy(false);
    }
  };

  const importPgnText = async (text: string) => {
    const chunks = splitPgn(text);
    if (!chunks.length) {
      toast('No encontramos partidas en el PGN.', 'error');
      return;
    }
    setBusy(true);
    setSummary(null);
    try {
      const settings = await getSettings();
      const games: Game[] = [];
      let invalid = 0;
      for (let i = 0; i < chunks.length; i++) {
        const g = pgnToGame(chunks[i], 'pgn', { settings });
        if (g) games.push(g);
        else invalid++;
        if (i % 25 === 0) {
          setProgress({ pct: ((i + 1) / chunks.length) * 100, label: `Procesando ${i + 1} de ${chunks.length}…` });
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      if (!games.length) {
        toast('Ninguna partida del PGN es válida.', 'error');
        setProgress(null);
        return;
      }
      setProgress({ pct: 100, label: 'Guardando…' });
      await finish(games, invalid);
      setProgress(null);
      setPgnText('');
    } catch (e) {
      toast((e as Error).message || 'No se pudo importar el PGN.', 'error');
      setProgress(null);
    } finally {
      setBusy(false);
    }
  };

  const readFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => /\.(pgn|txt)$/i.test(f.name) || f.type.startsWith('text'));
    if (!list.length) {
      toast('Elegí un archivo .pgn.', 'error');
      return;
    }
    const texts = await Promise.all(list.map((f) => f.text()));
    await importPgnText(texts.join('\n\n'));
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!busy && e.dataTransfer.files.length) void readFiles(e.dataTransfer.files);
  };

  const loadSample = async () => {
    try {
      const res = await fetch('/sample.pgn');
      if (!res.ok) throw new Error();
      await importPgnText(await res.text());
    } catch {
      toast('No se pudo cargar el ejemplo.', 'error');
    }
  };

  const remote = tab !== 'pgn';
  const userVal = remote ? users[tab as 'chesscom' | 'lichess'] : '';

  return (
    <div className="page import-page">
      <div className="page-header">
        <div>
          <h1>Importar partidas</h1>
          <p>Traé tus partidas desde Chess.com, Lichess o un archivo PGN.</p>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {([['chesscom', 'Chess.com'], ['lichess', 'Lichess'], ['pgn', 'PGN']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`tab${tab === k ? ' active' : ''}`} onClick={() => switchTab(k)}>
            {l}
          </button>
        ))}
      </div>

      <div className="card card-pad import-card" key={tab}>
        {remote ? (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void runRemote();
            }}
          >
            <div className="import-grid">
              <label className="field">
                Usuario de {tab === 'chesscom' ? 'Chess.com' : 'Lichess'}
                <input
                  className="input"
                  value={userVal}
                  disabled={busy}
                  placeholder="tu_usuario"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setUsers({ ...users, [tab]: e.target.value })}
                />
              </label>
              {tab === 'chesscom' ? (
                <label className="field">
                  Período
                  <select className="select" value={months} disabled={busy} onChange={(e) => setMonths(Number(e.target.value))}>
                    {MONTH_OPTIONS.map((m) => (
                      <option key={m} value={m}>{m === 1 ? 'Último mes' : `Últimos ${m} meses`}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="field">
                  Cantidad de partidas
                  <select className="select" value={max} disabled={busy} onChange={(e) => setMax(Number(e.target.value))}>
                    {GAME_OPTIONS.map((m) => (
                      <option key={m} value={m}>Últimas {m}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div className="row">
              <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
                {busy ? <span className="spinner" /> : <IconImport width={18} height={18} />}
                {busy ? 'Importando…' : 'Importar'}
              </button>
              <span className="faint">Solo se importan partidas de ajedrez estándar.</span>
            </div>
          </form>
        ) : (
          <div className="stack">
            <div
              className={`dropzone${dragging ? ' dragging' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => !busy && fileRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click(); }}
            >
              <IconImport width={28} height={28} />
              <strong>Arrastrá un archivo .pgn acá</strong>
              <span className="muted">o hacé clic para elegirlo (puede tener varias partidas)</span>
              <input
                ref={fileRef}
                type="file"
                accept=".pgn,.txt,text/plain"
                multiple
                hidden
                onChange={(e) => { if (e.target.files) void readFiles(e.target.files); e.target.value = ''; }}
              />
            </div>
            <label className="field">
              O pegá el PGN
              <textarea
                className="textarea"
                value={pgnText}
                disabled={busy}
                placeholder={'[Event "..."]\n[White "..."]\n\n1. e4 e5 2. Nf3 ...'}
                onChange={(e) => setPgnText(e.target.value)}
              />
            </label>
            <div className="row">
              <button className="btn btn-primary btn-lg" disabled={busy || !pgnText.trim()} onClick={() => void importPgnText(pgnText)}>
                {busy ? <span className="spinner" /> : <IconImport width={18} height={18} />}
                Importar PGN
              </button>
              <button className="btn" disabled={busy} onClick={() => void loadSample()}>Cargar ejemplo</button>
            </div>
          </div>
        )}

        {progress && (
          <div className="import-progress">
            <div className="progress"><div style={{ width: `${progress.pct}%` }} /></div>
            <span className="muted">{progress.label}</span>
          </div>
        )}

        {summary && !busy && (
          <div className="import-summary">
            <div className="check">✓</div>
            <div className="grow">
              <strong>
                {summary.added} {summary.added === 1 ? 'partida nueva' : 'partidas nuevas'}
              </strong>
              <span className="muted">
                {summary.skipped > 0 ? `, ${summary.skipped} ya ${summary.skipped === 1 ? 'existía' : 'existían'}` : ''}
                {summary.invalid ? ` · ${summary.invalid} no válidas omitidas` : ''}
              </span>
            </div>
            <Link to="/" className="btn btn-primary"><IconLibrary width={18} height={18} />Ver mis partidas</Link>
          </div>
        )}
      </div>
    </div>
  );
}
