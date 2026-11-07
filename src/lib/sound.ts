import { getSettings } from '../db/db';
import { DEFAULT_SETTINGS, type SoundSet } from '../types';

// Sound sets from Lichess (lichess-org/lila, public/sound/<set>), bundled by Vite as URLs.
const files = import.meta.glob('../assets/sounds/*/*.mp3', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export const SOUND_SETS: { id: SoundSet; label: string }[] = [
  { id: 'standard', label: 'Estándar' },
  { id: 'sfx', label: 'SFX' },
  { id: 'piano', label: 'Piano' },
  { id: 'nes', label: '8-bit' },
];

let ctx: AudioContext | null = null;
let current: SoundSet = DEFAULT_SETTINGS.soundSet;
let loaded = false;
const buffers = new Map<string, Promise<AudioBuffer>>();

/** Change the active set immediately (the Settings page also persists it). */
export function setSoundSet(set: SoundSet) {
  current = set;
  loaded = true;
}

function load(c: AudioContext, url: string) {
  let p = buffers.get(url);
  if (!p) {
    p = fetch(url).then((r) => r.arrayBuffer()).then((b) => c.decodeAudioData(b));
    p.catch(() => buffers.delete(url));
    buffers.set(url, p);
  }
  return p;
}

export function playMoveSound(capture = false) {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const c = ctx;
    const ready = loaded ? Promise.resolve() : getSettings().then((s) => { if (!loaded) { current = s.soundSet; loaded = true; } });
    void ready
      .then(() => load(c, files[`../assets/sounds/${current}/${capture ? 'Capture' : 'Move'}.mp3`]))
      .then((buf) => {
        const src = c.createBufferSource();
        src.buffer = buf;
        src.connect(c.destination);
        src.start();
      })
      .catch(() => { /* audio not available */ });
  } catch { /* audio not available */ }
}
