/*
 * Look-ahead brickwall limiter (AudioWorklet).
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
