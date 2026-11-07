/*
 * Fallback decoder for files the browser can't decode itself — e.g. M4A with
 * Apple Lossless (ALAC), or AAC in browsers built without it.
 *
 * Runs ffmpeg compiled to WebAssembly (ffmpeg.wasm core, GPL-2.0-or-later,
 * loaded from jsDelivr only when needed — ~32 MB, then browser-cached) and
 * converts the file to 16-bit stereo WAV, which every browser can play and
 * decode.
 */
'use strict';

const CORE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/';
const WASM_SIZE = 32232419;

let corePromise = null;

function post(id, msg, transfer) {
  self.postMessage({ id, ...msg }, transfer || []);
}

async function loadCore(id) {
  importScripts(CORE + 'ffmpeg-core.js');
  const res = await fetch(CORE + 'ffmpeg-core.wasm');
  if (!res.ok || !res.body) throw new Error('decoder download failed: ' + res.status);
  const total = Number(res.headers.get('content-length')) || WASM_SIZE;
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  let last = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (loaded - last > 512 * 1024) {
      last = loaded;
      post(id, { kind: 'progress', stage: 'download', value: Math.min(1, loaded / total) });
    }
  }
  const wasmURL = URL.createObjectURL(new Blob(chunks, { type: 'application/wasm' }));
  post(id, { kind: 'progress', stage: 'download', value: 1 });
  return self.createFFmpegCore({
    mainScriptUrlOrBlob: CORE + 'ffmpeg-core.js#' + btoa(JSON.stringify({ wasmURL })),
  });
}

self.onmessage = async (e) => {
  const { id, data, name, sampleRate } = e.data;
  try {
    if (!corePromise) corePromise = loadCore(id);
    const core = await corePromise;

    const ext = ((/\.([a-z0-9]{1,5})$/i.exec(name || '') || [])[1] || 'bin').toLowerCase();
    const input = 'input.' + ext;
    const output = 'output.wav';
    core.FS.writeFile(input, new Uint8Array(data));

    let duration = 0;
    const log = [];
    core.setLogger(({ message }) => {
      if (log.length < 60) log.push(message);
      const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(message);
      if (m) duration = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
      const t = /time=\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(message);
      if (t && duration > 0) {
        const s = Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3]);
        post(id, { kind: 'progress', stage: 'decode', value: Math.min(1, s / duration) });
      }
    });

    const ret = core.exec(
      '-hide_banner', '-i', input,
      '-map', '0:a:0', '-vn', '-sn', '-dn',
      '-ac', '2', '-ar', String(sampleRate || 44100),
      '-c:a', 'pcm_s16le', '-f', 'wav', output,
    );
    core.reset();
    try { core.FS.unlink(input); } catch (_) { /* ignore */ }
    if (ret !== 0) {
      try { core.FS.unlink(output); } catch (_) { /* ignore */ }
      throw new Error('ffmpeg exit ' + ret + ': ' + log.slice(-4).join(' | '));
    }
    const wav = core.FS.readFile(output);
    core.FS.unlink(output);
    post(id, { kind: 'done', wav }, [wav.buffer]);
  } catch (err) {
    post(id, { kind: 'error', message: String((err && err.message) || err) });
  }
};
