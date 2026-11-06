/* =====================================================================
 *  Живой голос тренера: нейросеть Piper (VITS), которая работает прямо
 *  в браузере через onnxruntime-web. Голос скачивается один раз и потом
 *  лежит в кэше браузера. Фонемы — espeak-ng (только русский словарь).
 * ===================================================================== */

const ORT_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.18.0/';
const HF_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/ru/ru_RU/';
const HERE = new URL('./voice/', import.meta.url).href;
const CACHE_NAME = 'coach-voice-v1';

export const VOICES = {
  ruslan: 'Руслан',
  dmitri: 'Дмитрий',
  denis: 'Денис',
  irina: 'Ирина',
};
export const DOWNLOAD_MB = 75;

const scripts = new Map();
function loadScript(src) {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { scripts.delete(src); reject(new Error('Не удалось загрузить ' + src)); };
      document.head.appendChild(s);
    }));
  }
  return scripts.get(src);
}

/** Fetch with progress, kept in the Cache API so it downloads only once. */
async function cachedBuffer(url, onProgress) {
  let cache = null;
  try { cache = await caches.open(CACHE_NAME); } catch { cache = null; }
  if (cache) {
    const hit = await cache.match(url);
    if (hit) { const b = await hit.arrayBuffer(); onProgress && onProgress(b.byteLength, b.byteLength); return b; }
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const total = +res.headers.get('Content-Length') || 0;
  let buf;
  if (res.body && res.body.getReader) {
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      onProgress && onProgress(got, total);
    }
    const out = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    buf = out.buffer;
  } else {
    buf = await res.arrayBuffer();
  }
  if (cache) { try { await cache.put(url, new Response(buf.slice(0))); } catch { /* quota: just don't cache */ } }
  return buf;
}

export async function isDownloaded(voice) {
  try {
    const cache = await caches.open(CACHE_NAME);
    return !!(await cache.match(`${HF_BASE}${voice}/medium/ru_RU-${voice}-medium.onnx`));
  } catch { return false; }
}

export class NeuralVoice {
  constructor() {
    this.voice = null;
    this.loading = null;
    this.session = null;
    this.config = null;
    this.queue = Promise.resolve();
  }

  get ready() { return !!this.session; }

  /** Download (once) and start the model. onProgress(fraction 0..1). */
  load(voice, onProgress) {
    if (this.voice === voice && this.loading) return this.loading;
    this.voice = voice;
    this.session = null;
    const parts = { model: [0, 63e6], dict: [0, 9.3e6], ort: [0, 10e6] };
    const report = () => {
      if (!onProgress) return;
      let got = 0, tot = 0;
      for (const [g, t] of Object.values(parts)) { got += g; tot += Math.max(t, g); }
      onProgress(Math.min(1, got / tot));
    };
    const track = (k) => (g, t) => { parts[k] = [g, t || parts[k][1]]; report(); };
    this.loading = (async () => {
      const path = `${HF_BASE}${voice}/medium/ru_RU-${voice}-medium.onnx`;
      const [, , , model, cfg] = await Promise.all([
        loadScript(ORT_BASE + 'ort.wasm.min.js').then(() => track('ort')(10e6, 10e6)),
        loadScript(HERE + 'piper_phonemize.js'),
        Promise.all([cachedBuffer(HERE + 'piper_phonemize.data', track('dict')), cachedBuffer(HERE + 'piper_phonemize.wasm')])
          .then(([d, w]) => { this.dictBin = d; this.wasmBin = w; }),
        cachedBuffer(path, track('model')),
        cachedBuffer(path + '.json'),
      ]);
      this.config = JSON.parse(new TextDecoder().decode(cfg));
      const ort = window.ort;
      ort.env.wasm.wasmPaths = ORT_BASE;
      ort.env.wasm.numThreads = window.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
      this.session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      onProgress && onProgress(1);
      return this;
    })();
    this.loading.catch(() => { this.loading = null; this.voice = null; });
    return this.loading;
  }

  phonemize(text) {
    return new Promise((resolve, reject) => {
      let done = false;
      window.createPiperPhonemize({
        print: (line) => {
          if (done) return;
          try { done = true; resolve(JSON.parse(line).phoneme_ids); } catch (e) { reject(e); }
        },
        printErr: () => {},
        locateFile: (u) => HERE + u,
        wasmBinary: this.wasmBin,
        getPreloadedPackage: () => this.dictBin.slice(0),
        noInitialRun: true,
      }).then((mod) => {
        mod.callMain(['-l', this.config.espeak.voice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
        if (!done) setTimeout(() => { if (!done) reject(new Error('phonemize failed')); }, 2000);
      }, reject);
    });
  }

  /** Text → {pcm: Float32Array, rate}. Calls are serialised (one inference at a time). */
  synth(text, { speed = 1 } = {}) {
    const run = async () => {
      const ids = await this.phonemize(text);
      const ort = window.ort;
      const inf = this.config.inference;
      const feeds = {
        input: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
        input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
        scales: new ort.Tensor('float32', Float32Array.from([inf.noise_scale, inf.length_scale / speed, inf.noise_w]), [3]),
      };
      if (this.config.num_speakers > 1) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([0n]), [1]);
      const out = await this.session.run(feeds);
      return { pcm: out.output.data, rate: this.config.audio.sample_rate };
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }
}
