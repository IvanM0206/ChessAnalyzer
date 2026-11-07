let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

/** Short decaying noise burst, shaped by `bandpass`/`highpass`, for the sharp "tick" of wood on wood. */
function tick(c: AudioContext, at: number, dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = 'bandpass') {
  noise ??= (() => {
    const b = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  })();
  const src = c.createBufferSource(); src.buffer = noise;
  const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f).connect(g).connect(c.destination);
  src.start(at, Math.random() * 0.5, dur + 0.02);
}

/** Hollow low "thock": a pitch-dropping sine body. */
function thock(c: AudioContext, at: number, dur: number, from: number, to: number, gain: number) {
  const o = c.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(from, at);
  o.frequency.exponentialRampToValueAtTime(to, at + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(c.destination);
  o.start(at); o.stop(at + dur + 0.02);
}

/**
 * Synthesized piece sound (no audio assets shipped). Modeled after the soft, hollow wooden
 * "tok" of chess.com: a quick pitch-dropping body plus a dry click; captures are heavier
 * with a double knock.
 */
export function playMoveSound(capture = false) {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime + 0.005;
    if (capture) {
      thock(ctx, t, 0.11, 200, 70, 0.85);
      tick(ctx, t, 0.04, 1800, 0.9, 0.75);
      thock(ctx, t + 0.022, 0.08, 150, 80, 0.45);
      tick(ctx, t + 0.022, 0.025, 2600, 1.2, 0.35);
    } else {
      thock(ctx, t, 0.07, 240, 110, 0.6);
      tick(ctx, t, 0.022, 3000, 1.1, 0.45);
    }
  } catch { /* audio not available */ }
}
