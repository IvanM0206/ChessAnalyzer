let table: Record<string, [string, string]> | null = null;
let loading: Promise<void> | null = null;

export const fenKey = (fen: string) => fen.split(' ').slice(0, 4).join(' ');

export function loadOpenings(): Promise<void> {
  if (table) return Promise.resolve();
  loading ??= fetch('/openings.json')
    .then((r) => (r.ok ? r.json() : {}))
    .then((j) => { table = j; })
    .catch(() => { table = {}; });
  return loading;
}

/** Synchronous lookup (call loadOpenings() first). */
export function lookupOpening(fen: string): { eco: string; name: string } | null {
  const hit = table?.[fenKey(fen)];
  return hit ? { eco: hit[0], name: hit[1] } : null;
}

/** For tests. */
export function setOpeningsTable(t: Record<string, [string, string]>) { table = t; }
