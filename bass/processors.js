/*
 * AudioWorklet processors used by the effect chain:
 *  - "bass-enhancer": the bass boost
 *  - "brickwall-limiter": the final look-ahead limiter
 */

/*
 * Bass enhancer.
 *
 * A Linkwitz-Riley (4th order) crossover at `freq` splits the signal into
 * lows and the rest (LR4 bands sum back flat, so 0 dB is transparent).
 *  - lows: raised by `boost` dB — the sub you feel on headphones and big
 *    speakers;
 *  - upper bass: a bell at 2×freq raised by 0.4×boost — the kick and 808
 *    body that phone and laptop speakers can actually play;
 *  - harmonics: an overdriven copy of the lows, band-limited to freq…4×freq,
 *    so the bass is heard even where the speaker can't reproduce it;
 *  - the bass is soft-clipped against the headroom the rest of the mix
 *    leaves under the ceiling, so vocals and hats keep their level; on big
 *    boosts the rest steps back a little (≤ 3 dB at +24) and the bass is
 *    always given some room, so loud masters get bass too.
 * The headroom curve uses the same look-ahead smoothing as the limiter
 * below, so the clip level never jumps (no clicks).
 */
class BassEnhancer extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'boost', defaultValue: 0, minValue: 0, maxValue: 30, automationRate: 'k-rate' },
      { name: 'freq', defaultValue: 120, minValue: 20, maxValue: 400, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    const sr = sampleRate;
    this.ceiling = Math.pow(10, -1 / 20);
    this.floor = 0.1;
    this.knee = 0.6;
    const L = Math.max(1, Math.round(0.005 * sr));
    const N = L + 1;
    const H = Math.max(N, Math.round(0.01 * sr));
    this.L = L;
    this.N = N;
    this.H = H;
    this.rel = Math.exp(-1 / (0.04 * sr));
    // biquad states: [channel][z…]: LP, LP, HP, HP, upper-bass bell
    this.z = [new Float64Array(10), new Float64Array(10)];
    // harmonics path (mono): HP, HP, LP
    this.zh = new Float64Array(6);
    this.hEnv = 0;
    this.hAtt = Math.exp(-1 / (0.005 * sr));
    this.hRel = Math.exp(-1 / (0.12 * sr));
    this.coef = null;
    this.coefFreq = -1;
    this.bell = null;
    this.bellKey = '';
    // delay lines for lows, highs and harmonics
    this.dLo = [new Float32Array(L), new Float32Array(L)];
    this.dHi = [new Float32Array(L), new Float32Array(L)];
    this.dHm = new Float32Array(L);
    this.dpos = 0;
    // sliding minimum of the allowed bass level
    this.qv = new Float32Array(H + 1);
    this.qi = new Float64Array(H + 1);
    this.qh = 0;
    this.qn = 0;
    this.cap = H + 1;
    this.box = new Float32Array(N).fill(this.ceiling);
    this.bpos = 0;
    this.sum = N * this.ceiling;
    this.env = this.ceiling;
    this.t = 0;
    this.gain = 1;
    this.hiScale = 1;
  }

  setFreq(f) {
    const butter = (fr) => {
      const w = (2 * Math.PI * Math.min(fr, sampleRate * 0.45)) / sampleRate;
      const c = Math.cos(w);
      const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
      const a0 = 1 + alpha;
      return {
        lb0: (1 - c) / 2 / a0, lb1: (1 - c) / a0, lb2: (1 - c) / 2 / a0,
        hb0: (1 + c) / 2 / a0, hb1: -(1 + c) / a0, hb2: (1 + c) / 2 / a0,
        a1: (-2 * c) / a0, a2: (1 - alpha) / a0,
      };
    };
    this.coef = butter(f);
    this.coefH = butter(4 * f); // low-pass that tames the harmonics
    this.coefFreq = f;
  }

  setBell(f, gainDb) {
    const A = Math.pow(10, gainDb / 40);
    const w = (2 * Math.PI * f) / sampleRate;
    const c = Math.cos(w);
    const alpha = Math.sin(w) / (2 * 0.8);
    const a0 = 1 + alpha / A;
    this.bell = {
      b0: (1 + alpha * A) / a0, b1: (-2 * c) / a0, b2: (1 - alpha * A) / a0,
      a1: (-2 * c) / a0, a2: (1 - alpha / A) / a0,
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    const outL = output[0];
    const outR = output[1] || output[0];
    const frames = outL.length;
    const inL = input && input[0];
    const inR = input && (input[1] || input[0]);

    const freq = parameters.freq[0];
    if (!this.coef || Math.abs(freq - this.coefFreq) > 0.25) this.setFreq(freq);
    const { lb0, lb1, lb2, hb0, hb1, hb2, a1, a2 } = this.coef;
    const HC = this.coefH;

    const boostDb = parameters.boost[0];
    const bellKey = `${freq.toFixed(1)}|${(0.4 * boostDb).toFixed(2)}`;
    if (bellKey !== this.bellKey) {
      this.setBell(2 * freq, 0.4 * boostDb);
      this.bellKey = bellKey;
    }
    const { b0: pb0, b1: pb1, b2: pb2, a1: pa1, a2: pa2 } = this.bell;
    const g0 = this.gain;
    const g1 = Math.pow(10, boostDb / 20);
    // Saturation fades in over the first 3 dB so 0 dB is a clean pass-through.
    const mix = Math.min(1, boostDb / 3);
    const harm = (3 * boostDb) / 12;
    const amt = Math.min(1, boostDb / 18);
    const floorB = this.floor + 0.25 * amt;
    const s0 = this.hiScale;
    const s1 = Math.pow(10, (-0.12 * boostDb) / 20);
    const zh = this.zh;
    const dHm = this.dHm;
    let hEnv = this.hEnv;
    const hAtt = this.hAtt, hRel = this.hRel;

    const { L, N, H, ceiling, floor, knee, rel, qv, qi, box, cap } = this;
    const zL = this.z[0], zR = this.z[1];
    const dLoL = this.dLo[0], dLoR = this.dLo[1], dHiL = this.dHi[0], dHiR = this.dHi[1];
    let { dpos, qh, qn, bpos, sum, env, t } = this;

    for (let i = 0; i < frames; i++) {
      const xl = inL ? inL[i] : 0;
      const xr = inR ? inR[i] : 0;

      // LR4 low-pass (two Butterworth sections), left
      let y = lb0 * xl + zL[0]; zL[0] = lb1 * xl - a1 * y + zL[1]; zL[1] = lb2 * xl - a2 * y;
      let v = y;
      y = lb0 * v + zL[2]; zL[2] = lb1 * v - a1 * y + zL[3]; zL[3] = lb2 * v - a2 * y;
      const loL = y;
      // LR4 high-pass, left
      y = hb0 * xl + zL[4]; zL[4] = hb1 * xl - a1 * y + zL[5]; zL[5] = hb2 * xl - a2 * y;
      v = y;
      y = hb0 * v + zL[6]; zL[6] = hb1 * v - a1 * y + zL[7]; zL[7] = hb2 * v - a2 * y;
      v = y;
      y = pb0 * v + zL[8]; zL[8] = pb1 * v - pa1 * y + zL[9]; zL[9] = pb2 * v - pa2 * y;
      const hiL = y;
      // right
      y = lb0 * xr + zR[0]; zR[0] = lb1 * xr - a1 * y + zR[1]; zR[1] = lb2 * xr - a2 * y;
      v = y;
      y = lb0 * v + zR[2]; zR[2] = lb1 * v - a1 * y + zR[3]; zR[3] = lb2 * v - a2 * y;
      const loR = y;
      y = hb0 * xr + zR[4]; zR[4] = hb1 * xr - a1 * y + zR[5]; zR[5] = hb2 * xr - a2 * y;
      v = y;
      y = hb0 * v + zR[6]; zR[6] = hb1 * v - a1 * y + zR[7]; zR[7] = hb2 * v - a2 * y;
      v = y;
      y = pb0 * v + zR[8]; zR[8] = pb1 * v - pa1 * y + zR[9]; zR[9] = pb2 * v - pa2 * y;
      const hiR = y;

      // Harmonics: level-normalised overdrive of the mono lows, keeping only
      // what lies between freq and 4×freq.
      const m = 0.5 * (loL + loR);
      const am = m < 0 ? -m : m;
      hEnv = am + (hEnv - am) * (am > hEnv ? hAtt : hRel);
      let hv = Math.tanh((4 * m) / (hEnv + 1e-4)) * hEnv;
      y = hb0 * hv + zh[0]; zh[0] = hb1 * hv - a1 * y + zh[1]; zh[1] = hb2 * hv - a2 * y;
      hv = y;
      y = hb0 * hv + zh[2]; zh[2] = hb1 * hv - a1 * y + zh[3]; zh[3] = hb2 * hv - a2 * y;
      hv = y;
      y = HC.lb0 * hv + zh[4]; zh[4] = HC.lb1 * hv - HC.a1 * y + zh[5]; zh[5] = HC.lb2 * hv - HC.a2 * y;
      const hm = y;

      // Headroom the highs leave for the bass at this sample.
      const sc = s0 + ((s1 - s0) * (i + 1)) / frames;
      const hsL = hiL * sc, hsR = hiR * sc;
      const ah = Math.max(hsL < 0 ? -hsL : hsL, hsR < 0 ? -hsR : hsR);
      let req = ceiling - ah;
      if (req < floorB) req = floorB;

      // sliding minimum over H samples
      while (qn > 0) {
        const back = (qh + qn - 1) % cap;
        if (qv[back] >= req) qn--;
        else break;
      }
      const slot = (qh + qn) % cap;
      qv[slot] = req;
      qi[slot] = t;
      qn++;
      if (qi[qh] <= t - H) { qh = (qh + 1) % cap; qn--; }
      const held = qv[qh];
      env = held < env ? held : held + (env - held) * rel;
      sum += env - box[bpos];
      box[bpos] = env;
      bpos++;
      if (bpos === N) {
        bpos = 0;
        let s = 0;
        for (let k = 0; k < N; k++) s += box[k];
        sum = s;
      }
      const lim = sum / N;

      // delayed bands
      const lL = dLoL[dpos], lR = dLoR[dpos], hL = dHiL[dpos], hR = dHiR[dpos], hmD = dHm[dpos];
      dLoL[dpos] = loL; dLoR[dpos] = loR; dHiL[dpos] = hsL; dHiR[dpos] = hsR; dHm[dpos] = hm;
      dpos++;
      if (dpos === L) dpos = 0;

      const g = g0 + ((g1 - g0) * (i + 1)) / frames;
      let bl = lL * g + hmD * harm;
      let br = lR * g + hmD * harm;
      if (mix > 0) {
        const k = knee * lim;
        const span = lim - k;
        let a = bl < 0 ? -bl : bl;
        if (a > k) {
          const s = k + span * Math.tanh((a - k) / span);
          bl += mix * ((bl < 0 ? -s : s) - bl);
        }
        a = br < 0 ? -br : br;
        if (a > k) {
          const s = k + span * Math.tanh((a - k) / span);
          br += mix * ((br < 0 ? -s : s) - br);
        }
      }
      outL[i] = hL + bl;
      if (outR !== outL) outR[i] = hR + br;
      t++;
    }

    this.gain = g1;
    this.hiScale = s1;
    this.hEnv = hEnv;
    this.dpos = dpos;
    this.qh = qh;
    this.qn = qn;
    this.bpos = bpos;
    this.sum = sum;
    this.env = env;
    this.t = t;
    return true;
  }
}

registerProcessor('bass-enhancer', BassEnhancer);

/*
 * Look-ahead brickwall limiter.
 *
 * Per sample: required gain r = min(1, ceiling / peak). A sliding minimum
 * (held a bit longer than the look-ahead, so deep bass doesn't make the gain
 * wobble between wave peaks), an exponential release, then a box filter as
 * long as the look-ahead turn it into a smooth gain curve that is at or
 * below r when that sample leaves the delay line — so the output never
 * exceeds the ceiling, without the crackle of hard clipping.
 */
class BrickwallLimiter extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    const L = Math.max(1, Math.round((o.lookahead || 0.005) * sampleRate));
    const N = L + 1;
    const H = Math.max(N, Math.round((o.hold || 0.02) * sampleRate));
    this.L = L;
    this.N = N;
    this.H = H;
    this.ceiling = Math.pow(10, (o.ceilingDb != null ? o.ceilingDb : -1) / 20);
    this.rel = Math.exp(-1 / ((o.release || 0.15) * sampleRate));
    this.delay = [new Float32Array(L), new Float32Array(L)];
    this.dpos = 0;
    // monotonic deque (ring) for the sliding minimum
    this.qv = new Float32Array(H + 1);
    this.qi = new Float64Array(H + 1);
    this.qh = 0;
    this.qn = 0;
    this.cap = H + 1;
    // box filter
    this.box = new Float32Array(N).fill(1);
    this.bpos = 0;
    this.sum = N;
    this.env = 1;
    this.t = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    const inL = input && input[0];
    const inR = input && (input[1] || input[0]);
    const outL = output[0];
    const outR = output[1] || output[0];
    const frames = outL.length;
    const { L, N, H, ceiling, rel, qv, qi, box, cap } = this;
    const dL = this.delay[0];
    const dR = this.delay[1];
    let { dpos, qh, qn, bpos, sum, env, t } = this;

    for (let i = 0; i < frames; i++) {
      const xl = inL ? inL[i] : 0;
      const xr = inR ? inR[i] : 0;
      const al = xl < 0 ? -xl : xl;
      const ar = xr < 0 ? -xr : xr;
      const peak = al > ar ? al : ar;
      const r = peak > ceiling ? ceiling / peak : 1;

      // sliding minimum of r over the last H samples
      while (qn > 0) {
        const back = (qh + qn - 1) % cap;
        if (qv[back] >= r) qn--;
        else break;
      }
      const slot = (qh + qn) % cap;
      qv[slot] = r;
      qi[slot] = t;
      qn++;
      if (qi[qh] <= t - H) { qh = (qh + 1) % cap; qn--; }
      const held = qv[qh];

      // instant attack (the box filter ramps it), smooth release
      env = held < env ? held : held + (env - held) * rel;

      sum += env - box[bpos];
      box[bpos] = env;
      bpos++;
      if (bpos === N) {
        bpos = 0;
        let s = 0;
        for (let k = 0; k < N; k++) s += box[k];
        sum = s;
      }
      let g = sum / N;
      if (g > 1) g = 1;

      let yl = dL[dpos] * g;
      let yr = dR[dpos] * g;
      dL[dpos] = xl;
      dR[dpos] = xr;
      dpos++;
      if (dpos === L) dpos = 0;
      if (yl > 1) yl = 1; else if (yl < -1) yl = -1;
      if (yr > 1) yr = 1; else if (yr < -1) yr = -1;
      outL[i] = yl;
      if (outR !== outL) outR[i] = yr;
      t++;
    }

    this.dpos = dpos;
    this.qh = qh;
    this.qn = qn;
    this.bpos = bpos;
    this.sum = sum;
    this.env = env;
    this.t = t;
    return true;
  }
}

registerProcessor('brickwall-limiter', BrickwallLimiter);
