import Dexie, { type Table } from 'dexie';
import type { Drill, Game, GameAnalysis, RepertoireMove, Settings } from '../types';
import { DEFAULT_SETTINGS } from '../types';

export interface EvalCacheEntry { key: string; fen: string; depth: number; multiPv: number; data: unknown }

class AnalyzerDB extends Dexie {
  games!: Table<Game, string>;
  analyses!: Table<GameAnalysis, string>;
  settings!: Table<Settings, string>;
  evalCache!: Table<EvalCacheEntry, string>;
  repertoire!: Table<RepertoireMove, string>;
  drills!: Table<Drill, string>;

  constructor() {
    super('chess-analyzer');
    this.version(1).stores({
      games: 'id, source, date, white, black, result, timeClass, eco, userColor, importedAt, analyzed',
      analyses: 'gameId, createdAt',
      settings: 'id',
      evalCache: 'key',
    });
    this.version(2).stores({
      repertoire: 'id, side, fenKey, [side+fenKey]',
      drills: 'id, gameId, due, classification',
    });
  }
}

export const db = new AnalyzerDB();

export async function getSettings(): Promise<Settings> {
  const s = await db.settings.get('settings');
  return { ...DEFAULT_SETTINGS, ...s, thresholds: { ...DEFAULT_SETTINGS.thresholds, ...s?.thresholds } };
}

export async function saveSettings(patch: Partial<Settings>) {
  const cur = await getSettings();
  await db.settings.put({ ...cur, ...patch, id: 'settings' });
}
