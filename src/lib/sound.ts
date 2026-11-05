let ctx: AudioContext | null = null;

/** Tiny synthesized "wood click" so we ship no audio assets. */
export function playMoveSound(capture = false) {
  try {
    ctx ??= new AudioContext();
    const t = ctx.currentTime;
    const len = capture ? 0.09 : 0.06;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, capture ? 3 : 5);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = capture ? 900 : 1600; f.Q.value = 1.2;
    const g = ctx.createGain(); g.gain.setValueAtTime(capture ? 0.9 : 0.6, t);
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(t);
  } catch { /* audio not available */ }
}
