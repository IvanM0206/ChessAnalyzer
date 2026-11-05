import { Chess } from 'chess.js';
import type { EngineLine, PositionEval, Score } from '../types';

type Job = {
  fen: string; depth: number; multiPv: number;
  onInfo?: (ev: PositionEval) => void;
  resolve: (ev: PositionEval) => void; reject: (e: unknown) => void;
};

/** Converts a UCI PV into SAN moves (best effort). */
export function pvToSan(fen: string, pv: string[], max = 12): string[] {
  const c = new Chess(fen);
  const out: string[] = [];
  for (const u of pv.slice(0, max)) {
    try {
      const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      out.push(m.san);
    } catch { break; }
  }
  return out;
}

/** Thin UCI wrapper around Stockfish running in a Web Worker. Jobs run one at a time. */
export class Engine {
  private worker: Worker;
  private ready: Promise<void>;
  private queue: Job[] = [];
  private current: Job | null = null;
  private lines = new Map<number, EngineLine>();
  private depthSeen = 0;
  private lastInfoEmit = 0;

  constructor(url = '/engine/stockfish.js') {
    this.worker = new Worker(url);
    let readyResolve!: () => void;
    this.ready = new Promise((r) => (readyResolve = r));
    this.worker.onmessage = (e: MessageEvent) => {
      const line = typeof e.data === 'string' ? e.data : '';
      if (line === 'uciok') { this.send('setoption name Hash value 64'); this.send('isready'); }
      else if (line === 'readyok') readyResolve();
      else if (line.startsWith('info ') && this.current) this.onInfo(line);
      else if (line.startsWith('bestmove') && this.current) this.finish();
    };
    this.send('uci');
  }

  private send(cmd: string) { this.worker.postMessage(cmd); }

  analyze(fen: string, depth: number, multiPv = 1, onInfo?: Job['onInfo']): Promise<PositionEval> {
    return new Promise((resolve, reject) => {
      this.queue.push({ fen, depth, multiPv, onInfo, resolve, reject });
      void this.pump();
    });
  }

  /** Cancels pending jobs and stops the running search (resolves it with what it has). */
  stopAll() {
    const pending = this.queue.splice(0);
    pending.forEach((j) => j.reject(new Error('cancelled')));
    if (this.current) this.send('stop');
  }

  terminate() { this.stopAll(); this.worker.terminate(); }

  private async pump() {
    if (this.current || !this.queue.length) return;
    await this.ready;
    if (this.current || !this.queue.length) return;
    const job = this.queue.shift()!;
    this.current = job;
    this.lines.clear();
    this.depthSeen = 0;
    const chess = new Chess(job.fen);
    if (chess.isGameOver()) { this.current = null; job.resolve({ fen: job.fen, depth: 0, lines: [] }); void this.pump(); return; }
    this.send(`setoption name MultiPV value ${job.multiPv}`);
    this.send(`position fen ${job.fen}`);
    this.send(`go depth ${job.depth}`);
  }

  private onInfo(line: string) {
    const job = this.current!;
    const t = line.split(' ');
    const get = (k: string) => { const i = t.indexOf(k); return i >= 0 ? t[i + 1] : undefined; };
    if (!t.includes('pv') || t.includes('upperbound') || t.includes('lowerbound')) return;
    const depth = Number(get('depth'));
    const mpv = Number(get('multipv') ?? 1);
    const pv = t.slice(t.indexOf('pv') + 1);
    const white = job.fen.split(' ')[1] === 'w';
    const st = get('score');
    const val = Number(t[t.indexOf('score') + 2]);
    let score: Score = st === 'mate' ? { mate: val } : { cp: val };
    if (!white) score = st === 'mate' ? { mate: -val } : { cp: -val };
    this.lines.set(mpv, { uci: pv[0], san: '', score, pv });
    this.depthSeen = Math.max(this.depthSeen, depth);
    const now = performance.now();
    if (job.onInfo && now - this.lastInfoEmit > 120) { this.lastInfoEmit = now; job.onInfo(this.snapshot(job)); }
  }

  private snapshot(job: Job): PositionEval {
    const lines = [...this.lines.entries()].sort((a, b) => a[0] - b[0]).map(([, l]) => {
      const san = pvToSan(job.fen, l.pv);
      return { ...l, san: san[0] ?? l.uci, pv: san };
    });
    return { fen: job.fen, depth: this.depthSeen, lines };
  }

  private finish() {
    const job = this.current!;
    const ev = this.snapshot(job);
    this.current = null;
    job.resolve(ev);
    void this.pump();
  }
}

let shared: Engine | null = null;
export const getEngine = () => (shared ??= new Engine());
