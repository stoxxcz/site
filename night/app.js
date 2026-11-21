'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  const NA = window.NightAmbience;
  const STORE_KEY = 'night-ambience:v1';
  const HOUR_SECONDS = 90;
  const HOURS = ['12 AM', '1 AM', '2 AM', '3 AM', '4 AM', '5 AM', '6 AM'];
  const LOOKAHEAD = 3;

  const LABELS = {
    drone: 'Гул и лампы', wind: 'Ветер в доме', crickets: 'Сверчки за окном', clock: 'Часы',
    breath: 'Дыхание у двери', steps: 'Шаги и сервоприводы', metal: 'Металл и скрипы',
    musicbox: 'Шкатулка', storm: 'Гроза и дождь', tape: 'Шум плёнки',
  };
  const PRESETS = {
    default: NA.DEFAULT_LEVELS,
    bedroom: { drone: 0.55, wind: 0.7, crickets: 0.8, clock: 0.6, breath: 1, steps: 0.8, metal: 0.25, musicbox: 0.5, storm: 0.25, tape: 0.35 },
    factory: { drone: 1, wind: 0.5, crickets: 0, clock: 0, breath: 0.6, steps: 0.85, metal: 1, musicbox: 0.7, storm: 0.15, tape: 0.5 },
    quiet: { drone: 0.6, wind: 0.5, crickets: 0.5, clock: 0.3, breath: 0.3, steps: 0.3, metal: 0.3, musicbox: 0.35, storm: 0.2, tape: 0.3 },
  };

  // ── настройки ──────────────────────────────────────────────────────
  const settings = load();
  function load() {
    const s = { levels: Object.assign({}, NA.DEFAULT_LEVELS), tension: 0.5, volume: 0.8 };
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (raw) {
        for (const k of NA.LAYERS) if (typeof raw.levels?.[k] === 'number') s.levels[k] = raw.levels[k];
        if (typeof raw.tension === 'number') s.tension = raw.tension;
        if (typeof raw.volume === 'number') s.volume = raw.volume;
      }
    } catch (e) { /* нет хранилища — живём с настройками по умолчанию */ }
    return s;
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
  }

  // ── живое воспроизведение ──────────────────────────────────────────
  let ctx = null, engine = null, analyser = null, timer = null, raf = 0, startedAt = 0;
  const pending = new Set();

  function later(fn, ms) {
    const id = setTimeout(() => { pending.delete(id); fn(); }, Math.max(0, ms));
    pending.add(id);
  }

  function start() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { addLog('Этот браузер не умеет Web Audio.'); return; }
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* ignore */ }
    ctx = new AC({ latencyHint: 'playback' });
    engine = new NA(ctx, {
      levels: settings.levels, tension: settings.tension, volume: settings.volume,
      onEvent: onEngineEvent,
    });
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    engine.output.connect(analyser);
    analyser.connect(ctx.destination);
    const t0 = ctx.currentTime + 0.1;
    engine.start(t0);
    engine.schedule(t0 + LOOKAHEAD, t0);
    timer = setInterval(tick, 250);
    if (ctx.state !== 'running') ctx.resume();
    startedAt = performance.now();
    lastNight = 1; sixUntil = 0;
    clearLog();
    addLog('ночь началась');
    $('play').textContent = '■ Закончить ночь';
    $('play').classList.add('on');
    drawScope();
    mediaSession(true);
  }

  function tick() {
    if (!engine) return;
    engine.schedule(ctx.currentTime + LOOKAHEAD, ctx.currentTime);
    updateClock();
  }

  function stop() {
    if (!engine) return;
    const c = ctx, e = engine;
    e.fadeOut(1.2);
    setTimeout(() => { try { c.close(); } catch (err) { /* ignore */ } }, 1400);
    clearInterval(timer);
    for (const id of pending) clearTimeout(id);
    pending.clear();
    cancelAnimationFrame(raf);
    ctx = engine = analyser = null;
    timer = null;
    $('play').textContent = '▶ Начать ночь';
    $('play').classList.remove('on');
    $('doorL').classList.remove('on');
    $('doorR').classList.remove('on');
    addLog('смена окончена');
    mediaSession(false);
  }

  function onEngineEvent(ev) {
    if (!ctx) return;
    const delay = (ev.time - ctx.currentTime) * 1000;
    later(() => {
      addLog(ev.text);
      if (ev.side) {
        const door = $(ev.side === 'L' ? 'doorL' : 'doorR');
        door.classList.add('on');
        later(() => door.classList.remove('on'), Math.max(1500, ev.dur * 1000));
      }
      if (ev.kind === 'thunder-near') flash();
    }, delay);
  }

  function flash() {
    const b = document.body;
    b.classList.add('flash');
    later(() => b.classList.remove('flash'), 90);
    later(() => b.classList.add('flash'), 200);
    later(() => b.classList.remove('flash'), 260);
  }

  // ── лог и часы ────────────────────────────────────────────────────
  function gameTime() {
    if (!startedAt) return '';
    const s = (performance.now() - startedAt) / 1000;
    const night = Math.floor(s / (HOUR_SECONDS * 6));
    const inNight = s - night * HOUR_SECONDS * 6;
    const h = Math.floor(inNight / HOUR_SECONDS);
    const m = Math.floor(((inNight % HOUR_SECONDS) / HOUR_SECONDS) * 60);
    return { night: night + 1, hour: h, text: `${h === 0 ? 12 : h}:${String(m).padStart(2, '0')}` };
  }
  let lastNight = 1, sixUntil = 0;
  function updateClock() {
    const t = gameTime();
    if (!t) return;
    if (t.night > lastNight) {
      addLog(`6 AM. Ночь ${lastNight} пережита`);
      lastNight = t.night;
      sixUntil = performance.now() + 6000;
    }
    $('hour').textContent = performance.now() < sixUntil ? HOURS[6] : HOURS[t.hour];
    $('nightNo').textContent = `Ночь ${t.night}`;
  }
  function clearLog() { $('log').innerHTML = ''; }
  function addLog(text) {
    const log = $('log');
    const li = document.createElement('li');
    const t = gameTime();
    const time = document.createElement('time');
    time.textContent = t ? t.text.padStart(5, ' ') : '';
    li.append(time, document.createTextNode(text));
    log.prepend(li);
    while (log.children.length > 6) log.lastChild.remove();
  }

  // ── осциллограф ──────────────────────────────────────────────────
  function drawScope() {
    const cv = $('scope'), g = cv.getContext('2d');
    const data = new Float32Array(analyser.fftSize);
    const frame = () => {
      if (!analyser) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.floor(cv.clientWidth * dpr), h = Math.floor(cv.clientHeight * dpr);
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      g.fillStyle = 'rgba(5, 5, 6, 0.32)';
      g.fillRect(0, 0, w, h);
      analyser.getFloatTimeDomainData(data);
      g.strokeStyle = 'rgba(226, 59, 78, 0.85)';
      g.lineWidth = 1.2 * dpr;
      g.beginPath();
      for (let i = 0; i < data.length; i += 2) {
        const x = (i / (data.length - 1)) * w;
        const y = h / 2 - Math.max(-1, Math.min(1, data[i] * 3)) * (h * 0.45);
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke();
      raf = requestAnimationFrame(frame);
    };
    frame();
  }

  function mediaSession(on) {
    if (!('mediaSession' in navigator)) return;
    try {
      if (on) {
        navigator.mediaSession.metadata = new MediaMetadata({ title: 'Ночной эмбиант', artist: 'генератор ночи' });
        navigator.mediaSession.setActionHandler('pause', stop);
        navigator.mediaSession.setActionHandler('stop', stop);
        navigator.mediaSession.setActionHandler('play', () => { if (!engine) start(); });
      }
      navigator.mediaSession.playbackState = on ? 'playing' : 'paused';
    } catch (e) { /* ignore */ }
  }

  document.addEventListener('visibilitychange', () => {
    if (ctx && document.visibilityState === 'visible' && ctx.state !== 'running') ctx.resume();
  });

  // ── элементы управления ──────────────────────────────────────────
  function paint(input) {
    input.style.setProperty('--p', ((input.value - input.min) / (input.max - input.min)) * 100 + '%');
  }

  function setupControls() {
    document.addEventListener('input', (e) => { if (e.target.type === 'range') paint(e.target); });
    $('play').addEventListener('click', () => (engine ? stop() : start()));

    const vol = $('volume'), ten = $('tension');
    vol.value = Math.round(settings.volume * 100);
    ten.value = Math.round(settings.tension * 100);
    $('volumeV').textContent = vol.value;
    $('tensionV').textContent = ten.value;
    paint(vol); paint(ten);
    vol.addEventListener('input', () => {
      settings.volume = vol.value / 100;
      $('volumeV').textContent = vol.value;
      if (engine) engine.setVolume(settings.volume);
      save();
    });
    ten.addEventListener('input', () => {
      settings.tension = ten.value / 100;
      $('tensionV').textContent = ten.value;
      if (engine) engine.setTension(settings.tension);
      save();
    });

    const box = $('layers');
    for (const name of NA.LAYERS) {
      const wrap = document.createElement('div');
      wrap.className = 'layer';
      const id = 'lv-' + name;
      wrap.innerHTML = `<label for="${id}">${LABELS[name]} <b id="${id}-v"></b></label>` +
        `<input id="${id}" type="range" min="0" max="100">`;
      box.append(wrap);
      const input = wrap.querySelector('input');
      input.addEventListener('input', () => setLayer(name, input.value / 100));
    }
    syncLayers();

    document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const p = PRESETS[b.dataset.preset];
      for (const name of NA.LAYERS) setLayer(name, p[name], true);
      syncLayers();
    }));

    $('seed').value = randomSeed();
    $('reseed').addEventListener('click', () => { $('seed').value = randomSeed(); });
    $('render').addEventListener('click', exportLoop);
  }

  function setLayer(name, v, quiet) {
    settings.levels[name] = v;
    if (engine) engine.setLevel(name, v);
    if (!quiet) $('lv-' + name + '-v').textContent = Math.round(v * 100);
    save();
  }
  function syncLayers() {
    for (const name of NA.LAYERS) {
      const v = Math.round(settings.levels[name] * 100);
      $('lv-' + name).value = v;
      paint($('lv-' + name));
      $('lv-' + name + '-v').textContent = v;
    }
  }
  function randomSeed() { return String(Math.floor(100000 + Math.random() * 900000)); }

  // ── экспорт ──────────────────────────────────────────────────────
  let exporting = false;
  async function exportLoop() {
    if (exporting) return;
    exporting = true;
    const btn = $('render'), seconds = Number($('len').value), fmt = $('fmt').value;
    let seed = parseInt($('seed').value, 10);
    if (!Number.isFinite(seed)) { seed = Number(randomSeed()); $('seed').value = seed; }
    btn.disabled = true;
    $('bar').hidden = false;
    const t0 = performance.now();
    try {
      progress(0.02, 'Собираю ночь…');
      await nextFrame();
      const res = await NA.renderLoop({
        seconds, seed, levels: settings.levels, tension: settings.tension,
        onProgress: (p) => progress(0.02 + p * 0.8, `Рендер… ${Math.round(p * 100)}%`),
      });
      progress(0.85, 'Кодирую…');
      await nextFrame();
      const blob = fmt === 'mp3'
        ? await encodeMp3(res.channels, res.sampleRate, (p) => progress(0.85 + p * 0.15, `Кодирую MP3… ${Math.round(p * 100)}%`))
        : encodeWav(res.channels, res.sampleRate);
      const name = `night-ambient-${seconds / 60}min-${seed}.${fmt}`;
      download(blob, name);
      progress(1, `Готово: ${name} (${(blob.size / 1048576).toFixed(1)} МБ, ${((performance.now() - t0) / 1000).toFixed(0)} с)`);
    } catch (err) {
      progress(0, 'Не получилось: ' + (err && err.message ? err.message : err));
    } finally {
      btn.disabled = false;
      exporting = false;
    }
  }

  function progress(p, text) {
    $('barFill').style.width = Math.round(p * 100) + '%';
    $('status').textContent = text;
  }
  function nextFrame() { return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))); }

  function encodeWav(chs, sr) {
    const n = chs[0].length, nc = chs.length;
    const buf = new ArrayBuffer(44 + n * nc * 2), dv = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); dv.setUint32(4, 36 + n * nc * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, nc, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * nc * 2, true);
    dv.setUint16(32, nc * 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * nc * 2, true);
    const out = new Int16Array(buf, 44);
    for (let i = 0, o = 0; i < n; i++) {
      for (let c = 0; c < nc; c++) {
        const v = Math.max(-1, Math.min(1, chs[c][i]));
        out[o++] = v < 0 ? v * 32768 : v * 32767;
      }
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  let lamePromise = null;
  function loadLame() {
    if (window.lamejs) return Promise.resolve();
    if (!lamePromise) {
      const tryLoad = (src) => new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src; s.onload = resolve; s.onerror = reject;
        document.head.append(s);
      });
      lamePromise = tryLoad('../bass/vendor/lame.min.js')
        .catch(() => tryLoad('https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js'))
        .then(() => { if (!window.lamejs) throw new Error('нет MP3-кодека'); })
        .catch((e) => { lamePromise = null; throw e; });
    }
    return lamePromise;
  }

  async function encodeMp3(chs, sr, onProgress) {
    await loadLame();
    const enc = new window.lamejs.Mp3Encoder(2, sr, 192);
    const n = chs[0].length, block = 1152 * 20;
    const L = new Int16Array(block), R = new Int16Array(block);
    const parts = [];
    const toI16 = (src, dst, from, len) => {
      for (let i = 0; i < len; i++) {
        const v = Math.max(-1, Math.min(1, src[from + i]));
        dst[i] = v < 0 ? v * 32768 : v * 32767;
      }
    };
    for (let i = 0; i < n; i += block) {
      const len = Math.min(block, n - i);
      toI16(chs[0], L, i, len); toI16(chs[1], R, i, len);
      const mp3 = enc.encodeBuffer(L.subarray(0, len), R.subarray(0, len));
      if (mp3.length) parts.push(new Uint8Array(mp3));
      if ((i / block) % 10 === 0) { onProgress(i / n); await new Promise((r) => setTimeout(r, 0)); }
    }
    const end = enc.flush();
    if (end.length) parts.push(new Uint8Array(end));
    onProgress(1);
    return new Blob(parts, { type: 'audio/mpeg' });
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  setupControls();
})();
