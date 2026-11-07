// Effect chain shared by live playback (AudioContext) and export
// (OfflineAudioContext), so the downloaded file sounds like the preview.
//
//   input ─ bass enhancer ─┬─ dry ────────────────┬─ master ─ limiter ─▶
//                          └─ hp ─ convolver ─ wet ┘
//
// The bass enhancer and the look-ahead limiter are AudioWorklets
// (processors.js). Browsers without AudioWorklet get a low-shelf boost and
// DynamicsCompressorNode instead.
//
// Speed is not part of the chain: it is applied by the source
// (media element / buffer source playbackRate, or the WSOLA stretcher).

export const DEFAULTS = Object.freeze({
  bass: 0,        // dB, 0..24
  freq: 120,      // Hz, 40..200 — crossover: everything below is boosted
  speed: 1,       // ×, 0.5..2
  keepPitch: false,
  reverb: 0,      // %, 0..100
  volume: 100,    // %, 0..150
});

export const LIMITS = Object.freeze({
  bass: [0, 24],
  freq: [40, 200],
  speed: [0.5, 2],
  reverb: [0, 100],
  volume: [0, 150],
});

export const PRESETS = [
  { id: 'orig',      name: 'Оригинал',        p: { bass: 0,  freq: 120, speed: 1,    keepPitch: false, reverb: 0 } },
  { id: 'bass',      name: 'Bass Boost',      p: { bass: 14, freq: 120, speed: 1,    keepPitch: false, reverb: 0 } },
  { id: 'mega',      name: 'Мега бас',        p: { bass: 22, freq: 110, speed: 1,    keepPitch: false, reverb: 0 } },
  { id: 'slowed',    name: 'Slowed + Reverb', p: { bass: 6,  freq: 120, speed: 0.8,  keepPitch: false, reverb: 40 } },
  { id: 'slowbass',  name: 'Slowed + Bass',   p: { bass: 14, freq: 110, speed: 0.85, keepPitch: false, reverb: 15 } },
  { id: 'sped',      name: 'Sped Up',         p: { bass: 0,  freq: 120, speed: 1.25, keepPitch: false, reverb: 0 } },
  { id: 'nightcore', name: 'Nightcore',       p: { bass: 6,  freq: 120, speed: 1.35, keepPitch: false, reverb: 10 } },
];

export const IR_SECONDS = 3.5;

export function clampParams(p) {
  const out = { ...DEFAULTS };
  if (p && typeof p === 'object') {
    for (const k of Object.keys(LIMITS)) {
      const v = Number(p[k]);
      if (Number.isFinite(v)) out[k] = Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], v));
    }
    out.keepPitch = !!p.keepPitch;
  }
  return out;
}

const workletReady = new WeakMap();

// Loads the limiter worklet into a context. Never rejects.
export async function prepareContext(ctx) {
  let ok = false;
  try {
    if (ctx.audioWorklet && typeof AudioWorkletNode === 'function') {
      await ctx.audioWorklet.addModule(new URL('./processors.js?v=4', import.meta.url));
      ok = true;
    }
  } catch (_) {
    ok = false;
  }
  workletReady.set(ctx, ok);
  return ok;
}

function createEnhancer(ctx) {
  if (!workletReady.get(ctx)) return null;
  try {
    return new AudioWorkletNode(ctx, 'bass-enhancer', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
  } catch (_) {
    return null;
  }
}

function createLimiter(ctx) {
  if (workletReady.get(ctx)) {
    try {
      return new AudioWorkletNode(ctx, 'brickwall-limiter', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
        processorOptions: { lookahead: 0.005, hold: 0.02, ceilingDb: -1, release: 0.15 },
      });
    } catch (_) { /* fall through */ }
  }
  const c = ctx.createDynamicsCompressor();
  c.threshold.value = -1.5;
  c.knee.value = 0;
  c.ratio.value = 20;
  c.attack.value = 0.002;
  c.release.value = 0.12;
  return c;
}

// Turns user-facing settings into node values.
export function mapParams(p) {
  const r = p.reverb / 100;
  return {
    boost: p.bass,
    freq: p.freq,
    dry: 1 - 0.3 * r,
    wet: r * 0.9,
    master: p.volume / 100,
  };
}

export function buildChain(ctx, impulse = null) {
  const biquad = (type, freq, q) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (q != null) f.Q.value = q;
    return f;
  };
  const input = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  wet.gain.value = 0;
  const master = ctx.createGain();
  const limiter = createLimiter(ctx);
  const targets = [];

  // Bass: the enhancer worklet, or a plain low-shelf where worklets are missing.
  let bassOut;
  const enhancer = createEnhancer(ctx);
  if (enhancer) {
    input.connect(enhancer);
    bassOut = enhancer;
    targets.push([enhancer.parameters.get('boost'), 'boost'], [enhancer.parameters.get('freq'), 'freq']);
  } else {
    const shelf = biquad('lowshelf', DEFAULTS.freq);
    input.connect(shelf);
    bassOut = shelf;
    targets.push([shelf.gain, 'boost'], [shelf.frequency, 'freq']);
  }

  bassOut.connect(dry);
  dry.connect(master);
  // Without an impulse (export with reverb off) skip the costly convolver.
  if (impulse) {
    const wetHp = biquad('highpass', 180, 0.7);
    const conv = ctx.createConvolver();
    conv.normalize = true;
    conv.buffer = impulse;
    bassOut.connect(wetHp);
    wetHp.connect(conv);
    conv.connect(wet);
    wet.connect(master);
  }
  master.connect(limiter);
  targets.push([dry.gain, 'dry'], [wet.gain, 'wet'], [master.gain, 'master']);

  function set(params, when = 0, smooth = false) {
    const v = mapParams(params);
    for (const [param, key] of targets) {
      if (smooth) {
        param.cancelScheduledValues(when);
        param.setTargetAtTime(v[key], when, 0.03);
      } else {
        param.cancelScheduledValues(0);
        param.value = v[key];
      }
    }
  }

  return { input, output: limiter, set };
}

// Small deterministic PRNG so the reverb sounds the same in the preview
// and in the exported file.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Synthetic hall: decorrelated stereo noise with an exponential decay that
// gets darker over time, like a real room.
export function makeImpulse(ctx, seconds = IR_SECONDS) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  const pre = Math.floor(sr * 0.015);
  const t60 = 3.0;
  const fadeOut = Math.floor(sr * 0.25);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    const rnd = mulberry32(c ? 0x51ed270b : 0x2545f491);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      const env = Math.pow(10, (-3 * t) / t60);
      const build = t < 0.02 ? t / 0.02 : 1;
      const a = Math.min(0.94, 0.2 + t * 0.4);
      lp = (1 - a) * (rnd() * 2 - 1) + a * lp;
      let s = lp * env * build;
      const toEnd = len - i;
      if (toEnd < fadeOut) s *= toEnd / fadeOut;
      d[i] = s;
    }
  }
  return buf;
}
