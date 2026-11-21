/*
 * Ночной эмбиант — генеративный звуковой движок.
 *
 * Всё синтезируется на лету (Web Audio + немного DSP на JS), ни одного
 * сэмпла: гул и лампы, ветер в доме, сверчки, часы, дыхание у двери, шаги
 * и сервоприводы, металл и скрипы, расстроенная шкатулка, гроза, плёнка.
 *
 * Работает и в AudioContext (живое воспроизведение), и в OfflineAudioContext
 * (рендер бесшовного цикла для скачивания). Один и тот же seed даёт один и
 * тот же трек.
 */
'use strict';
(function (root) {
  const TAU = Math.PI * 2;

  const LAYERS = ['drone', 'wind', 'crickets', 'clock', 'breath', 'steps', 'metal', 'musicbox', 'storm', 'tape'];

  const DEFAULT_LEVELS = {
    drone: 0.8, wind: 0.6, crickets: 0.55, clock: 0.35, breath: 0.8,
    steps: 0.7, metal: 0.7, musicbox: 0.6, storm: 0.3, tape: 0.4,
  };

  // Калибровка громкости слоёв: при уровне 1.0 слой звучит на своём месте в миксе.
  const LAYER_GAIN = {
    drone: 0.1, wind: 0.12, crickets: 0.1, clock: 0.19, breath: 0.39,
    steps: 0.53, metal: 0.335, musicbox: 0.245, storm: 0.27, tape: 0.14,
  };

  const TARGET_RMS = 0.05; // ≈ −20 LUFS для готового цикла

  // ── утилиты ─────────────────────────────────────────────────────────
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeRandom(seed) {
    const r = mulberry32(seed);
    return {
      r,
      range: (a, b) => a + (b - a) * r(),
      int: (a, b) => Math.floor(a + (b - a + 1) * r()),
      chance: (p) => r() < p,
      pick: (arr) => arr[Math.floor(r() * arr.length)],
      sign: () => (r() < 0.5 ? -1 : 1),
      weighted(pairs) {
        let sum = 0;
        for (const [, w] of pairs) sum += w;
        let x = r() * sum;
        for (const [v, w] of pairs) if ((x -= w) <= 0) return v;
        return pairs[pairs.length - 1][0];
      },
    };
  }

  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (x) => {
    x = clamp(x, 0, 1);
    return x * x * (3 - 2 * x);
  };
  const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function normalize(arr, peak) {
    let m = 0;
    for (let i = 0; i < arr.length; i++) {
      const a = Math.abs(arr[i]);
      if (a > m) m = a;
    }
    if (m > 0) {
      const k = peak / m;
      for (let i = 0; i < arr.length; i++) arr[i] *= k;
    }
    return arr;
  }

  function normalizeAll(chs, peak) {
    let m = 0;
    for (const arr of chs) for (let i = 0; i < arr.length; i++) m = Math.max(m, Math.abs(arr[i]));
    if (m > 0) for (const arr of chs) for (let i = 0; i < arr.length; i++) arr[i] *= peak / m;
    return chs;
  }

  // Биквад по RBJ cookbook для синтеза в буфер.
  class BQ {
    constructor(sr) {
      this.sr = sr;
      this.x1 = this.x2 = this.y1 = this.y2 = 0;
      this.b0 = 1; this.b1 = this.b2 = this.a1 = this.a2 = 0;
    }
    set(type, f, Q) {
      const w = (TAU * Math.min(f, this.sr * 0.45)) / this.sr;
      const cs = Math.cos(w), al = Math.sin(w) / (2 * Q);
      let b0, b1, b2;
      const a0 = 1 + al, a1 = -2 * cs, a2 = 1 - al;
      if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; }
      else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; }
      else { b0 = al; b1 = 0; b2 = -al; } // bp, 0 дБ на вершине
      this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
      return this;
    }
    tick(x) {
      const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
      this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
      return y;
    }
  }

  // Затухающая синусоида рекурсией (без Math.sin на каждом сэмпле).
  function addDamped(out, start, sr, f, amp, decay, phase, maxLen) {
    if (f >= sr * 0.45) return;
    const w = (TAU * f) / sr, r = Math.exp(-1 / (decay * sr));
    const c = 2 * r * Math.cos(w), r2 = r * r;
    let y2 = amp * Math.sin(phase - w) / r, y1 = amp * Math.sin(phase);
    const n = Math.min(out.length - start, Math.ceil(Math.min(maxLen, decay * 7) * sr));
    for (let i = 0; i < n; i++) {
      out[start + i] += y1;
      const y = c * y1 - r2 * y2;
      y2 = y1; y1 = y;
    }
  }

  // ── синтез звуков в буферы ─────────────────────────────────────────
  function synthNoise(sr, R, seconds, kind, channels) {
    const len = Math.floor(seconds * sr);
    const out = [];
    for (let c = 0; c < channels; c++) {
      const a = new Float32Array(len);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
      for (let i = 0; i < len; i++) {
        const w = R.r() * 2 - 1;
        if (kind === 'white') a[i] = w * 0.5;
        else if (kind === 'brown') { br = (br + 0.02 * w) / 1.02; a[i] = br * 3.5; }
        else {
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
          b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
          b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          a[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
          b6 = w * 0.115926;
        }
      }
      // мягкая склейка концов, чтобы петля не щёлкала
      const x = Math.floor(sr * 0.05);
      for (let i = 0; i < x; i++) {
        const k = i / x;
        a[i] = a[i] * k + a[len - x + i] * (1 - k);
      }
      out.push(a.subarray(0, len - x));
    }
    return out;
  }

  function synthImpulse(sr, R, seconds, t60, lpStart, lpEnd, early) {
    const len = Math.floor(seconds * sr);
    const chs = [];
    for (let c = 0; c < 2; c++) {
      const a = new Float32Array(len);
      let y = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const f = lpStart * Math.pow(lpEnd / lpStart, Math.min(1, t / seconds));
        const k = 1 - Math.exp((-TAU * f) / sr);
        y += k * (R.r() * 2 - 1 - y);
        const env = Math.exp((-6.9 * t) / t60) * smooth(t / 0.012);
        a[i] = y * env;
      }
      if (early) {
        for (let e = 0; e < 7; e++) {
          const at = Math.floor(R.range(0.004, 0.06) * sr);
          a[at] += R.range(-0.8, 0.8) * (1 - e / 9);
        }
      }
      chs.push(a);
    }
    return chs;
  }

  function synthChirp(sr, R, carrier, pulses) {
    const pd = 0.017, gap = 0.013;
    const out = new Float32Array(Math.ceil((pulses * (pd + gap) + 0.03) * sr));
    let ph = 0;
    for (let p = 0; p < pulses; p++) {
      const amp = (p === 0 ? 0.65 : R.range(0.85, 1)) * (p === pulses - 1 ? 0.8 : 1);
      const s0 = Math.floor(p * (pd + gap) * sr), n = Math.floor(pd * sr);
      for (let i = 0; i < n; i++) {
        const x = i / n;
        const env = Math.pow(Math.sin(Math.PI * x), 2) * amp;
        ph += (TAU * carrier * (1 - 0.025 * x)) / sr;
        out[s0 + i] += env * (Math.sin(ph) + 0.12 * Math.sin(2 * ph + 0.5));
      }
    }
    return normalize(out, 0.8);
  }

  function synthTick(sr, R, high) {
    const out = new Float32Array(Math.floor(0.1 * sr));
    const bq = new BQ(sr).set('bp', high ? 4300 : 3300, 1.4);
    const f1 = high ? 3150 : 2420, f2 = high ? 1180 : 930;
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const click = bq.tick(R.r() * 2 - 1) * Math.exp(-t / 0.0025) * 1.6;
      const ring = Math.sin(TAU * f1 * t) * Math.exp(-t / 0.011) * 0.45 +
        Math.sin(TAU * f2 * t) * Math.exp(-t / 0.022) * 0.35;
      out[i] = (click + ring) * smooth(t / 0.0006);
    }
    return normalize(out, 0.8);
  }

  function synthStep(sr, R) {
    const out = new Float32Array(Math.floor(0.75 * sr));
    const lp = new BQ(sr).set('lp', 420, 0.8);
    const lp2 = new BQ(sr).set('lp', 300, 0.8);
    const fEnd = R.range(38, 50), fStart = fEnd + R.range(45, 70);
    const heel = R.range(0.035, 0.065);
    let ph = 0, ph2 = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const f = fEnd + (fStart - fEnd) * Math.exp(-t / 0.028);
      ph += (TAU * f) / sr;
      let s = Math.sin(ph) * Math.exp(-t / 0.14);
      s += lp.tick(R.r() * 2 - 1) * Math.exp(-t / 0.035) * 2.2;
      if (t > heel) {
        const t2 = t - heel;
        ph2 += (TAU * (fEnd * 1.25 + 40 * Math.exp(-t2 / 0.02))) / sr;
        s += Math.sin(ph2) * Math.exp(-t2 / 0.08) * 0.45 + lp2.tick(R.r() * 2 - 1) * Math.exp(-t2 / 0.03) * 0.9;
      }
      out[i] = s * smooth(t / 0.0015);
    }
    // металлический призвук — у этого «гостя» железные ступни
    const base = R.range(1500, 1900);
    [1, 1.43, 2.11, 2.87].forEach((k, j) =>
      addDamped(out, 0, sr, base * k * R.range(0.98, 1.02), 0.05 / (j + 1), 0.07 / (1 + j * 0.4), R.r() * TAU, 0.7));
    return normalize(out, 0.9);
  }

  function synthServo(sr, R) {
    const dur = R.range(0.45, 1.0);
    const out = new Float32Array(Math.floor((dur + 0.3) * sr));
    const f0 = R.range(170, 260), f1 = f0 * R.range(1.6, 2.2), f2 = f0 * R.range(1.15, 1.5);
    const bp = new BQ(sr).set('bp', R.range(1100, 1600), 1.2);
    const lp = new BQ(sr).set('lp', 3800, 0.7);
    let ph = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / sr, x = t / dur;
      let s = 0;
      if (x < 1) {
        let f = x < 0.5 ? lerp(f0, f1, smooth(x * 2)) : lerp(f1, f2, smooth((x - 0.5) * 2));
        f *= 1 + 0.012 * Math.sin(TAU * 9 * t);
        ph += f / sr;
        ph -= Math.floor(ph);
        const env = smooth(t / 0.03) * smooth((dur - t) / 0.05);
        const gear = (R.r() * 2 - 1) * (0.5 + 0.5 * Math.sin(TAU * f * 0.25 * t)) * 0.4;
        s = ((2 * ph - 1) * 0.7 + gear) * env;
      } else {
        const t2 = t - dur;
        s = Math.sin(TAU * 95 * t2) * Math.exp(-t2 / 0.04) * 0.9 + (R.r() * 2 - 1) * Math.exp(-t2 / 0.006) * 0.6;
      }
      out[i] = lp.tick(bp.tick(s) * 1.2 + s * 0.2);
    }
    return normalize(out, 0.8);
  }

  // Удар по металлу: модальный синтез, каждая мода — пара близких частот (биения).
  function addClank(out, start, sr, R, f0, amp, decayK) {
    const ratios = [1, 2.32, 4.25, 6.63, 9.38, 12.4];
    const amps = [1, 0.75, 0.55, 0.38, 0.26, 0.16];
    const decs = [2.4, 1.7, 1.05, 0.7, 0.45, 0.3];
    for (let k = 0; k < ratios.length; k++) {
      const f = f0 * ratios[k] * R.range(0.98, 1.02);
      const a = amps[k] * R.range(0.6, 1.1) * amp, d = decs[k] * decayK;
      addDamped(out, start, sr, f, a, d, R.r() * TAU, 9);
      addDamped(out, start, sr, f + R.range(0.4, 2.2), a * 0.6, d * 0.9, R.r() * TAU, 9);
    }
    const hp = new BQ(sr).set('hp', 1500, 0.7);
    const n = Math.min(out.length - start, Math.floor(0.05 * sr));
    for (let i = 0; i < n; i++) out[start + i] += hp.tick(R.r() * 2 - 1) * Math.exp(-i / sr / 0.006) * amp * 0.9;
  }

  function synthClank(sr, R) {
    const k = R.range(0.6, 1.3);
    const out = new Float32Array(Math.floor((2.4 * k * 3.5 + 0.2) * sr));
    addClank(out, 0, sr, R, R.range(95, 380), 1, k);
    return normalize(out, 0.9);
  }

  // Упавшая труба: удары всё чаще и тише.
  function synthBounce(sr, R) {
    const f0 = R.range(160, 420), k = R.range(0.5, 0.9);
    let t = 0, gap = R.range(0.35, 0.5), amp = 1;
    const hits = [];
    while (amp > 0.08 && hits.length < 14) {
      hits.push([t, amp]);
      t += gap;
      gap *= R.range(0.68, 0.8);
      amp *= R.range(0.62, 0.78);
    }
    const out = new Float32Array(Math.floor((t + 2.4 * k * 3.5) * sr));
    for (const [ht, a] of hits) addClank(out, Math.floor(ht * sr), sr, R, f0 * R.range(0.97, 1.03), a, k * (0.5 + a * 0.5));
    return normalize(out, 0.9);
  }

  // Скрип / стон металла: прерывистое трение (stick-slip) возбуждает резонансы.
  function synthStickSlip(sr, R, o) {
    const dur = o.dur;
    const out = new Float32Array(Math.floor((dur + o.tail) * sr));
    const bqs = o.res.map((f) => new BQ(sr).set('bp', f * R.range(0.95, 1.05), o.Q * R.range(0.8, 1.2)));
    const gains = o.res.map((_, k) => R.range(0.5, 1) / (1 + k * 0.35));
    let nextImp = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / sr, x = t / dur;
      let exc = 0;
      if (x < 1) {
        const env = smooth(x / 0.08) * smooth((1 - x) / 0.15);
        if (t >= nextImp) {
          const rate = x < 0.5 ? lerp(o.rate[0], o.rate[1], smooth(x * 2)) : lerp(o.rate[1], o.rate[2], smooth((x - 0.5) * 2));
          exc = env * R.range(0.35, 1);
          nextImp = t + (R.range(0.85, 1.15)) / rate;
        }
        exc += (R.r() * 2 - 1) * o.noise * env;
      }
      let s = 0;
      for (let k = 0; k < bqs.length; k++) s += bqs[k].tick(exc) * gains[k];
      out[i] = s;
    }
    normalize(out, 1);
    for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i] * 1.6) * 0.85;
    return out;
  }

  function synthBreath(sr, R, n) {
    const plan = [];
    let t = 0.2;
    for (let k = 0; k < n; k++) {
      const ai = R.range(0.9, 1.35), pause = R.range(0.1, 0.25), ae = R.range(1.2, 1.8), rest = R.range(0.5, 1.1);
      plan.push({ i0: t, i1: t + ai, e0: t + ai + pause, e1: t + ai + pause + ae, amp: R.range(0.8, 1) });
      t += ai + pause + ae + rest;
    }
    const out = new Float32Array(Math.ceil((t + 0.3) * sr));
    const f1 = new BQ(sr), f2 = new BQ(sr).set('bp', R.range(1500, 1900), 1.3), hp = new BQ(sr).set('hp', 180, 0.7);
    const glp = new BQ(sr).set('lp', 320, 0.9);
    const growlHz = R.range(52, 68), raspHz = R.range(28, 40), growlAmt = R.range(0.08, 0.25);
    let gph = 0, rph = 0, k = 0;
    for (let i = 0; i < out.length; i++) {
      const tt = i / sr;
      while (k < plan.length - 1 && tt > plan[k].e1 + 0.05) k++;
      const b = plan[k];
      let env = 0, fc = 800, rasp = 0, growl = 0;
      if (tt >= b.i0 && tt < b.i1) {
        const x = (tt - b.i0) / (b.i1 - b.i0);
        env = Math.pow(x, 1.1) * smooth((1 - x) / 0.12) * 0.75 * b.amp;
        fc = 900 + 700 * x; rasp = 0.25; growl = 0.1;
      } else if (tt >= b.e0 && tt < b.e1) {
        const x = (tt - b.e0) / (b.e1 - b.e0);
        env = Math.sin(Math.PI * Math.pow(x, 0.55)) * b.amp;
        fc = 750 - 300 * x; rasp = 0.65; growl = 0.4;
      }
      if ((i & 31) === 0) f1.set('bp', fc, 1.6);
      const w = R.r() * 2 - 1;
      const s = hp.tick(f1.tick(w) + f2.tick(w) * 0.45);
      rph += raspHz / sr;
      const am = 1 + rasp * Math.sin(TAU * rph + 0.3 * Math.sin(TAU * 3 * tt));
      gph += (growlHz * (1 + 0.04 * Math.sin(TAU * 5.3 * tt))) / sr;
      gph -= Math.floor(gph);
      const g = glp.tick(2 * gph - 1) * growl * growlAmt;
      out[i] = (s * am + g) * env;
    }
    return normalize(out, 0.9);
  }

  // Мелодии шкатулки — ре гармонический минор, 3/4. [доля, MIDI]
  const PHRASES = [
    {
      beat: 0.46,
      notes: [[0, 69], [1, 74], [2, 77], [3, 76], [5, 73], [6, 74], [7, 69], [8, 65], [9, 67], [11, 64],
        [12, 65], [13, 69], [14, 74], [15, 73], [16, 76], [18, 77], [19, 76], [20, 70], [21, 69]],
      bass: [[0, 50], [3, 57], [6, 50], [9, 55], [12, 50], [15, 57], [18, 58], [21, 50]],
    },
    {
      beat: 0.56,
      notes: [[0, 74], [2, 73], [3, 70], [4, 69], [6, 67], [7, 65], [9, 64], [12, 65], [13, 67],
        [15, 69], [16, 70], [18, 64], [19, 61], [21, 62]],
      bass: [[0, 50], [3, 58], [6, 55], [9, 57], [12, 53], [15, 55], [18, 57], [21, 50]],
    },
    {
      beat: 0.42,
      notes: [[0, 69], [1, 70], [2, 69], [3, 68], [4, 69], [6, 76], [8, 77], [9, 76], [10, 75],
        [11, 74], [12, 73], [15, 74]],
      bass: [[0, 50], [6, 57], [12, 57], [15, 50]],
    },
  ];

  function synthMusicBox(sr, R, phrase, windDown) {
    const notes = phrase.notes.map(([b, m]) => ({ b, m, v: R.range(0.75, 1) }))
      .concat(phrase.bass.map(([b, m]) => ({ b, m, v: R.range(0.4, 0.55) })))
      .sort((a, b) => a.b - b.b);
    const lastB = notes[notes.length - 1].b;
    const cut = windDown ? lastB * R.range(0.72, 0.95) : lastB + 0.5;
    const wStart = windDown ? cut * 0.5 : Infinity;
    const slow = (b) => (b <= wStart ? 1 : 1 + 2.8 * Math.pow((b - wStart) / (cut - wStart), 2));
    const tOf = (b) => {
      let t = 0;
      for (let x = 0; x < b; x += 0.125) t += 0.125 * phrase.beat * slow(x + 0.0625);
      return t;
    };
    const tw = windDown ? tOf(wStart) : Infinity, tc = tOf(cut);
    const tune = R.range(0.985, 1.01), p1 = R.r() * TAU, p2 = R.r() * TAU;
    const pitch = (t) => tune * (1 + 0.005 * Math.sin(TAU * 0.5 * t + p1) + 0.0025 * Math.sin(TAU * 1.9 * t + p2)) *
      (windDown ? 1 - 0.09 * smooth((t - tw) / (tc - tw)) : 1);
    const out = new Float32Array(Math.floor((tc + 3.6) * sr));
    const partials = [[1, 1, 1.5], [2, 0.05, 0.4], [6.27, 0.28, 0.14], [17.55, 0.07, 0.04]];
    const BLK = 64;
    for (const nt of notes) {
      if (nt.b >= cut || R.chance(0.07)) continue; // выбитые зубцы
      const t0 = tOf(nt.b), s0 = Math.floor(t0 * sr);
      const f = midiHz(nt.m) * R.range(0.993, 1.007);
      const len = Math.min(out.length - s0, Math.floor(3.2 * sr));
      for (const [ratio, amp, dec] of partials) {
        if (f * ratio * 1.1 > sr * 0.45) continue;
        const n = Math.min(len, Math.floor(dec * 6 * sr));
        let ph = R.r() * TAU, inc = 0;
        for (let i = 0; i < n; i++) {
          if (i % BLK === 0) inc = (TAU * f * ratio * pitch(t0 + i / sr)) / sr;
          ph += inc;
          const t = i / sr;
          out[s0 + i] += Math.sin(ph) * amp * nt.v * Math.exp(-t / dec) * smooth((3.2 - t) / 0.3);
        }
      }
      const hp = new BQ(sr).set('hp', 2000, 0.7);
      for (let i = 0; i < Math.floor(0.01 * sr) && s0 + i < out.length; i++) {
        out[s0 + i] += hp.tick(R.r() * 2 - 1) * Math.exp(-i / sr / 0.002) * 0.25 * nt.v;
      }
    }
    return normalize(out, 0.85);
  }

  function synthThunder(sr, R, near) {
    const dur = R.range(6, 10);
    const rolls = [];
    const nr = R.int(3, 6);
    for (let k = 0; k < nr; k++) {
      rolls.push({
        t0: k === 0 ? 0 : R.range(0.3, dur * 0.45), a: k === 0 ? 1 : R.range(0.4, 0.95),
        att: k === 0 && near ? 0.02 : R.range(0.08, 0.5), dec: R.range(0.8, 2.6),
      });
    }
    const len = Math.floor(dur * sr);
    const cut = near ? 900 : R.range(160, 320);
    const chs = [];
    for (let c = 0; c < 2; c++) {
      const a = new Float32Array(len);
      let br = 0, y1 = 0, y2 = 0, jit = 0, jt = 0;
      const k1 = 1 - Math.exp((-TAU * cut) / sr), kj = 1 - Math.exp((-TAU * 7) / sr);
      const hp = new BQ(sr).set('hp', 1200, 0.7);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        let env = 0;
        for (const r of rolls) {
          const x = t - r.t0;
          if (x < 0) continue;
          env += r.a * (x < r.att ? Math.pow(x / r.att, 2) : Math.exp(-(x - r.att) / r.dec));
        }
        env *= smooth((dur - t) / 1.5);
        const w = R.r() * 2 - 1;
        br = (br + 0.02 * w) / 1.02;
        jt += kj * (R.r() * 2 - 1 - jt);
        jit = jt * 25;
        y1 += k1 * (br * 3.5 - y1);
        y2 += k1 * (y1 - y2);
        let s = y2 * env * (1 + clamp(jit, -0.8, 0.8));
        if (near && t < 0.4) s += hp.tick(w) * Math.exp(-t / 0.06) * 0.5;
        a[i] = s;
      }
      chs.push(a);
    }
    return normalizeAll(chs, 0.9);
  }

  function synthDrops(sr, R, seconds, perSec) {
    const len = Math.floor(seconds * sr);
    const chs = [new Float32Array(len), new Float32Array(len)];
    const count = Math.floor(seconds * perSec);
    for (let k = 0; k < count; k++) {
      const at = Math.floor(R.r() * (len - sr * 0.02));
      const f = R.range(2200, 6000), a = Math.pow(R.r(), 2) * 0.8 + 0.05;
      const pan = R.r();
      const tmp = new Float32Array(Math.floor(0.02 * sr));
      addDamped(tmp, 0, sr, f, a, R.range(0.002, 0.006), 0, 0.02);
      for (let i = 0; i < tmp.length; i++) {
        chs[0][at + i] += tmp[i] * (1 - pan);
        chs[1][at + i] += tmp[i] * pan;
      }
    }
    return normalizeAll(chs, 0.8);
  }

  function synthCrackle(sr, R, seconds, perSec) {
    const len = Math.floor(seconds * sr);
    const a = new Float32Array(len);
    const count = Math.floor(seconds * perSec);
    for (let k = 0; k < count; k++) {
      const at = Math.floor(R.r() * (len - 64));
      const amp = Math.min(1, 0.05 / Math.pow(R.r() + 0.02, 1.2)) * R.sign();
      const w = R.int(1, 4);
      for (let i = 0; i < w; i++) a[at + i] += amp * (1 - i / w);
      for (let i = w; i < 40; i++) a[at + i] -= amp * 0.3 * Math.exp(-(i - w) / 6);
    }
    return normalize(a, 0.7);
  }

  function synthZaps(sr, R, times) {
    const end = times[times.length - 1] + 0.1;
    const out = new Float32Array(Math.floor(end * sr));
    const bp = new BQ(sr).set('bp', 3000, 0.8);
    for (const t of times) {
      const s0 = Math.floor(t * sr), n = Math.floor(R.range(0.004, 0.025) * sr);
      const a = R.range(0.3, 1);
      for (let i = 0; i < n && s0 + i < out.length; i++) {
        out[s0 + i] += (R.r() < 0.3 ? R.r() * 2 - 1 : 0) * a;
      }
    }
    for (let i = 0; i < out.length; i++) out[i] = bp.tick(out[i]) * 0.7 + out[i] * 0.3;
    return normalize(out, 0.7);
  }

  // ── движок ─────────────────────────────────────────────────────────
  class NightAmbience {
    constructor(ctx, options = {}) {
      this.ctx = ctx;
      this.sr = ctx.sampleRate;
      this.seed = (options.seed == null ? Math.floor(Math.random() * 4294967296) : options.seed) >>> 0;
      this.R = makeRandom(this.seed);
      this.levels = Object.assign({}, DEFAULT_LEVELS, options.levels || {});
      this.tension = options.tension == null ? 0.5 : options.tension;
      this.volume = options.volume == null ? 0.8 : options.volume;
      this.onEvent = options.onEvent || null;
      this.eventsFrom = options.eventsFrom || 0;
      this.eventsUntil = options.eventsUntil == null ? Infinity : options.eventsUntil;
      this.firstScale = options.firstScale || 1;
      this.raw = !!options.raw;
      this.now = 0;
      this.started = false;
      this.sources = [];
      this.gens = [];
      this._build();
    }

    // ── узлы ─────────────────────────────────────────────────────────
    _gain(v) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
    _filter(type, f, Q) {
      const b = this.ctx.createBiquadFilter();
      b.type = type; b.frequency.value = f;
      if (Q != null) b.Q.value = Q;
      return b;
    }
    _osc(type, f) {
      const o = this.ctx.createOscillator();
      o.type = type; o.frequency.value = f;
      this.sources.push(o);
      return o;
    }
    _lfo(rate, depth, param) {
      const o = this._osc('sine', rate), g = this._gain(depth);
      o.connect(g); g.connect(param);
      return o;
    }
    _pan(v) { const p = this.ctx.createStereoPanner(); p.pan.value = v; return p; }
    _buf(chs) {
      if (!Array.isArray(chs)) chs = [chs];
      const b = this.ctx.createBuffer(chs.length, chs[0].length, this.sr);
      chs.forEach((d, i) => b.getChannelData(i).set(d));
      return b;
    }
    _loop(chs) {
      const s = this.ctx.createBufferSource();
      s.buffer = this._buf(chs); s.loop = true;
      this.sources.push(s);
      return s;
    }
    _route(node, L, dry, room, hall) {
      const send = (amt, dest) => {
        if (!amt) return;
        if (amt === 1) node.connect(dest);
        else { const g = this._gain(amt); node.connect(g); g.connect(dest); }
      };
      send(dry, L.dry); send(room, L.room); send(hall, L.hall);
    }
    _play(buf, when, L, o = {}) {
      if (when < this.now - 0.05) return null;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      if (o.rate) src.playbackRate.value = o.rate;
      let node = src;
      if (o.lp) { const f = this._filter('lowpass', o.lp, 0.7); node.connect(f); node = f; }
      if (o.hp) { const f = this._filter('highpass', o.hp, 0.7); node.connect(f); node = f; }
      const g = this._gain(o.gain == null ? 1 : o.gain);
      node.connect(g); node = g;
      if (o.pan) { const p = this._pan(o.pan); node.connect(p); node = p; }
      if (o.to) node.connect(o.to);
      else this._route(node, L, o.dry == null ? 1 : o.dry, o.room || 0, o.hall || 0);
      src.start(Math.max(when, 0));
      return src;
    }
    _emit(t, text, side, dur, kind) {
      if (this.onEvent && t >= this.now - 0.05) this.onEvent({ time: t, text, side: side || null, dur: dur || 0, kind: kind || null });
    }

    _build() {
      const ctx = this.ctx, R = this.R, sr = this.sr;

      // мастер: склейка → тон → лимитер → громкость → фейд
      this.mix = this._gain(1);
      const glue = ctx.createDynamicsCompressor();
      glue.threshold.value = -24; glue.knee.value = 12; glue.ratio.value = 2.5;
      glue.attack.value = 0.05; glue.release.value = 0.4;
      const tone = this._filter('highshelf', 7000);
      tone.gain.value = -5;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -6; limiter.knee.value = 2; limiter.ratio.value = 20;
      limiter.attack.value = 0.002; limiter.release.value = 0.25;
      this.vol = this._gain(this.volume);
      this.fade = this._gain(0);
      if (this.raw) this.mix.connect(this.vol); // для калибровки: без компрессии
      else { this.mix.connect(glue); glue.connect(tone); tone.connect(limiter); limiter.connect(this.vol); }
      this.vol.connect(this.fade);
      this.output = this.fade;

      // реверберация: большой пустой цех и маленькая комната
      this.hallIn = this._gain(1);
      const hall = ctx.createConvolver();
      hall.buffer = this._buf(synthImpulse(sr, R, 4.2, 4.0, 5200, 900, false));
      this.hallIn.connect(hall); hall.connect(this.mix);
      this.roomIn = this._gain(1);
      const room = ctx.createConvolver();
      room.buffer = this._buf(synthImpulse(sr, R, 1.0, 0.7, 7000, 2500, true));
      const roomOut = this._gain(0.8);
      this.roomIn.connect(room); room.connect(roomOut); roomOut.connect(this.mix);

      this.L = {};
      for (const name of LAYERS) {
        const v = this.levels[name] * LAYER_GAIN[name];
        const L = { dry: this._gain(v), room: this._gain(v), hall: this._gain(v) };
        L.dry.connect(this.mix); L.room.connect(this.roomIn); L.hall.connect(this.hallIn);
        this.L[name] = L;
      }

      this.noise = {
        pink: synthNoise(sr, R, 11.3, 'pink', 2),
        brown: synthNoise(sr, R, 9.1, 'brown', 1),
        white: synthNoise(sr, R, 7.7, 'white', 1),
      };

      this._buildDrone();
      this._buildWind();
      this._buildCrickets();
      this._buildClock();
      this._buildStorm();
      this._buildTape();
      this._buildEvents();
    }

    _buildDrone() {
      const R = this.R, L = this.L.drone;
      const out = this._gain(1);
      this._route(out, L, 1, 0, 0.2);

      // суббас
      const sub = this._osc('sine', 36.71);
      const subG = this._gain(0.16);
      this._lfo(0.043, 0.06, subG.gain);
      sub.connect(subG); subG.connect(out);

      // тёмный пэд на пустой квинте ре–ля; медленно «дышит» громкостью и тембром
      const lp = this._filter('lowpass', 260, 0.9);
      this._lfo(0.019, 150, lp.frequency);
      const lp2 = this._filter('lowpass', 700, 0.5);
      const breathe = this._gain(0.7);
      this._lfo(0.011, 0.3, breathe.gain);
      lp.connect(lp2); lp2.connect(breathe); breathe.connect(out);
      const notes = [[73.42, 0.2, -0.3], [110, 0.13, 0.3], [146.83, 0.05, 0]];
      for (const [f, a, p] of notes) {
        const g = this._gain(a);
        this._lfo(R.range(0.03, 0.08), a * 0.6, g.gain);
        const pan = this._pan(p);
        for (const d of [-5, 5]) {
          const o = this._osc('sawtooth', f);
          o.detune.value = d + R.range(-1.5, 1.5);
          o.connect(g);
        }
        g.connect(pan); pan.connect(lp);
      }

      // диссонансы, которые иногда наплывают: ми-бемоль и ля-бемоль
      this.swells = [];
      for (const [f, p] of [[155.56, 0.35], [103.83, -0.35]]) {
        const g = this._gain(0), flt = this._filter('lowpass', 520, 1), pan = this._pan(p);
        const oscs = [-6, 6].map((d) => { const o = this._osc('sawtooth', f); o.detune.value = d; o.base = d; o.connect(flt); return o; });
        flt.connect(g); g.connect(pan); pan.connect(out);
        this.swells.push({ g, oscs, peak: 0.1, busy: 0 });
      }
      // высокий звон в ушах
      const ringG = this._gain(0);
      for (const f of [2349.3, 2352.8]) { const o = this._osc('sine', f); o.connect(ringG); }
      ringG.connect(out);
      this.swells.push({ g: ringG, oscs: [], peak: 0.006, busy: 0, ring: true });

      // гудение лампы
      const hum = this._osc('sawtooth', 50);
      const hp = this._filter('highpass', 90, 0.7), hlp = this._filter('lowpass', 1100, 0.7);
      const humG = this._gain(0.018);
      this.humFlick = this._gain(1);
      hum.connect(hp); hp.connect(hlp); hlp.connect(humG); humG.connect(this.humFlick); this.humFlick.connect(out);
    }

    _buildWind() {
      const L = this.L.wind;
      this.gust = this._gain(1);
      this._route(this.gust, L, 1, 0, 0.3);

      const src = this._loop(this.noise.pink);
      const bp1 = this._filter('bandpass', 380, 0.9);
      this._lfo(0.013, 180, bp1.frequency);
      const g1 = this._gain(0.9);
      src.connect(bp1); bp1.connect(g1); g1.connect(this.gust);

      const bp2 = this._filter('bandpass', 900, 7);
      this._lfo(0.027, 350, bp2.frequency);
      const g2 = this._gain(0.3);
      this._lfo(0.071, 0.22, g2.gain);
      src.connect(bp2); bp2.connect(g2); g2.connect(this.gust);
      this.whistle = g2;

      const br = this._loop(this.noise.brown);
      const lp = this._filter('lowpass', 140, 0.7);
      const g3 = this._gain(0.5);
      br.connect(lp); lp.connect(g3); g3.connect(this.gust);
    }

    // Каждый сверчок — своя петля 15–24 с с неровным стрекотом (петли разной
    // длины, так что общий рисунок не повторяется). Затихание — через гейт.
    _buildCrickets() {
      const R = this.R, L = this.L.crickets, sr = this.sr;
      this.crickets = [];
      for (let i = 0; i < 4; i++) {
        const carrier = R.range(4000, 4900);
        const chirps = [3, 4].map((p) => synthChirp(sr, R, carrier, p));
        const period = R.range(0.55, 0.95), main = R.int(0, 1);
        const loop = new Float32Array(Math.floor(R.range(15, 24) * sr));
        let t = R.range(0, period);
        while (t < loop.length / sr - period) {
          const ch = chirps[R.chance(0.85) ? main : 1 - main], a = R.range(0.75, 1), s0 = Math.floor(t * sr);
          for (let k = 0; k < ch.length && s0 + k < loop.length; k++) loop[s0 + k] += ch[k] * a;
          // иногда сверчок берёт паузу
          t += R.chance(0.06) ? R.range(2, 5) : period * R.range(0.94, 1.06);
        }
        const src = this._loop(loop);
        const gate = this._gain(1), g = this._gain(R.range(0.35, 1));
        const lp = this._filter('lowpass', R.range(4800, 9000), 0.7);
        const pan = this._pan(R.range(-0.9, 0.9));
        src.connect(gate); gate.connect(g); g.connect(lp); lp.connect(pan);
        this._route(pan, L, 1, 0.15, 0.25);
        this.crickets.push({ gate: gate.gain, hushTo: -1 });
      }
    }

    // Часы: петля «тик–так» ровно 2 с.
    _buildClock() {
      const R = this.R, L = this.L.clock, sr = this.sr;
      const loop = new Float32Array(2 * sr);
      const tick = synthTick(sr, R, true), tock = synthTick(sr, R, false);
      loop.set(tick, 0);
      for (let k = 0; k < tock.length; k++) loop[sr + k] += tock[k] * 0.85;
      const src = this._loop(loop);
      const lp = this._filter('lowpass', 5500, 0.7), pan = this._pan(0.35);
      src.connect(lp); lp.connect(pan);
      this._route(pan, L, 1, 0.5, 0);
    }

    _buildStorm() {
      const L = this.L.storm;
      const rain = this._gain(1);
      this._lfo(0.021, 0.3, rain.gain);
      this._route(rain, L, 1, 0, 0.2);
      const src = this._loop(this.noise.pink);
      src.playbackRate.value = 1.07;
      const hp = this._filter('highpass', 1200, 0.7), lp = this._filter('lowpass', 7000, 0.7), g = this._gain(0.2);
      src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(rain);
      const drops = this._loop(synthDrops(this.sr, this.R, 13.7, 22));
      const dg = this._gain(0.14);
      drops.connect(dg); dg.connect(rain);
    }

    _buildTape() {
      const L = this.L.tape;
      const hiss = this._loop(this.noise.white);
      const hp = this._filter('highpass', 4000, 0.7), g = this._gain(0.06);
      hiss.connect(hp); hp.connect(g);
      this._route(g, L, 1, 0, 0);
      const cr = this._loop(synthCrackle(this.sr, this.R, 9.7, 5));
      const lp = this._filter('lowpass', 6000, 0.7), cg = this._gain(0.25);
      cr.connect(lp); lp.connect(cg);
      this._route(cg, L, 1, 0, 0);
    }

    // ── события ─────────────────────────────────────────────────────
    _gen(first, fire) {
      const g = { first, next: Infinity, fire };
      this.gens.push(g);
      return g;
    }
    _rateMul() { return lerp(1.7, 0.55, this.tension); }
    _eventGen(name, first, interval, fire) {
      const R = this.R;
      this._gen(R.range(first[0], first[1]) * this.firstScale, (t) => {
        if (t >= this.eventsFrom && t <= this.eventsUntil && this.levels[name] > 0.001) fire(t);
        return t + R.range(interval[0], interval[1]) * this._rateMul();
      });
    }
    _hushCrickets(from, dur) {
      for (const c of this.crickets) {
        const to = from + dur + this.R.range(0, 6);
        c.gate.cancelScheduledValues(from);
        c.gate.setTargetAtTime(0, from, 0.05);
        c.gate.setTargetAtTime(1, to, 0.6);
        c.hushTo = to;
      }
    }

    _buildEvents() {
      const R = this.R, sr = this.sr;

      // дыхание за дверью: сначала замолкают сверчки
      this._eventGen('breath', [25, 40], [45, 75], (t) => {
        const L = this.L.breath;
        const side = R.sign();
        const close = R.chance(lerp(0.3, 0.7, this.tension));
        const arr = synthBreath(sr, R, R.int(3, 6));
        const dur = arr.length / sr;
        const lead = this.levels.crickets > 0.001 ? R.range(2.5, 4.5) : 0;
        if (lead) {
          this._hushCrickets(t, lead + dur + R.range(4, 10));
          this._emit(t, 'сверчки затихли…', null, 0, 'hush');
        }
        const tb = t + lead;
        this._play(this._buf(arr), tb, L, {
          gain: close ? 1 : 0.55, pan: side * (close ? 0.85 : 0.6), lp: close ? 7000 : 1900,
          dry: 1, room: close ? 0.35 : 0.7, hall: close ? 0 : 0.35,
        });
        const where = side < 0 ? 'слева' : 'справа';
        this._emit(tb, close ? `дыхание ${where}, совсем рядом` : `дыхание где-то ${where}`, side < 0 ? 'L' : 'R', dur, 'breath');
      });

      // сверчки иногда замолкают просто так
      this._eventGen('crickets', [60, 110], [70, 130], (t) => {
        if (this.crickets.some((c) => t < c.hushTo + 8)) return;
        this._hushCrickets(t, R.range(8, 22));
        this._emit(t, 'сверчки затихли…', null, 0, 'hush');
      });

      // шаги и сервоприводы
      this.stepBufs = [0, 1, 2].map(() => this._buf(synthStep(sr, R)));
      this._eventGen('steps', [40, 70], [55, 95], (t) => {
        const L = this.L.steps;
        const n = R.int(5, 12), iv = R.range(0.75, 1.1);
        const mode = R.pick(['approach', 'pass', 'leave']);
        const side = R.sign();
        let p0, p1, g0, g1;
        if (mode === 'pass') { p0 = side * 0.9; p1 = -side * 0.9; g0 = 0.35; g1 = 0.35; }
        else if (mode === 'approach') { p0 = side * 0.4; p1 = side * 0.85; g0 = 0.2; g1 = 1; }
        else { p0 = side * 0.85; p1 = side * 0.3; g0 = 0.9; g1 = 0.15; }
        const dur = n * iv;
        const pan = this._pan(p0), g = this._gain(g0), lp = this._filter('lowpass', g0 > 0.5 ? 2600 : 700, 0.7);
        pan.pan.setValueAtTime(p0, t); pan.pan.linearRampToValueAtTime(p1, t + dur);
        if (mode === 'pass') {
          g.gain.setValueAtTime(0.2, t); g.gain.linearRampToValueAtTime(0.75, t + dur / 2); g.gain.linearRampToValueAtTime(0.2, t + dur);
          lp.frequency.setValueAtTime(700, t); lp.frequency.linearRampToValueAtTime(2000, t + dur / 2); lp.frequency.linearRampToValueAtTime(700, t + dur);
        } else {
          g.gain.setValueAtTime(g0, t); g.gain.linearRampToValueAtTime(g1, t + dur);
          lp.frequency.setValueAtTime(g0 > 0.5 ? 2600 : 700, t); lp.frequency.linearRampToValueAtTime(g1 > 0.5 ? 2600 : 700, t + dur);
        }
        lp.connect(g); g.connect(pan);
        this._route(pan, L, 1, 0.45, 0.25);
        let tk = t;
        for (let k = 0; k < n; k++) {
          this._play(R.pick(this.stepBufs), tk, L, { to: lp, rate: R.range(0.92, 1.05), gain: R.range(0.75, 1) });
          tk += iv * R.range(0.93, 1.07);
        }
        const sideTag = p1 < 0 ? 'L' : 'R';
        const text = mode === 'approach' ? 'тяжёлые шаги приближаются' : mode === 'leave' ? 'шаги удаляются' : 'кто-то прошёл по коридору';
        this._emit(t, text, mode === 'pass' ? null : sideTag, dur, 'steps');
        if (R.chance(0.55)) {
          const ts = tk + R.range(0.8, 2.5);
          const sv = { pan: p1, gain: mode === 'leave' ? 0.25 : 0.7, lp: 4000, dry: 1, room: 0.5, hall: 0.2 };
          this._play(this._buf(synthServo(sr, R)), ts, L, sv);
          if (R.chance(0.35)) this._play(this._buf(synthServo(sr, R)), ts + R.range(0.9, 1.6), L, sv);
          this._emit(ts, 'жужжание сервопривода', sideTag, 1.2, 'servo');
        }
      });

      // металл и скрипы — где-то далеко, в пустом цеху
      this._eventGen('metal', [8, 20], [16, 34], (t) => {
        const L = this.L.metal;
        const type = R.weighted([['clank', 0.32], ['bounce', 0.12], ['groan', 0.22], ['creak', 0.18], ['reverse', 0.16]]);
        let arr, text, o;
        if (type === 'clank') {
          arr = synthClank(sr, R); text = 'лязг металла вдалеке';
          o = { gain: R.range(0.4, 0.8), lp: R.range(1800, 3500), dry: 0.45, hall: 1 };
        } else if (type === 'reverse') {
          // звук, идущий «задом наперёд»: металл нарастает и обрывается ударом
          const hit = synthClank(sr, R);
          const cutN = Math.min(hit.length, Math.floor(R.range(2.5, 4) * sr));
          arr = new Float32Array(cutN + hit.length);
          for (let i = 0; i < cutN; i++) arr[i] = hit[cutN - 1 - i] * smooth(i / (sr * 0.5));
          for (let i = 0; i < hit.length; i++) arr[cutN + i] += hit[i] * 0.6;
          normalize(arr, 0.9);
          text = 'металл гудит, нарастая';
          o = { gain: R.range(0.4, 0.7), lp: 2600, dry: 0.5, hall: 1 };
        } else if (type === 'bounce') {
          arr = synthBounce(sr, R); text = 'где-то упала труба';
          o = { gain: R.range(0.45, 0.8), lp: 3000, dry: 0.5, hall: 1 };
        } else if (type === 'groan') {
          const k = R.range(0.7, 1.4);
          arr = synthStickSlip(sr, R, {
            dur: R.range(2, 4.5), tail: 1.2, rate: [R.range(6, 14), R.range(18, 40), R.range(8, 16)],
            res: [120, 260, 470, 790, 1250].map((f) => f * k), Q: 32, noise: 0.03,
          });
          text = 'стонет железо';
          o = { gain: R.range(0.35, 0.6), lp: 2200, dry: 0.4, hall: 1 };
        } else {
          arr = synthStickSlip(sr, R, {
            dur: R.range(1.2, 2.6), tail: 0.4, rate: [R.range(18, 28), R.range(55, 85), R.range(30, 45)],
            res: [580, 1150, 1720, 2600].map((f) => f * R.range(0.85, 1.15)), Q: 16, noise: 0.05,
          });
          text = 'скрипнула дверь';
          o = { gain: R.range(0.3, 0.55), lp: 5000, dry: 0.8, room: 0.6, hall: 0.4 };
        }
        o.pan = R.range(-0.8, 0.8);
        this._play(this._buf(arr), t, L, o);
        this._emit(t, text, null, 0, 'metal');
      });

      // расстроенная шкатулка в соседней комнате
      this._eventGen('musicbox', [50, 80], [80, 140], (t) => {
        const L = this.L.musicbox;
        const wind = R.chance(0.5);
        const arr = synthMusicBox(sr, R, R.pick(PHRASES), wind);
        this._play(this._buf(arr), t, L, { gain: 0.8, pan: R.range(-0.5, 0.5), lp: 3200, dry: 0.6, room: 0.5, hall: 0.6 });
        this._emit(t, wind ? 'играет шкатулка… и заедает' : 'где-то играет шкатулка', null, arr.length / sr, 'musicbox');
      });

      // гром
      this._eventGen('storm', [20, 45], [50, 100], (t) => {
        const L = this.L.storm;
        const near = R.chance(0.2);
        this._play(this._buf(synthThunder(sr, R, near)), t, L, { gain: near ? 1.6 : 1.1, dry: 1, hall: 0.3 });
        this._emit(t, near ? 'гром совсем рядом' : 'гром вдалеке', null, 0, near ? 'thunder-near' : 'thunder');
      });

      // лампа мигает
      this._eventGen('drone', [30, 60], [40, 80], (t) => {
        const L = this.L.drone;
        const n = R.int(8, 20);
        const times = [];
        let x = 0;
        for (let k = 0; k < n; k++) { times.push(x); x += R.range(0.03, 0.18); }
        const p = this.humFlick.gain;
        p.cancelScheduledValues(t);
        for (const tt of times) p.setValueAtTime(R.pick([0, 0.15, 2.2, 3.5]), t + tt);
        p.setValueAtTime(1, t + x);
        this._play(this._buf(synthZaps(sr, R, times)), t, L, { gain: 0.5, pan: R.range(-0.3, 0.3), dry: 1, room: 0.4 });
        this._emit(t, 'лампа мигает', null, x, 'flicker');
      });

      // наплывы диссонанса и звона
      this._eventGen('drone', [15, 30], [25, 50], (t) => {
        const s = R.pick(this.swells);
        if (t < s.busy) return;
        const a = R.range(5, 10), h = R.range(2, 6), d = R.range(8, 14);
        s.g.gain.cancelScheduledValues(t);
        s.g.gain.setValueAtTime(0, t);
        s.g.gain.linearRampToValueAtTime(s.peak * R.range(0.6, 1), t + a);
        s.g.gain.setValueAtTime(s.peak * 0.8, t + a + h);
        s.g.gain.linearRampToValueAtTime(0, t + a + h + d);
        for (const o of s.oscs) {
          const base = o.base;
          o.detune.cancelScheduledValues(t);
          o.detune.setValueAtTime(base, t);
          o.detune.linearRampToValueAtTime(base - R.range(15, 35), t + a + h + d);
          o.detune.setValueAtTime(base, t + a + h + d + 0.1);
        }
        s.busy = t + a + h + d + 1;
      });

      // порывы ветра
      this._eventGen('wind', [10, 25], [18, 40], (t) => {
        const a = R.range(2.5, 5), d = R.range(5, 9), peak = R.range(1.6, 2.5);
        const p = this.gust.gain;
        p.cancelScheduledValues(t);
        p.setValueAtTime(1, t); p.linearRampToValueAtTime(peak, t + a); p.linearRampToValueAtTime(1, t + a + d);
      });
    }

    // ── управление ──────────────────────────────────────────────────
    start(t0) {
      if (this.started) return;
      this.started = true;
      this.t0 = t0;
      this.now = t0;
      for (const s of this.sources) s.start(t0);
      for (const g of this.gens) g.next = t0 + g.first;
      this.fade.gain.setValueAtTime(0, t0);
      this.fade.gain.linearRampToValueAtTime(1, t0 + 4);
    }

    // Запланировать всё до момента `until` (now — текущее время контекста).
    schedule(until, now) {
      if (now != null) this.now = now;
      for (;;) {
        let g = null;
        for (const x of this.gens) if (x.next < until && (!g || x.next < g.next)) g = x;
        if (!g) break;
        const t = g.next;
        g.next = g.fire(t);
        if (!(g.next > t)) g.next = t + 0.01;
      }
    }

    setLevel(name, v) {
      this.levels[name] = v;
      const L = this.L[name];
      if (!L) return;
      const target = v * LAYER_GAIN[name], t = this.ctx.currentTime;
      for (const g of [L.dry, L.room, L.hall]) g.gain.setTargetAtTime(target, t, 0.08);
    }
    setTension(v) { this.tension = clamp(v, 0, 1); }
    setVolume(v) {
      this.volume = v;
      this.vol.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
    }
    fadeOut(seconds) {
      const t = this.ctx.currentTime, p = this.fade.gain;
      p.cancelScheduledValues(t);
      p.setValueAtTime(p.value, t);
      p.linearRampToValueAtTime(0, t + seconds);
    }

    // Рендер бесшовного цикла: возвращает { channels: [L, R], sampleRate }.
    static async renderLoop(opts = {}) {
      const seconds = opts.seconds || 120, sampleRate = opts.sampleRate || 44100;
      const P = 10, X = 8, total = P + seconds + X;
      const OAC = root.OfflineAudioContext || root.webkitOfflineAudioContext;
      const ctx = new OAC(2, Math.ceil(total * sampleRate), sampleRate);
      const eng = new NightAmbience(ctx, {
        seed: opts.seed, levels: opts.levels, tension: opts.tension, volume: 1,
        eventsFrom: P + 1, eventsUntil: P + seconds - 16, firstScale: 0.6, raw: opts.raw,
      });
      eng.output.connect(ctx.destination);
      eng.start(0);
      eng.schedule(total, 0);
      if (opts.onProgress && typeof ctx.suspend === 'function') {
        const step = Math.max(4, total / 50);
        for (let t = step; t < total - 1; t += step) {
          try {
            ctx.suspend(t).then(() => { opts.onProgress(t / total); ctx.resume(); }, () => {});
          } catch (e) { break; }
        }
      }
      const buf = await ctx.startRendering();
      const n = Math.round(seconds * sampleRate), p = Math.round(P * sampleRate), x = Math.round(X * sampleRate);
      const channels = [];
      for (let c = 0; c < 2; c++) {
        const src = buf.getChannelData(c), dst = new Float32Array(n);
        dst.set(src.subarray(p, p + n));
        // хвост плавно переходит в начало — шов не слышен
        for (let i = 0; i < x; i++) {
          const a = (i / x) * (Math.PI / 2);
          dst[i] = src[p + i] * Math.sin(a) + src[p + n + i] * Math.cos(a);
        }
        channels.push(dst);
      }
      // громкость: меряем без суббаса (как слышит ухо), пики не выше −1 dBFS
      let peak = 0, sum = 0;
      for (const ch of channels) {
        const hp = new BQ(sampleRate).set('hp', 120, 0.6);
        for (let i = 0; i < n; i++) {
          const v = ch[i], h = hp.tick(v);
          sum += h * h;
          if (Math.abs(v) > peak) peak = Math.abs(v);
        }
      }
      const rms = Math.sqrt(sum / (2 * n));
      if (rms > 0 && opts.normalize !== false) {
        const k = Math.min(TARGET_RMS / rms, 0.89 / peak);
        for (const ch of channels) for (let i = 0; i < n; i++) ch[i] *= k;
      }
      return { channels, sampleRate, seed: eng.seed };
    }
  }

  NightAmbience.LAYERS = LAYERS;
  NightAmbience.DEFAULT_LEVELS = DEFAULT_LEVELS;
  NightAmbience.LAYER_GAIN = LAYER_GAIN;
  root.NightAmbience = NightAmbience;
})(typeof window !== 'undefined' ? window : globalThis);
