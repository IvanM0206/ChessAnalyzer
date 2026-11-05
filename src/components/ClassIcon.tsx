import type { Classification } from '../types';

export const CLASS_META: Record<Classification, { label: string; glyph: string; phrase: string }> = {
  brilliant: { label: 'Brillante', glyph: '!!', phrase: 'es brillante' },
  great: { label: 'Gran jugada', glyph: '!', phrase: 'es una gran jugada' },
  best: { label: 'Mejor', glyph: '★', phrase: 'es la mejor jugada' },
  excellent: { label: 'Excelente', glyph: '👍', phrase: 'es excelente' },
  good: { label: 'Buena', glyph: '✓', phrase: 'es buena' },
  book: { label: 'Teoría', glyph: '📖', phrase: 'es una jugada de teoría' },
  forced: { label: 'Forzada', glyph: '→', phrase: 'es forzada' },
  inaccuracy: { label: 'Imprecisión', glyph: '?!', phrase: 'es una imprecisión' },
  mistake: { label: 'Error', glyph: '?', phrase: 'es un error' },
  miss: { label: 'Oportunidad perdida', glyph: '✕', phrase: 'deja pasar una oportunidad' },
  blunder: { label: 'Error grave', glyph: '??', phrase: 'es un error grave' },
};

const EMOJI = new Set(['excellent', 'book']);

export function ClassIcon({ c, size = 18, pop = false }: { c: Classification; size?: number; pop?: boolean }) {
  const m = CLASS_META[c];
  const isStar = c === 'best';
  return (
    <span
      className={`class-icon${pop ? ' pop' : ''}`}
      title={m.label}
      style={{
        width: size, height: size, background: `var(--c-${c})`,
        fontSize: EMOJI.has(c) ? size * 0.55 : isStar ? size * 0.62 : m.glyph.length > 1 ? size * 0.5 : size * 0.62,
      }}
    >
      {EMOJI.has(c) ? <ClassSvg c={c} /> : m.glyph}
    </span>
  );
}

function ClassSvg({ c }: { c: Classification }) {
  if (c === 'book') return <svg viewBox="0 0 24 24" width="62%" height="62%" fill="#fff"><path d="M4 5c2.5-1.2 5.2-1.2 7 .3v13.4c-1.8-1.5-4.5-1.5-7-.3zM20 5c-2.5-1.2-5.2-1.2-7 .3v13.4c1.8-1.5 4.5-1.5 7-.3z" /></svg>;
  return <svg viewBox="0 0 24 24" width="62%" height="62%" fill="#fff"><path d="M2 21h4V10H2zm20-10a2 2 0 0 0-2-2h-6.3l1-4.6v-.3a1.5 1.5 0 0 0-.4-1L13.2 2 7.6 7.6A2 2 0 0 0 7 9v10a2 2 0 0 0 2 2h9a2 2 0 0 0 1.8-1.2l3-7.1c.1-.2.2-.5.2-.7z" /></svg>;
}
