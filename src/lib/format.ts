import type { Score } from '../types';

/** "+1.25", "-0.40", "M3", "-M2" from White's POV. */
export function formatScore(s?: Score): string {
  if (!s) return '0.0';
  if (s.mate !== undefined) return s.mate === 0 ? '#' : `${s.mate < 0 ? '-' : ''}M${Math.abs(s.mate)}`;
  if (Math.abs(s.cp ?? 0) >= 100000) return (s.cp ?? 0) > 0 ? '1-0' : '0-1';
  const v = (s.cp ?? 0) / 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(Math.abs(v) >= 10 ? 0 : 1)}`;
}
