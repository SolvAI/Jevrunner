// Sound, synthesised with WebAudio (no files): a synthwave loop that speeds up with the run, and effects for coins,
// jumps, slides, lane switches, clean moves, power-ups, shield saves, ghost hits and crashes. Starts on the first
// click (browsers allow sound only after one); M mutes.
export function createAudio() {
  let ctx = null, master, music, sfx, noiseBuf, timer = null;
  let muted = false, step = 0, nextAt = 0, tempo = 112;

  function init() {
    if (ctx) return;
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    music = ctx.createGain();
    music.gain.value = 0.32;
    music.connect(master);
    sfx = ctx.createGain();
    sfx.gain.value = 0.7;
    sfx.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  const env = (g, t, a, peak, dur) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  };
  function tone({ type = 'sine', f = 440, f2 = null, t = ctx.currentTime, dur = 0.15, peak = 0.3, a = 0.005, out = sfx, filter = null }) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ctx.createGain();
    env(g, t, a, peak, dur);
    let node = o;
    if (filter) {
      const bq = ctx.createBiquadFilter();
      bq.type = 'lowpass';
      bq.frequency.value = filter;
      node.connect(bq);
      node = bq;
    }
    node.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  function noise({ t = ctx.currentTime, dur = 0.2, peak = 0.3, type = 'bandpass', f = 1200, f2 = null, q = 1, out = sfx }) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    const bq = ctx.createBiquadFilter();
    bq.type = type;
    bq.frequency.setValueAtTime(f, t);
    if (f2) bq.frequency.exponentialRampToValueAtTime(f2, t + dur);
    bq.Q.value = q;
    const g = ctx.createGain();
    env(g, t, 0.004, peak, dur);
    s.connect(bq).connect(g).connect(out);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
  }

  // ---- music: Am - F - C - G, bass in eighths, a soft pad, kick, snare, hats ----
  const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
  const midi = (n) => 440 * 2 ** ((n - 69) / 12);
  function schedule() {
    const spb = 60 / tempo / 2; // eighth notes
    while (nextAt < ctx.currentTime + 0.12) {
      const t = nextAt;
      const bar = Math.floor(step / 8) % 4;
      const chord = CHORDS[bar];
      const e = step % 8;
      tone({ type: 'sawtooth', f: midi(chord[0] - 24 + (e % 2 ? 12 : 0)), t, dur: spb * 0.9, peak: 0.16, filter: 700, out: music });
      if (e === 0) for (const n of chord) tone({ type: 'triangle', f: midi(n), t, dur: spb * 7.5, peak: 0.035, a: 0.25, out: music });
      if (e % 4 === 0) tone({ type: 'sine', f: 150, f2: 42, t, dur: 0.22, peak: 0.55, out: music });
      if (e === 2 || e === 6) noise({ t, dur: 0.16, peak: 0.16, f: 1800, q: 0.7, out: music });
      if (e % 2 === 1) noise({ t, dur: 0.04, peak: 0.06, type: 'highpass', f: 8000, out: music });
      if (e === 7 && bar === 3) tone({ type: 'square', f: midi(chord[2] + 12), t, dur: spb * 0.8, peak: 0.03, filter: 2500, out: music });
      step += 1;
      nextAt += spb;
    }
  }

  return {
    /** Call from a click: starts the sound (and the music, if wanted). */
    start(withMusic = true) {
      init();
      if (ctx.state === 'suspended') void ctx.resume();
      if (withMusic && !timer) {
        nextAt = ctx.currentTime + 0.05;
        timer = setInterval(schedule, 30);
      }
    },
    stopMusic() {
      clearInterval(timer);
      timer = null;
    },
    get muted() {
      return muted;
    },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.setTargetAtTime(muted ? 0 : 0.8, ctx.currentTime, 0.05);
      return muted;
    },
    /** The beat follows the run: 112 bpm at the default speed, faster when the run is. */
    setSpeed(v) {
      tempo = Math.min(168, 100 + v * 0.45);
    },
    play(kind, n = 0) {
      if (!ctx || muted || ctx.state !== 'running') return;
      const t = ctx.currentTime;
      switch (kind) {
        case 'coin': {
          const f = 1320 * 2 ** (Math.min(n % 12, 11) / 24);
          tone({ type: 'square', f, t, dur: 0.06, peak: 0.07, filter: 5000 });
          tone({ type: 'sine', f: f * 1.5, t: t + 0.045, dur: 0.12, peak: 0.08 });
          break;
        }
        case 'jump':
          tone({ type: 'triangle', f: 260, f2: 720, t, dur: 0.18, peak: 0.16 });
          noise({ t, dur: 0.18, peak: 0.06, f: 900, f2: 3000 });
          break;
        case 'slide':
          noise({ t, dur: 0.32, peak: 0.12, type: 'lowpass', f: 1600, f2: 400 });
          break;
        case 'switch':
          noise({ t, dur: 0.09, peak: 0.08, f: 2500, f2: 1200, q: 2 });
          break;
        case 'clean':
          tone({ type: 'sine', f: 880, t, dur: 0.12, peak: 0.1 });
          tone({ type: 'sine', f: 1320, t: t + 0.07, dur: 0.18, peak: 0.1 });
          break;
        case 'power':
          for (const [k, f] of [523, 659, 784, 1046].entries()) tone({ type: 'triangle', f, t: t + k * 0.06, dur: 0.2, peak: 0.12 });
          break;
        case 'shield':
          tone({ type: 'sine', f: 220, f2: 880, t, dur: 0.4, peak: 0.22 });
          noise({ t, dur: 0.3, peak: 0.12, f: 3000, q: 0.5 });
          break;
        case 'ghost':
          tone({ type: 'sine', f: 520, f2: 260, t, dur: 0.3, peak: 0.14 });
          break;
        case 'crash':
          tone({ type: 'sine', f: 120, f2: 30, t, dur: 0.6, peak: 0.7 });
          noise({ t, dur: 0.7, peak: 0.45, type: 'lowpass', f: 3000, f2: 200 });
          tone({ type: 'sawtooth', f: 220, f2: 55, t, dur: 0.5, peak: 0.12, filter: 900 });
          break;
        case 'go':
          tone({ type: 'square', f: 660, t, dur: 0.1, peak: 0.07, filter: 3000 });
          tone({ type: 'square', f: 990, t: t + 0.1, dur: 0.22, peak: 0.08, filter: 3000 });
          break;
        default:
      }
    },
  };
}
