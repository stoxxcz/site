/*
 * Heavy lifting off the main thread:
 *  - "stretch": change tempo without changing pitch (WSOLA, SoundTouch-style:
 *    flat segments joined by short crossfades at the best-matching offset)
 *  - "encode":  float PCM → MP3 (lamejs) or 16-bit WAV
 */
'use strict';

let lameLoaded = false;

self.onmessage = (e) => {
  const msg = e.data;
  const progress = (value) => self.postMessage({ id: msg.id, kind: 'progress', value });
  try {
    if (msg.type === 'stretch') {
      const channels = stretch(msg.channels, msg.length, msg.speed, msg.sampleRate, progress);
      self.postMessage({ id: msg.id, kind: 'done', channels }, channels.map((c) => c.buffer));
    } else if (msg.type === 'encode') {
      const blob = msg.format === 'wav'
        ? encodeWav(msg.channels, msg.sampleRate, progress)
        : encodeMp3(msg.channels, msg.sampleRate, msg.kbps || 320, progress);
      self.postMessage({ id: msg.id, kind: 'done', blob });
    } else {
      throw new Error('unknown task ' + msg.type);
    }
  } catch (err) {
    self.postMessage({ id: msg.id, kind: 'error', message: String((err && err.message) || err) });
  }
};

/*
 * channels: Float32Arrays holding `length` samples followed by zero padding
 * (at least `stretchPadding(sampleRate)` samples), so reads never go out of range.
 */
function stretch(channels, length, speed, sr, progress) {
  const nCh = channels.length;
  const ms = (x) => Math.round((x * sr) / 1000);
  // Longer segments for slowing down, shorter for speeding up (as SoundTouch).
  const k = Math.min(1, Math.max(0, (speed - 0.5) / 1.5)); // 0 at ×0.5, 1 at ×2
  const S = ms(90 - 40 * k);      // segment length
  const O = ms(12);               // crossfade length
  const W = ms(25 - 10 * k);      // search range
  const C = ms(30);               // length compared when searching (≥ a bass period)
  const D = 8;                    // decimation for the coarse search
  const step = S - O;             // output samples per segment
  const inStep = step * speed;
  const outLen = Math.round(length / speed);

  // Mono analysis signal at full rate and decimated, plus prefix energies of
  // the decimated one for normalised cross-correlation.
  const total = channels[0].length;
  const mono = new Float32Array(total);
  for (let c = 0; c < nCh; c++) {
    const src = channels[c];
    for (let i = 0; i < total; i++) mono[i] += src[i];
  }
  if (nCh > 1) for (let i = 0; i < total; i++) mono[i] /= nCh;
  const dLen = Math.floor(total / D);
  const monoD = new Float32Array(dLen);
  for (let j = 0, i = 0; j < dLen; j++) {
    let s = 0;
    for (let q = 0; q < D; q++) s += mono[i++];
    monoD[j] = s / D;
  }
  const energyD = new Float64Array(dLen + 1);
  for (let j = 0; j < dLen; j++) energyD[j + 1] = energyD[j] + monoD[j] * monoD[j];

  const CD = Math.max(1, Math.floor(C / D));
  const WD = Math.floor(W / D);

  function bestOffset(nominal, mid) {
    // Coarse: decimated signal, every D samples.
    const m0 = Math.round(mid / D);
    const a0 = Math.round(nominal / D);
    let bestJ = 0, bestScore = -Infinity;
    for (let j = 0; j <= WD; j++) {
      const a = a0 + j;
      if (a + CD >= dLen || m0 + CD >= dLen) break;
      let corr = 0;
      for (let i = 0; i < CD; i++) corr += monoD[a + i] * monoD[m0 + i];
      const en = energyD[a + CD] - energyD[a];
      const score = corr / Math.sqrt(en + 1e-9);
      if (score > bestScore) { bestScore = score; bestJ = j; }
    }
    const coarse = (a0 + bestJ) * D - nominal;
    // Fine: full rate around the coarse winner.
    const lo = Math.max(0, coarse - D + 1);
    const hi = Math.min(W, coarse + D - 1);
    let best = Math.min(W, Math.max(0, coarse));
    bestScore = -Infinity;
    for (let d = lo; d <= hi; d++) {
      const a = nominal + d;
      if (a + C >= total || mid + C >= total) break;
      let corr = 0, en = 0;
      for (let i = 0; i < C; i++) {
        const x = mono[a + i];
        corr += x * mono[mid + i];
        en += x * x;
      }
      const score = corr / Math.sqrt(en + 1e-9);
      if (score > bestScore) { bestScore = score; best = d; }
    }
    return best;
  }

  const out = [];
  for (let c = 0; c < nCh; c++) out.push(new Float32Array(outLen + S));

  let op = 0;       // output position
  let ip = 0;       // nominal input position (fractional)
  let mid = -1;     // input position of the tail waiting to be crossfaded
  let lastReport = 0;

  while (op < outLen) {
    const nominal = Math.round(ip);
    if (nominal + S + W + C >= total) {
      // Near the end: copy what's left of the natural continuation.
      if (mid >= 0) {
        const rest = Math.min(outLen - op, total - mid);
        for (let c = 0; c < nCh; c++) {
          const src = channels[c], dst = out[c];
          for (let i = 0; i < rest; i++) dst[op + i] = src[mid + i];
        }
      }
      break;
    }
    if (mid < 0) {
      for (let c = 0; c < nCh; c++) {
        const src = channels[c], dst = out[c];
        for (let i = 0; i < step; i++) dst[op + i] = src[nominal + i];
      }
      mid = nominal + step;
    } else {
      const p = nominal + bestOffset(nominal, mid);
      for (let c = 0; c < nCh; c++) {
        const src = channels[c], dst = out[c];
        for (let i = 0; i < O; i++) {
          const w = (i + 0.5) / O;
          dst[op + i] = src[mid + i] * (1 - w) + src[p + i] * w;
        }
        for (let i = O; i < step; i++) dst[op + i] = src[p + i];
      }
      mid = p + step;
    }
    op += step;
    ip += inStep;
    if (op - lastReport > sr * 2) {
      lastReport = op;
      progress(Math.min(1, op / outLen));
    }
  }

  return out.map((a) => a.slice(0, outLen));
}

function encodeWav(channels, sr, progress) {
  const nCh = channels.length;
  const len = channels[0].length;
  const dataBytes = len * nCh * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, nCh, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * nCh * 2, true);
  v.setUint16(32, nCh * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, dataBytes, true);
  const pcm = new Int16Array(buf, 44);
  const chunk = 1 << 18;
  for (let start = 0; start < len; start += chunk) {
    const end = Math.min(len, start + chunk);
    for (let c = 0; c < nCh; c++) {
      const src = channels[c];
      for (let i = start; i < end; i++) {
        const s = src[i] < -1 ? -1 : src[i] > 1 ? 1 : src[i];
        pcm[i * nCh + c] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
    }
    progress(end / len);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

function encodeMp3(channels, sr, kbps, progress) {
  if (!lameLoaded) {
    importScripts('vendor/lame.min.js');
    lameLoaded = true;
  }
  const stereo = channels.length > 1;
  const left = channels[0];
  const right = stereo ? channels[1] : channels[0];
  const enc = new lamejs.Mp3Encoder(stereo ? 2 : 1, sr, kbps);
  const block = 1152 * 16;
  const l16 = new Int16Array(block);
  const r16 = new Int16Array(block);
  const parts = [];
  const len = left.length;
  let lastReport = 0;
  for (let start = 0; start < len; start += block) {
    const n = Math.min(block, len - start);
    for (let i = 0; i < n; i++) {
      let s = left[start + i];
      s = s < -1 ? -1 : s > 1 ? 1 : s;
      l16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (stereo) {
        s = right[start + i];
        s = s < -1 ? -1 : s > 1 ? 1 : s;
        r16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
    }
    const l = n === block ? l16 : l16.subarray(0, n);
    const r = stereo ? (n === block ? r16 : r16.subarray(0, n)) : undefined;
    const mp3 = stereo ? enc.encodeBuffer(l, r) : enc.encodeBuffer(l);
    if (mp3.length) parts.push(mp3);
    if (start - lastReport > sr * 5) {
      lastReport = start;
      progress(start / len);
    }
  }
  const tail = enc.flush();
  if (tail.length) parts.push(tail);
  progress(1);
  return new Blob(parts, { type: 'audio/mpeg' });
}
