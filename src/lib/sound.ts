import moveUrl from '../assets/sounds/Move.mp3';
import captureUrl from '../assets/sounds/Capture.mp3';

// "Standard" sound set from Lichess (lichess-org/lila, public/sound/standard).
let ctx: AudioContext | null = null;
const buffers = new Map<string, Promise<AudioBuffer>>();

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
    void load(c, capture ? captureUrl : moveUrl).then((buf) => {
      const src = c.createBufferSource();
      src.buffer = buf;
      src.connect(c.destination);
      src.start();
    }).catch(() => { /* audio not available */ });
  } catch { /* audio not available */ }
}
