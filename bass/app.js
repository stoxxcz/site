import { DEFAULTS, PRESETS, IR_SECONDS, buildChain, clampParams, makeImpulse, prepareContext } from './dsp.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'bassboost:v1';
const SPEED_TICKS = [0.5, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 2];
const STRETCH_PAD_SECONDS = 0.25;

// ── state ────────────────────────────────────────────────────────────
const state = {
  params: loadSettings().params,
  format: loadSettings().format,
  file: null,
  url: null,
  buffer: null,     // decoded AudioBuffer (waveform + export)
  peaks: null,
  token: 0,         // increments on every new file
  exporting: false,
  hoverX: null,
};

const audio = new Audio();
audio.preload = 'auto';

let ctx = null;
let chain = null;
let analyser = null;
let freqData = null;
let audioReady = null;

// ── settings persistence (per-viewer convenience only) ───────────────
function loadSettings() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (_) { /* ignore */ }
  const format = saved && ['mp3-320', 'mp3-192', 'wav'].includes(saved.format) ? saved.format : 'mp3-320';
  return { params: clampParams(saved && saved.params), format };
}
function saveSettings() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ params: state.params, format: state.format })); } catch (_) { /* ignore */ }
}

// ── audio graph ──────────────────────────────────────────────────────
function ensureAudio() {
  if (audioReady) return audioReady;
  const AC = window.AudioContext || window.webkitAudioContext;
  const c = new AC();
  audioReady = prepareContext(c).then(() => {
    chain = buildChain(c, makeImpulse(c));
    chain.set(state.params);
    const src = c.createMediaElementSource(audio);
    src.connect(chain.input);
    chain.output.connect(c.destination);
    analyser = c.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0.8;
    freqData = new Uint8Array(analyser.frequencyBinCount);
    chain.output.connect(analyser);
    ctx = c;
    return c;
  });
  return audioReady;
}

function applySpeed() {
  const p = state.params;
  for (const k of ['preservesPitch', 'mozPreservesPitch', 'webkitPreservesPitch']) {
    if (k in audio) audio[k] = p.keepPitch;
  }
  audio.defaultPlaybackRate = p.speed;
  audio.playbackRate = p.speed;
}

function applyParams(smooth = true) {
  if (chain) chain.set(state.params, ctx.currentTime, smooth);
  applySpeed();
}

// ── file loading ─────────────────────────────────────────────────────
function looksLikeAudio(file) {
  if (!file) return false;
  if (/^(audio|video)\//.test(file.type)) return true;
  return /\.(mp3|wav|wave|flac|ogg|oga|opus|m4a|m4b|m4r|alac|aac|caf|webm|weba|mp4|mov|aif|aiff|aifc|wma|ape|wv|ac3|mka|mkv)$/i.test(file.name);
}

async function loadFile(file) {
  if (!looksLikeAudio(file)) {
    showDropError('Это не похоже на аудиофайл. Подойдут MP3, M4A, WAV, FLAC, OGG.');
    return;
  }
  const token = ++state.token;
  stop();
  cancelFallbackDecode();
  if (state.url) URL.revokeObjectURL(state.url);
  state.file = file;
  state.url = URL.createObjectURL(file);
  state.buffer = null;
  state.peaks = null;

  $('dropErr').hidden = true;
  $('drop').hidden = true;
  $('player').hidden = false;
  $('changeBtn').hidden = false;
  $('trackName').textContent = baseName(file.name);
  $('trackName').title = file.name;
  $('trackSub').textContent = 'Загружаю…';
  $('playBtn').disabled = true;
  setWaveMessage('');
  $('wave').classList.add('loading');
  updateExportUi();
  resizeCanvases();

  audio.src = state.url;
  audio.load();
  applySpeed();

  const playable = new Promise((resolve) => {
    const ok = () => { cleanup(); resolve(true); };
    const bad = () => { cleanup(); resolve(false); };
    const cleanup = () => {
      audio.removeEventListener('loadedmetadata', ok);
      audio.removeEventListener('error', bad);
    };
    audio.addEventListener('loadedmetadata', ok);
    audio.addEventListener('error', bad);
    setTimeout(bad, 20000);
  });

  await ensureAudio();
  if (token !== state.token) return;

  let fallbackError = '';
  let decoded = await decodeNative(await file.arrayBuffer());
  if (token !== state.token) return;
  let canPlay = await playable;
  if (token !== state.token) return;

  if (!decoded) {
    // The browser can't decode it (e.g. M4A with Apple Lossless): convert it
    // to WAV with ffmpeg.wasm and use that for playback, waveform and export.
    try {
      const wav = await decodeFallback(file, ctx.sampleRate, (stage, f) => {
        if (token !== state.token) return;
        const pct = `${Math.round(f * 100)}%`;
        $('trackSub').textContent = stage === 'download'
          ? `Подключаю декодер для этого формата (32 МБ, один раз)… ${pct}`
          : `Декодирую… ${pct}`;
      });
      if (token !== state.token) return;
      decoded = await decodeNative(await wav.arrayBuffer());
      if (token !== state.token) return;
      if (decoded) {
        URL.revokeObjectURL(state.url);
        state.url = URL.createObjectURL(wav);
        audio.src = state.url;
        applySpeed();
        canPlay = true;
      }
    } catch (err) {
      if (token !== state.token) return;
      console.warn('fallback decoder failed:', err);
      fallbackError = String((err && err.message) || err);
    }
  }
  $('wave').classList.remove('loading');

  if (!decoded && !canPlay) {
    resetToDrop();
    showDropError(/download|fetch|network|importScripts|load/i.test(fallbackError)
      ? 'Для этого формата нужен декодер, а он не скачался. Проверь интернет и попробуй ещё раз.'
      : 'Не получилось открыть этот файл — похоже, он повреждён или это не аудио.');
    return;
  }

  state.buffer = decoded;
  if (decoded) {
    state.peaks = computePeaks(decoded);
  } else {
    setWaveMessage('Волну показать не получилось, но слушать можно');
  }
  if (!canPlay && decoded) {
    // The <audio> element can't play it but Web Audio decoded it: play a WAV copy.
    const wav = await encode('wav', decoded, () => {});
    if (token !== state.token) return;
    URL.revokeObjectURL(state.url);
    state.url = URL.createObjectURL(wav);
    audio.src = state.url;
    applySpeed();
  }

  $('playBtn').disabled = false;
  updateTrackSub();
  updateExportUi();
  drawWave();
  setMediaSession();
}

function decodeNative(data) {
  return new Promise((resolve) => {
    try {
      const p = ctx.decodeAudioData(data, resolve, () => resolve(null));
      if (p && p.catch) p.catch(() => resolve(null));
    } catch (_) {
      resolve(null);
    }
  });
}

let fallbackWorker = null;
function cancelFallbackDecode() {
  if (fallbackWorker) {
    fallbackWorker.terminate();
    fallbackWorker = null;
  }
}

// Runs decoder.js (ffmpeg.wasm) in its own worker, terminated afterwards to
// free its memory; the 32 MB core stays in the browser's HTTP cache.
async function decodeFallback(file, sampleRate, onProgress) {
  const data = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    cancelFallbackDecode();
    const w = new Worker(new URL('./decoder.js', import.meta.url));
    fallbackWorker = w;
    const finish = () => { if (fallbackWorker === w) fallbackWorker = null; w.terminate(); };
    w.onmessage = (e) => {
      const m = e.data;
      if (m.kind === 'progress') { onProgress(m.stage, m.value); return; }
      finish();
      if (m.kind === 'done') resolve(new Blob([m.wav], { type: 'audio/wav' }));
      else reject(new Error(m.message));
    };
    w.onerror = (e) => { finish(); reject(new Error(e.message || 'decoder worker failed')); };
    w.postMessage({ id: 1, data, name: file.name, sampleRate }, [data]);
  });
}

function resetToDrop() {
  stop();
  audio.removeAttribute('src');
  audio.load();
  state.file = null;
  state.buffer = null;
  state.peaks = null;
  $('player').hidden = true;
  $('drop').hidden = false;
  $('changeBtn').hidden = true;
  updateExportUi();
}

function showDropError(text) {
  if (state.file) { toast(text); return; }
  const el = $('dropErr');
  el.textContent = text;
  el.hidden = false;
}

let toastTimer = 0;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4500);
}

function baseName(name) {
  return name.replace(/\.[a-z0-9]{2,5}$/i, '');
}

// ── transport ────────────────────────────────────────────────────────
function play() {
  if (!state.file || !ctx) return;
  if (ctx.state !== 'running') ctx.resume();
  applySpeed();
  const p = audio.play();
  if (p && p.catch) p.catch(() => {});
}
function pause() { audio.pause(); }
function stop() { audio.pause(); }
function toggle() { if (audio.paused) play(); else pause(); }

function duration() {
  if (Number.isFinite(audio.duration) && audio.duration > 0) return audio.duration;
  return state.buffer ? state.buffer.duration : 0;
}
function seekTo(t) {
  const d = duration();
  if (!d) return;
  audio.currentTime = Math.min(Math.max(0, t), Math.max(0, d - 0.01));
  drawWave();
  updateTime();
}
function seekBy(sec) {
  // `sec` is in heard (output) time, so scale by speed.
  seekTo(audio.currentTime + sec * state.params.speed);
}

audio.addEventListener('play', onPlayState);
audio.addEventListener('pause', onPlayState);
audio.addEventListener('ended', onPlayState);
audio.addEventListener('loadedmetadata', () => { applySpeed(); updateTrackSub(); updateTime(); });
audio.addEventListener('seeked', () => { drawWave(); updateTime(); });

function onPlayState() {
  const playing = !audio.paused && !audio.ended;
  // SVG elements have no `hidden` property, so toggle the attribute.
  $('icPlay').toggleAttribute('hidden', playing);
  $('icPause').toggleAttribute('hidden', !playing);
  $('playBtn').setAttribute('aria-label', playing ? 'Пауза' : 'Играть');
  $('player').classList.toggle('playing', playing);
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  if (playing) startLoop();
}

let raf = 0;
let spectrumLevels = null;
function startLoop() {
  if (raf) return;
  const tick = () => {
    drawWave();
    updateTime();
    const alive = drawSpectrum();
    if (!audio.paused || alive) raf = requestAnimationFrame(tick);
    else raf = 0;
  };
  raf = requestAnimationFrame(tick);
}

// ── formatting ───────────────────────────────────────────────────────
function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec + 1e-6);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}
function fmtNum(x, digits) {
  return x.toFixed(digits).replace('.', ',');
}
function fmtSize(bytes) {
  if (bytes > 1e6) return `${fmtNum(bytes / 1048576, 1)} МБ`;
  return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}

function updateTime() {
  const sp = state.params.speed;
  const d = duration();
  $('timeCur').innerHTML = `<b>${fmtTime(audio.currentTime / sp)}</b>`;
  $('timeDur').textContent = fmtTime(d / sp);
  $('wave').setAttribute('aria-valuenow', d ? String(Math.round((audio.currentTime / d) * 100)) : '0');
}

function updateTrackSub() {
  if (!state.file) return;
  const d = duration();
  const parts = [];
  if (d) {
    const sp = state.params.speed;
    parts.push(Math.abs(sp - 1) < 0.005 ? fmtTime(d) : `${fmtTime(d / sp)} (было ${fmtTime(d)})`);
  }
  const ext = (state.file.name.match(/\.([a-z0-9]{2,5})$/i) || [])[1];
  if (ext) parts.push(ext.toUpperCase());
  parts.push(fmtSize(state.file.size));
  $('trackSub').textContent = parts.join(' · ');
}

// ── waveform ─────────────────────────────────────────────────────────
function computePeaks(buffer, n = 4000) {
  const chans = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));
  const len = buffer.length;
  const peaks = new Float32Array(n);
  const block = len / n;
  let max = 0;
  for (let i = 0; i < n; i++) {
    const s = Math.floor(i * block);
    const e = Math.min(len, Math.floor((i + 1) * block));
    const stride = Math.max(1, Math.floor((e - s) / 400));
    let m = 0;
    for (const d of chans) {
      for (let j = s; j < e; j += stride) {
        const v = d[j] < 0 ? -d[j] : d[j];
        if (v > m) m = v;
      }
    }
    peaks[i] = m;
    if (m > max) max = m;
  }
  if (max > 0) for (let i = 0; i < n; i++) peaks[i] /= max;
  return peaks;
}

function resizeCanvases() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  for (const id of ['waveCanvas', 'spectrum']) {
    const cv = $(id);
    const w = Math.round(cv.clientWidth * dpr);
    const h = Math.round(cv.clientHeight * dpr);
    if (w && h && (cv.width !== w || cv.height !== h)) {
      cv.width = w;
      cv.height = h;
    }
  }
  drawWave();
  drawSpectrum(true);
}

function setWaveMessage(text) {
  const el = $('waveMsg');
  el.textContent = text;
  el.hidden = !text;
}

function drawWave() {
  const cv = $('waveCanvas');
  const g = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  if (!W || !H) return;
  g.clearRect(0, 0, W, H);
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const d = duration();
  const frac = d ? Math.min(1, audio.currentTime / d) : 0;
  const px = frac * W;
  const peaks = state.peaks;

  const barW = Math.max(2, Math.round(2.5 * dpr));
  const gap = Math.max(1, Math.round(1.5 * dpr));
  const n = Math.floor(W / (barW + gap));
  const mid = H / 2;

  const path = new Path2D();
  for (let i = 0; i < n; i++) {
    let v;
    if (peaks) {
      const a = Math.floor((i / n) * peaks.length);
      const b = Math.max(a + 1, Math.floor(((i + 1) / n) * peaks.length));
      v = 0;
      for (let j = a; j < b; j++) if (peaks[j] > v) v = peaks[j];
    } else {
      v = 0.08 + 0.05 * Math.sin(i * 0.7);
    }
    const h = Math.max(barW, Math.pow(v, 0.8) * (H - 2));
    const x = i * (barW + gap);
    roundRect(path, x, mid - h / 2, barW, h, barW / 2);
  }

  g.fillStyle = '#34344a';
  g.fill(path);

  if (px > 0) {
    g.save();
    g.beginPath();
    g.rect(0, 0, px, H);
    g.clip();
    const grad = g.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, '#ff3d71');
    grad.addColorStop(1, '#8b5cff');
    g.fillStyle = grad;
    g.fill(path);
    g.restore();
    g.fillStyle = '#fff';
    g.fillRect(Math.min(W - dpr, px), 0, Math.max(1, Math.round(dpr)), H);
  }
}

function roundRect(path, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  path.moveTo(x + r, y);
  path.arcTo(x + w, y, x + w, y + h, r);
  path.arcTo(x + w, y + h, x, y + h, r);
  path.arcTo(x, y + h, x, y, r);
  path.arcTo(x, y, x + w, y, r);
  path.closePath();
}

function setupWaveInput() {
  const wave = $('wave');
  const hover = $('waveHover');
  let dragging = false;
  const timeAt = (clientX) => {
    const r = wave.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return { f, x: f * r.width, t: f * duration() };
  };
  const showHover = (clientX) => {
    if (!duration()) return;
    const { x, t } = timeAt(clientX);
    hover.hidden = false;
    hover.style.left = `${x}px`;
    hover.firstElementChild.textContent = fmtTime(t / state.params.speed);
  };
  wave.addEventListener('pointerdown', (e) => {
    if (!state.file || e.button > 0) return;
    dragging = true;
    wave.setPointerCapture(e.pointerId);
    seekTo(timeAt(e.clientX).t);
    showHover(e.clientX);
  });
  wave.addEventListener('pointermove', (e) => {
    if (dragging) seekTo(timeAt(e.clientX).t);
    if (e.pointerType === 'mouse' || dragging) showHover(e.clientX);
  });
  const end = (e) => {
    dragging = false;
    if (e.pointerType !== 'mouse') hover.hidden = true;
  };
  wave.addEventListener('pointerup', end);
  wave.addEventListener('pointercancel', end);
  wave.addEventListener('pointerleave', () => { if (!dragging) hover.hidden = true; });
  wave.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      seekBy(e.key === 'ArrowLeft' ? -5 : 5);
    } else if (e.key === 'Home') {
      e.preventDefault();
      seekTo(0);
    }
  });
}

// ── spectrum ─────────────────────────────────────────────────────────
const BANDS = 56;
const bandEdges = (() => {
  const lo = 30, hi = 16000;
  const edges = [];
  for (let i = 0; i <= BANDS; i++) edges.push(lo * Math.pow(hi / lo, i / BANDS));
  return edges;
})();

// Returns true while bars are still falling (so the loop keeps running).
function drawSpectrum(force = false) {
  const cv = $('spectrum');
  const g = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  if (!W || !H) return false;
  if (!spectrumLevels) spectrumLevels = new Float32Array(BANDS);
  const playing = !audio.paused && analyser;
  if (playing) analyser.getByteFrequencyData(freqData);
  let alive = false;
  const binHz = ctx ? ctx.sampleRate / 2 / (freqData ? freqData.length : 1) : 1;
  for (let i = 0; i < BANDS; i++) {
    let v = 0;
    if (playing) {
      const a = Math.max(1, Math.floor(bandEdges[i] / binHz));
      const b = Math.max(a + 1, Math.ceil(bandEdges[i + 1] / binHz));
      for (let j = a; j < b && j < freqData.length; j++) if (freqData[j] > v) v = freqData[j];
      v /= 255;
      v = Math.pow(v, 1.6);
    }
    const cur = spectrumLevels[i];
    const next = v > cur ? v : Math.max(v, cur - 0.025);
    spectrumLevels[i] = next;
    if (next > 0.002) alive = true;
  }
  if (!alive && !force && !playing) {
    g.clearRect(0, 0, W, H);
    drawSpectrumBase(g, W, H);
    return false;
  }
  g.clearRect(0, 0, W, H);
  drawSpectrumBase(g, W, H);
  const slot = W / BANDS;
  const bw = Math.max(2, slot * 0.62);
  const grad = g.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, '#ff3d71');
  grad.addColorStop(0.45, '#8b5cff');
  grad.addColorStop(1, '#38d6ff');
  g.fillStyle = grad;
  const path = new Path2D();
  for (let i = 0; i < BANDS; i++) {
    const h = Math.max(0, spectrumLevels[i] * (H - 2));
    if (h < 1) continue;
    roundRect(path, i * slot + (slot - bw) / 2, H - h, bw, h, Math.min(bw / 2, 3));
  }
  g.fill(path);
  return alive || playing;
}
function drawSpectrumBase(g, W, H) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  g.fillStyle = '#20202c';
  g.fillRect(0, H - Math.max(1, Math.round(dpr)), W, Math.max(1, Math.round(dpr)));
}

// ── controls ─────────────────────────────────────────────────────────
const sliders = {
  bass: { el: $('bass'), toUi: (v) => v, fromUi: (v) => v },
  freq: { el: $('freq'), toUi: (v) => v, fromUi: (v) => v },
  speed: {
    el: $('speed'),
    toUi: (v) => Math.log2(v),
    fromUi: (v) => {
      let s = Math.round(Math.pow(2, v) * 100) / 100;
      if (Math.abs(s - 1) < 0.015) s = 1; // gentle snap to ×1
      return s;
    },
  },
  reverb: { el: $('reverb'), toUi: (v) => v, fromUi: (v) => v },
  volume: { el: $('volume'), toUi: (v) => v, fromUi: (v) => v },
};

function setFill(el) {
  const min = Number(el.min), max = Number(el.max), v = Number(el.value);
  const f = (v - min) / (max - min);
  if (el.classList.contains('center')) {
    const c = (0 - min) / (max - min);
    const lo = Math.min(f, c), w = Math.max(f, c) - lo;
    // background-position % is relative to (track − image size), so convert.
    el.style.setProperty('--lo', `${(w >= 1 ? 0 : lo / (1 - w)) * 100}%`);
    el.style.setProperty('--w', `${w * 100}%`);
  } else {
    el.style.setProperty('--p', `${f * 100}%`);
  }
}

function syncUi() {
  const p = state.params;
  for (const [k, s] of Object.entries(sliders)) {
    // The slider being dragged keeps its own position (speed snaps near ×1).
    if (document.activeElement !== s.el || s.fromUi(Number(s.el.value)) !== p[k]) s.el.value = String(s.toUi(p[k]));
    setFill(s.el);
  }
  $('keepPitch').checked = p.keepPitch;

  const bassTxt = p.bass > 0 ? `+${fmtNum(p.bass, p.bass % 1 ? 1 : 0)} дБ` : 'выкл';
  $('bassOut').textContent = bassTxt;
  $('bassBig').textContent = p.bass > 0 ? bassTxt : 'выкл';
  $('freqOut').textContent = `${Math.round(p.freq)} Гц`;
  $('reverbOut').textContent = p.reverb > 0 ? `${Math.round(p.reverb)}%` : 'выкл';
  $('volumeOut').textContent = `${Math.round(p.volume)}%`;

  $('speedBig').textContent = `×${p.speed.toFixed(2)}`;
  let note;
  if (Math.abs(p.speed - 1) < 0.005) {
    note = 'Обычная скорость';
  } else {
    const pct = Math.round((p.speed - 1) * 100);
    const word = pct > 0 ? `быстрее на ${pct}%` : `медленнее на ${-pct}%`;
    if (p.keepPitch) {
      note = `${cap(word)} · тональность та же`;
    } else {
      const semis = 12 * Math.log2(p.speed);
      note = `${cap(word)} · тон ${semis > 0 ? 'выше' : 'ниже'} на ${fmtNum(Math.abs(semis), 1)} полутона`;
    }
  }
  $('speedNote').textContent = note;

  for (const b of $('speedTicks').children) {
    b.classList.toggle('on', Math.abs(Number(b.dataset.v) - p.speed) < 0.001);
  }
  for (const b of $('presets').querySelectorAll('[data-preset]')) {
    const pr = PRESETS.find((x) => x.id === b.dataset.preset);
    b.classList.toggle('on', matchesPreset(pr));
  }
  for (const b of $('fmtSeg').children) b.classList.toggle('on', b.dataset.v === state.format);
  updateTrackSub();
  updateTime();
  updateExportUi();
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function matchesPreset(pr) {
  const p = state.params;
  return Object.entries(pr.p).every(([k, v]) => (typeof v === 'boolean' ? p[k] === v : Math.abs(p[k] - v) < 1e-6));
}

let saveTimer = 0;
function setParams(patch) {
  state.params = clampParams({ ...state.params, ...patch });
  applyParams(true);
  syncUi();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSettings, 300);
}

function setupControls() {
  for (const [k, s] of Object.entries(sliders)) {
    s.el.addEventListener('input', () => {
      setParams({ [k]: s.fromUi(Number(s.el.value)) });
    });
    s.el.addEventListener('dblclick', () => {
      s.el.value = String(s.toUi(DEFAULTS[k]));
      setParams({ [k]: DEFAULTS[k] });
    });
  }
  $('keepPitch').addEventListener('change', (e) => setParams({ keepPitch: e.target.checked }));

  const ticks = $('speedTicks');
  for (const v of SPEED_TICKS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tick';
    b.dataset.v = String(v);
    b.textContent = `×${String(v).replace('.', ',')}`;
    b.addEventListener('click', () => setParams({ speed: v }));
    ticks.appendChild(b);
  }

  const presets = $('presets');
  for (const pr of PRESETS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.preset = pr.id;
    b.textContent = pr.name;
    b.addEventListener('click', () => setParams(pr.p));
    presets.appendChild(b);
  }
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'chip reset';
  reset.textContent = 'Сбросить всё';
  reset.addEventListener('click', () => setParams({ ...DEFAULTS }));
  presets.appendChild(reset);

  for (const b of $('fmtSeg').children) {
    b.addEventListener('click', () => {
      state.format = b.dataset.v;
      saveSettings();
      syncUi();
    });
  }


  $('playBtn').addEventListener('click', toggle);
  $('backBtn').addEventListener('click', () => seekBy(-10));
  $('fwdBtn').addEventListener('click', () => seekBy(10));
  $('loopBtn').addEventListener('click', () => {
    audio.loop = !audio.loop;
    $('loopBtn').classList.toggle('on', audio.loop);
    $('loopBtn').setAttribute('aria-pressed', String(audio.loop));
  });
  $('dlBtn').addEventListener('click', exportTrack);

  const input = $('fileInput');
  const pick = () => { input.value = ''; input.click(); };
  $('pickBtn').addEventListener('click', (e) => { e.stopPropagation(); pick(); });
  $('drop').addEventListener('click', pick);
  $('changeBtn').addEventListener('click', pick);
  input.addEventListener('change', () => {
    const f = input.files && input.files[0];
    if (f) loadFile(f);
  });

  // Drag & drop anywhere on the page.
  let depth = 0;
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    $('dragOverlay').hidden = false;
    $('drop').classList.add('over');
  });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) { $('dragOverlay').hidden = true; $('drop').classList.remove('over'); }
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    $('dragOverlay').hidden = true;
    $('drop').classList.remove('over');
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });

  // Keyboard shortcuts.
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    const tag = t && t.tagName;
    const isRange = tag === 'INPUT' && t.type === 'range';
    if (tag === 'INPUT' && !isRange && t.type !== 'checkbox') return;
    if (e.code === 'Space' || e.key === ' ') {
      if (tag === 'BUTTON' || (tag === 'INPUT' && t.type === 'checkbox')) return;
      if (!state.file) return;
      e.preventDefault();
      toggle();
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !isRange && state.file) {
      e.preventDefault();
      seekBy(e.key === 'ArrowLeft' ? -5 : 5);
    }
  });

  window.addEventListener('resize', resizeCanvases);
  if (window.ResizeObserver) new ResizeObserver(resizeCanvases).observe($('wave'));
}

function setMediaSession() {
  if (!('mediaSession' in navigator) || !state.file) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: baseName(state.file.name), artist: 'Bass Boost' });
    navigator.mediaSession.setActionHandler('play', play);
    navigator.mediaSession.setActionHandler('pause', pause);
    navigator.mediaSession.setActionHandler('seekbackward', () => seekBy(-10));
    navigator.mediaSession.setActionHandler('seekforward', () => seekBy(10));
    navigator.mediaSession.setActionHandler('seekto', (d) => seekTo(d.seekTime * state.params.speed));
  } catch (_) { /* optional */ }
}

// ── export ───────────────────────────────────────────────────────────
let worker = null;
let jobSeq = 0;
const jobs = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.js', import.meta.url));
  worker.onmessage = (e) => {
    const m = e.data;
    const job = jobs.get(m.id);
    if (!job) return;
    if (m.kind === 'progress') job.onProgress(m.value);
    else {
      jobs.delete(m.id);
      if (m.kind === 'done') job.resolve(m);
      else job.reject(new Error(m.message || 'worker error'));
    }
  };
  worker.onerror = (e) => {
    for (const job of jobs.values()) job.reject(new Error(e.message || 'worker error'));
    jobs.clear();
    worker = null;
  };
  return worker;
}

function runJob(msg, transfer, onProgress) {
  const w = getWorker();
  return new Promise((resolve, reject) => {
    const id = ++jobSeq;
    jobs.set(id, { resolve, reject, onProgress });
    w.postMessage({ id, ...msg }, transfer);
  });
}

async function encode(format, buffer, onProgress) {
  const channels = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c).slice());
  const kbps = format === 'mp3-192' ? 192 : 320;
  const res = await runJob(
    { type: 'encode', format: format === 'wav' ? 'wav' : 'mp3', kbps, sampleRate: buffer.sampleRate, channels },
    channels.map((c) => c.buffer),
    onProgress,
  );
  return res.blob;
}

function newBuffer(channels, sampleRate) {
  const len = channels[0].length;
  let b;
  try {
    b = new AudioBuffer({ length: len, numberOfChannels: channels.length, sampleRate });
  } catch (_) {
    b = ctx.createBuffer(channels.length, len, sampleRate);
  }
  channels.forEach((d, c) => {
    if (b.copyToChannel) b.copyToChannel(d, c);
    else b.getChannelData(c).set(d);
  });
  return b;
}

async function stretchBuffer(buffer, speed, onProgress) {
  const pad = Math.ceil(buffer.sampleRate * STRETCH_PAD_SECONDS);
  const channels = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const a = new Float32Array(buffer.length + pad);
    a.set(buffer.getChannelData(c));
    channels.push(a);
  }
  const res = await runJob(
    { type: 'stretch', channels, length: buffer.length, speed, sampleRate: buffer.sampleRate },
    channels.map((c) => c.buffer),
    onProgress,
  );
  return newBuffer(res.channels, buffer.sampleRate);
}

async function renderEffects(source, rate, params, outRate, onProgress) {
  const tail = params.reverb > 0 ? IR_SECONDS : 0.1;
  const seconds = source.duration / rate + tail;
  const length = Math.ceil(seconds * outRate);
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const octx = new OAC(2, length, outRate);
  await prepareContext(octx);
  const ch = buildChain(octx, params.reverb > 0 ? makeImpulse(octx) : null);
  ch.set(params);
  const src = octx.createBufferSource();
  src.buffer = source;
  src.playbackRate.value = rate;
  src.connect(ch.input);
  ch.output.connect(octx.destination);
  src.start(0);

  if (typeof octx.suspend === 'function') {
    const steps = Math.min(50, Math.max(4, Math.floor(seconds / 3)));
    for (let k = 1; k < steps; k++) {
      const t = (seconds * k) / steps;
      try {
        octx.suspend(t).then(() => { onProgress(k / steps); octx.resume(); }, () => {});
      } catch (_) { break; }
    }
  }
  const rendered = await octx.startRendering();
  return trimSilence(rendered, source.duration / rate);
}

// Drop the inaudible end of the reverb tail.
function trimSilence(buffer, minSeconds) {
  const sr = buffer.sampleRate;
  const chans = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));
  let last = Math.min(buffer.length, Math.ceil(minSeconds * sr));
  for (let i = buffer.length - 1; i >= last; i--) {
    let loud = false;
    for (const d of chans) if (d[i] > 3e-4 || d[i] < -3e-4) { loud = true; break; }
    if (loud) { last = i + 1; break; }
  }
  const end = Math.min(buffer.length, last + Math.floor(sr * 0.05));
  if (end >= buffer.length) return buffer;
  return newBuffer(chans.map((d) => d.slice(0, end)), sr);
}

function exportName(params, ext) {
  const tags = [];
  if (params.bass > 0) tags.push('bass boosted');
  if (params.speed < 0.995) tags.push('slowed');
  if (params.speed > 1.005) tags.push('sped up');
  if (params.reverb > 0) tags.push('reverb');
  const base = baseName(state.file.name);
  return `${base}${tags.length ? ` (${tags.join(' + ')})` : ''}.${ext}`;
}

function setProgress(f, text, isError = false) {
  const prog = $('prog');
  prog.hidden = false;
  prog.classList.toggle('err', isError);
  $('progBar').style.width = `${Math.round(Math.min(1, Math.max(0, f)) * 100)}%`;
  $('progText').textContent = text;
}

function updateExportUi() {
  const btn = $('dlBtn');
  const sub = $('exportSub');
  if (state.exporting) {
    btn.disabled = true;
    return;
  }
  if (!state.file) {
    btn.disabled = true;
    sub.textContent = 'Сначала загрузи трек';
  } else if (!state.buffer) {
    btn.disabled = true;
    sub.textContent = $('wave').classList.contains('loading')
      ? 'Читаю трек…'
      : 'Этот формат браузер может только проигрывать — для скачивания нужен MP3 или WAV';
  } else {
    btn.disabled = false;
    const p = state.params;
    const d = state.buffer.duration / p.speed;
    sub.textContent = `Файл со всеми эффектами · ${fmtTime(d)}`;
  }
}

async function exportTrack() {
  if (!state.buffer || state.exporting) return;
  const params = { ...state.params };
  const format = state.format;
  const token = state.token;
  state.exporting = true;
  updateExportUi();
  $('dlBtn').querySelector('span').textContent = 'Готовлю…';

  try {
    const buffer = state.buffer;
    const outRate = format === 'wav' ? buffer.sampleRate : Math.min(48000, buffer.sampleRate);
    const stretching = params.keepPitch && Math.abs(params.speed - 1) > 0.001;
    // Progress budget per stage.
    const stages = stretching ? [0.35, 0.3, 0.35] : [0, 0.4, 0.6];
    let source = buffer;
    let rate = params.speed;
    if (stretching) {
      setProgress(0, 'Меняю скорость, сохраняя тональность…');
      source = await stretchBuffer(buffer, params.speed, (f) => setProgress(f * stages[0], 'Меняю скорость, сохраняя тональность…'));
      rate = 1;
    }
    const base = stages[0];
    setProgress(base, 'Накладываю эффекты…');
    await nextFrame();
    const rendered = await renderEffects(source, rate, params, outRate, (f) => setProgress(base + f * stages[1], 'Накладываю эффекты…'));
    const base2 = stages[0] + stages[1];
    const label = format === 'wav' ? 'Собираю WAV…' : 'Кодирую в MP3…';
    setProgress(base2, label);
    const blob = await encode(format, rendered, (f) => setProgress(base2 + f * stages[2], label));
    if (token !== state.token) throw new Error('track changed');
    const name = exportName(params, format === 'wav' ? 'wav' : 'mp3');
    download(blob, name);
    setProgress(1, `Готово: ${name} · ${fmtSize(blob.size)}`);
  } catch (err) {
    console.error(err);
    if (token === state.token) {
      const mem = /memory|allocation|RangeError/i.test(String(err && (err.name + err.message)));
      setProgress(1, mem
        ? 'Не хватило памяти. Попробуй MP3 вместо WAV или трек покороче.'
        : 'Не получилось сохранить трек. Попробуй ещё раз или выбери другой формат.', true);
    }
  } finally {
    state.exporting = false;
    $('dlBtn').querySelector('span').textContent = 'Скачать';
    updateExportUi();
  }
}

function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// ── boot ─────────────────────────────────────────────────────────────
setupControls();
setupWaveInput();
syncUi();
resizeCanvases();
drawSpectrum(true);
