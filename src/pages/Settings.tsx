import { useEffect, useRef, useState } from 'react';
import { db, getSettings, saveSettings } from '../db/db';
import { detectUserColor } from '../import/pgn';
import { useToast } from '../lib/toast';
import { PIECE_SETS, pieceUrl } from '../components/pieceSets';
import { DEFAULT_SETTINGS, DEFAULT_THRESHOLDS, type ClassificationThresholds, type Settings } from '../types';
import './Settings.css';

const THRESHOLD_FIELDS: { key: keyof ClassificationThresholds; label: string; hint: string }[] = [
  { key: 'excellent', label: 'Excelente', hint: 'Pérdida máxima' },
  { key: 'good', label: 'Buena', hint: 'Pérdida máxima' },
  { key: 'inaccuracy', label: 'Imprecisión', hint: 'Pérdida máxima' },
  { key: 'mistake', label: 'Error', hint: 'Pérdida máxima' },
  { key: 'greatGap', label: 'Gran jugada', hint: 'Ventaja vs. 2ª línea' },
];

const THEMES = [
  { id: 'green', label: 'Verde', light: '#eeeed2', dark: '#769656' },
  { id: 'brown', label: 'Marrón', light: '#f0d9b5', dark: '#b58863' },
  { id: 'blue', label: 'Azul', light: '#dee3e6', dark: '#8ca2ad' },
] as const;

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div className="set-row">
      <div className="grow"><strong>{label}</strong>{hint && <div className="muted set-hint">{hint}</div>}</div>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`switch${checked ? ' on' : ''}`} onClick={() => onChange(!checked)}>
        <span className="switch-knob" />
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const toast = useToast();
  const [s, setS] = useState<Settings | null>(null);
  const [recolor, setRecolor] = useState(false);
  const [confirm, setConfirm] = useState<'cache' | 'all' | null>(null);
  const saved = useRef<Pick<Settings, 'chesscomUser' | 'lichessUser'>>({});

  useEffect(() => {
    getSettings().then((v) => {
      setS(v);
      saved.current = { chesscomUser: v.chesscomUser, lichessUser: v.lichessUser };
    });
  }, []);

  if (!s) return <div className="page"><div className="card card-pad skeleton-block" /></div>;

  const update = (patch: Partial<Settings>) => {
    setS((cur) => (cur ? { ...cur, ...patch } : cur));
    void saveSettings(patch);
  };

  const commitUsers = (patch: Partial<Settings>) => {
    const next = { ...s, ...patch };
    const changed =
      (next.chesscomUser ?? '') !== (saved.current.chesscomUser ?? '') ||
      (next.lichessUser ?? '') !== (saved.current.lichessUser ?? '');
    setRecolor(changed);
    void saveSettings({ chesscomUser: next.chesscomUser?.trim(), lichessUser: next.lichessUser?.trim() });
  };

  const recompute = async () => {
    const cur = await getSettings();
    let n = 0;
    await db.games.toCollection().modify((g) => {
      const c = detectUserColor(g, cur);
      if (c !== g.userColor) n++;
      g.userColor = c;
    });
    saved.current = { chesscomUser: cur.chesscomUser, lichessUser: cur.lichessUser };
    setRecolor(false);
    toast(`Listo: ${n} ${n === 1 ? 'partida actualizada' : 'partidas actualizadas'}.`);
  };

  const setThreshold = (k: keyof ClassificationThresholds, v: number) =>
    update({ thresholds: { ...s.thresholds, [k]: Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0 } });

  const exportPgn = async () => {
    const games = await db.games.toArray();
    if (!games.length) return toast('No hay partidas para exportar.', 'error');
    games.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const blob = new Blob([games.map((g) => g.pgn.trim()).join('\n\n\n') + '\n'], { type: 'application/x-chess-pgn' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `chess-analyzer-${new Date().toISOString().slice(0, 10)}.pgn`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`${games.length} partidas exportadas.`);
  };

  const clearCache = async () => {
    await db.transaction('rw', db.evalCache, db.analyses, db.games, async () => {
      await db.evalCache.clear();
      await db.analyses.clear();
      await db.games.toCollection().modify({ analyzed: false });
    });
    setConfirm(null);
    toast('Caché de análisis borrada.');
  };

  const wipeAll = async () => {
    await db.transaction('rw', db.evalCache, db.analyses, db.games, db.settings, async () => {
      await Promise.all([db.evalCache.clear(), db.analyses.clear(), db.games.clear(), db.settings.clear()]);
    });
    setS({ ...DEFAULT_SETTINGS });
    saved.current = {};
    setRecolor(false);
    setConfirm(null);
    toast('Se borraron todos los datos.');
  };

  return (
    <div className="page settings-page">
      <div className="page-header">
        <div><h1>Configuración</h1><p>Los cambios se guardan automáticamente.</p></div>
      </div>

      <section className="card card-pad set-section">
        <h2>Cuentas</h2>
        <p className="muted set-hint">Se usan para saber qué lado jugaste en cada partida.</p>
        <div className="set-grid">
          <label className="field">Usuario de Chess.com
            <input className="input" value={s.chesscomUser ?? ''} placeholder="usuario" spellCheck={false}
              onChange={(e) => setS({ ...s, chesscomUser: e.target.value })}
              onBlur={() => commitUsers({})} />
          </label>
          <label className="field">Usuario de Lichess
            <input className="input" value={s.lichessUser ?? ''} placeholder="usuario" spellCheck={false}
              onChange={(e) => setS({ ...s, lichessUser: e.target.value })}
              onBlur={() => commitUsers({})} />
          </label>
        </div>
        {recolor && (
          <div className="set-banner">
            <span>Cambiaste tus usuarios. ¿Querés recalcular de qué lado jugaste en todas las partidas?</span>
            <button className="btn btn-primary" onClick={() => void recompute()}>Recalcular</button>
            <button className="btn btn-ghost" onClick={() => setRecolor(false)}>Ahora no</button>
          </div>
        )}
      </section>

      <section className="card card-pad set-section">
        <h2>Motor</h2>
        <div className="set-slider">
          <div className="row"><strong className="grow">Profundidad</strong><span className="set-value">{s.depth}</span></div>
          <input type="range" min={10} max={24} step={1} value={s.depth} onChange={(e) => update({ depth: Number(e.target.value) })} />
          <div className="muted set-hint">Más profundidad da un análisis más preciso pero tarda más. 16 es un buen equilibrio; 20 o más puede ser lento en el navegador.</div>
        </div>
        <div className="set-row">
          <div className="grow"><strong>Variantes (MultiPV)</strong><div className="muted set-hint">Líneas que calcula el motor por posición.</div></div>
          <div className="tabs">
            {[1, 2, 3].map((n) => (
              <button key={n} className={`tab${s.multiPv === n ? ' active' : ''}`} onClick={() => update({ multiPv: n })}>{n}</button>
            ))}
          </div>
        </div>
      </section>

      <section className="card card-pad set-section">
        <div className="row">
          <h2 className="grow">Clasificación de jugadas</h2>
          <button className="btn btn-ghost" onClick={() => update({ thresholds: { ...DEFAULT_THRESHOLDS } })}>Restaurar valores por defecto</button>
        </div>
        <p className="muted set-hint">Umbrales de pérdida de probabilidad esperada (escala 0 a 1). Se aplican a los próximos análisis.</p>
        <div className="set-thresholds">
          {THRESHOLD_FIELDS.map((t) => (
            <label key={t.key} className="field">{t.label}
              <input className="input" type="number" min={0} max={1} step={0.01} value={s.thresholds[t.key]}
                onChange={(e) => setThreshold(t.key, e.target.valueAsNumber)} />
              <span className="faint set-hint">{t.hint}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="card card-pad set-section">
        <h2>Tablero y sonido</h2>
        <div className="set-themes">
          {THEMES.map((t) => (
            <button key={t.id} className={`theme-opt${s.boardTheme === t.id ? ' active' : ''}`} onClick={() => update({ boardTheme: t.id })} aria-pressed={s.boardTheme === t.id}>
              <span className="swatch" style={{ ['--l' as string]: t.light, ['--d' as string]: t.dark }}>
                <i /><i /><i /><i />
              </span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        <div className="set-row"><div className="grow"><strong>Piezas</strong><div className="muted set-hint">Estilo de las piezas del tablero.</div></div></div>
        <div className="set-themes">
          {PIECE_SETS.map((p) => (
            <button key={p.id} className={`theme-opt${s.pieceSet === p.id ? ' active' : ''}`} onClick={() => update({ pieceSet: p.id })} aria-pressed={s.pieceSet === p.id}>
              <span className="piece-prev"><img src={pieceUrl(p.id, 'wN')} alt="" /><img src={pieceUrl(p.id, 'bQ')} alt="" /></span>
              <span>{p.label}</span>
            </button>
          ))}
        </div>
        <Toggle checked={s.showArrows} onChange={(v) => update({ showArrows: v })} label="Mostrar flechas" hint="Flecha con la mejor jugada del motor." />
        <Toggle checked={s.soundOn} onChange={(v) => update({ soundOn: v })} label="Sonidos" hint="Sonido al mover las piezas." />
      </section>

      <section className="card card-pad set-section">
        <h2>Datos</h2>
        <div className="set-row">
          <div className="grow"><strong>Exportar partidas</strong><div className="muted set-hint">Descargá todas tus partidas en un único archivo PGN.</div></div>
          <button className="btn" onClick={() => void exportPgn()}>Exportar PGN</button>
        </div>
        <div className="set-row">
          <div className="grow"><strong>Borrar caché de análisis</strong><div className="muted set-hint">Elimina los análisis y evaluaciones guardadas. Tus partidas se conservan.</div></div>
          {confirm === 'cache' ? (
            <span className="row"><button className="btn btn-ghost" onClick={() => setConfirm(null)}>Cancelar</button><button className="btn btn-danger" onClick={() => void clearCache()}>Confirmar</button></span>
          ) : <button className="btn" onClick={() => setConfirm('cache')}>Borrar caché</button>}
        </div>
        <div className="set-row">
          <div className="grow"><strong>Borrar todo</strong><div className="muted set-hint">Elimina partidas, análisis y configuración. No se puede deshacer.</div></div>
          {confirm === 'all' ? (
            <span className="row"><button className="btn btn-ghost" onClick={() => setConfirm(null)}>Cancelar</button><button className="btn btn-danger" onClick={() => void wipeAll()}>Sí, borrar todo</button></span>
          ) : <button className="btn btn-danger" onClick={() => setConfirm('all')}>Borrar todo</button>}
        </div>
      </section>
    </div>
  );
}
