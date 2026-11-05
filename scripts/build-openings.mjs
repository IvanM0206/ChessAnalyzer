// Builds public/openings.json from the lichess-org/chess-openings TSV files.
// Usage: npm run build:openings   (TSVs must be in scripts/openings-src/)
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, 'openings-src');
const outFile = join(here, '..', 'public', 'openings.json');

const RESULT_TOKENS = new Set(['1-0', '0-1', '1/2-1/2', '*']);

// Split a PGN movetext into SAN tokens, dropping move numbers and results.
function sanTokens(pgn) {
  return pgn
    .split(/\s+/)
    .map((t) => t.replace(/^\d+\.+/, '')) // "1." or "1..." or "1.e4" -> "e4"
    .filter((t) => t !== '' && !RESULT_TOKENS.has(t) && !/^\d+$/.test(t));
}

// Position key: first four FEN fields (placement, side, castling, en passant).
function positionKey(chess) {
  return chess.fen().split(' ').slice(0, 4).join(' ');
}

const files = readdirSync(srcDir)
  .filter((f) => f.endsWith('.tsv'))
  .sort()
  .map((f) => join(srcDir, f));

// key -> { eco, name, pgnLength }
const best = new Map();
const prefix = new Map(); // intermediate positions -> shortest line passing through
let rows = 0;
let skipped = 0;

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines.slice(1)) {
    if (line.trim() === '') continue;
    const [eco, name, pgn] = line.split('\t');
    if (!eco || !name || !pgn) continue;
    rows++;

    const chess = new Chess();
    try {
      for (const san of sanTokens(pgn.trim())) {
        chess.move(san);
        // Every intermediate position of a named line is also "book".
        const k = positionKey(chess);
        const len = pgn.trim().length;
        const p = prefix.get(k);
        if (!p || len < p.pgnLength) prefix.set(k, { eco: eco.trim(), name: name.trim(), pgnLength: len });
      }
    } catch {
      skipped++;
      continue;
    }

    const key = positionKey(chess);
    const pgnLength = pgn.trim().length;
    const prev = best.get(key);
    if (!prev || pgnLength > prev.pgnLength) {
      best.set(key, { eco: eco.trim(), name: name.trim(), pgnLength });
    }
  }
}

const out = {};
for (const [key, { eco, name }] of best) out[key] = [eco, name];
for (const [key, { eco, name }] of prefix) if (!out[key]) out[key] = [eco, name];

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(out));

console.log(`Rows read: ${rows}, skipped (unparseable): ${skipped}`);
console.log(`Wrote ${Object.keys(out).length} positions to ${outFile}`);
