// Shared domain types. Keep this file the single source of truth.

export type Color = 'w' | 'b';
export type Source = 'pgn' | 'chesscom' | 'lichess';
export type GameResult = '1-0' | '0-1' | '1/2-1/2' | '*';
export type TimeClass = 'bullet' | 'blitz' | 'rapid' | 'classical' | 'daily' | 'unknown';

export interface Game {
  id: string;               // stable hash (source + external id or PGN hash)
  source: Source;
  externalId?: string;
  pgn: string;
  white: string;
  black: string;
  whiteElo?: number;
  blackElo?: number;
  result: GameResult;
  date: string;             // ISO yyyy-mm-dd ('' if unknown)
  timeControl?: string;     // raw, e.g. "600+5"
  timeClass: TimeClass;
  eco?: string;
  openingName?: string;
  termination?: string;
  url?: string;
  userColor?: Color;        // which side is "me" (from settings usernames)
  importedAt: number;
  analyzed: boolean;
  tags?: string[];
}

export type Classification =
  | 'brilliant' | 'great' | 'best' | 'excellent' | 'good' | 'book'
  | 'inaccuracy' | 'mistake' | 'miss' | 'blunder' | 'forced';

/** Engine score from White's perspective. */
export interface Score { cp?: number; mate?: number }

export interface EngineLine { uci: string; san: string; score: Score; pv: string[] }

export interface PositionEval {
  fen: string;
  depth: number;
  lines: EngineLine[];      // MultiPV lines, best first; scores from White's POV
}

export interface AnalyzedMove {
  ply: number;              // 1-based
  san: string;
  uci: string;
  color: Color;
  fenBefore: string;
  fenAfter: string;
  evalBefore: PositionEval;
  evalAfter: PositionEval;
  winBefore: number;        // win% for the mover, 0..100
  winAfter: number;
  classification: Classification;
  bestSan?: string;
  bestUci?: string;
  accuracy: number;         // 0..100 per-move
  openingName?: string;
  outOfRepertoire?: boolean;
  /** 'deviated' = I left my repertoire here; 'opponent-left' = opponent played a move not in my repertoire */
  repertoire?: 'in' | 'deviated' | 'opponent-left';
}

export interface PlayerSummary {
  accuracy: number;
  counts: Record<Classification, number>;
}

export interface GameAnalysis {
  gameId: string;
  depth: number;
  createdAt: number;
  moves: AnalyzedMove[];
  white: PlayerSummary;
  black: PlayerSummary;
  openingName?: string;
  eco?: string;
}

export interface Settings {
  id: 'settings';
  chesscomUser?: string;
  lichessUser?: string;
  depth: number;            // default 16
  multiPv: number;          // default 2
  thresholds: ClassificationThresholds;
  boardTheme: 'green' | 'brown' | 'blue';
  showArrows: boolean;
  soundOn: boolean;
}

/** Expected-points loss thresholds (0..1 scale). */
export interface ClassificationThresholds {
  excellent: number; good: number; inaccuracy: number; mistake: number;
  greatGap: number;         // min gap vs 2nd line for "great"
}

export const DEFAULT_THRESHOLDS: ClassificationThresholds = {
  excellent: 0.02, good: 0.05, inaccuracy: 0.10, mistake: 0.20, greatGap: 0.15,
};

export const DEFAULT_SETTINGS: Settings = {
  id: 'settings', depth: 16, multiPv: 2, thresholds: DEFAULT_THRESHOLDS,
  boardTheme: 'green', showArrows: true, soundOn: true,
};

/** One edge of the repertoire tree: in position `fenKey`, the move `uci` is part of my `side` repertoire. */
export interface RepertoireMove {
  id: string;               // `${side}|${fenKey}|${uci}`
  side: Color;              // which repertoire (playing as White or as Black)
  fenKey: string;           // first 4 FEN fields of the position before the move
  uci: string;
  san: string;
  comment?: string;
  createdAt: number;
}

/** A training exercise built from one of my mistakes. */
export interface Drill {
  id: string;               // `${gameId}:${ply}`
  gameId: string;
  ply: number;
  fen: string;              // position before my move (I'm to move)
  color: Color;
  bestUci: string;
  bestSan: string;
  playedSan: string;
  classification: Classification;
  createdAt: number;
  due: number;              // timestamp when it's due again
  interval: number;         // days
  ease: number;             // SM-2 style ease factor
  reps: number;
  lapses: number;
  lastResult?: 'pass' | 'fail';
}
