/* =====================================================================
 *  Stockfish workers. A game review is embarrassingly parallel, so we
 *  run several single-threaded engines (no SharedArrayBuffer needed —
 *  works on any static host and on phones) and hand each one positions.
 * ===================================================================== */

function parseInfo(line) {
  const t = line.split(' ');
  const o = {};
  for (let i = 1; i < t.length; i++) {
    switch (t[i]) {
      case 'depth': o.depth = +t[++i]; break;
      case 'multipv': o.multipv = +t[++i]; break;
      case 'nodes': o.nodes = +t[++i]; break;
      case 'score': {
        const kind = t[++i]; const v = +t[++i];
        if (kind === 'cp') o.cp = v; else if (kind === 'mate') o.mate = v;
        if (t[i + 1] === 'lowerbound' || t[i + 1] === 'upperbound') o.bound = t[++i];
        break;
      }
      case 'pv': o.pv = t.slice(i + 1).filter(Boolean); i = t.length; break;
      case 'string': i = t.length; break;
      default: break;
    }
  }
  return o;
}

export class Stockfish {
  constructor(url) {
    this.url = url;
    this.worker = null;
    this.job = null;          // current search
    this.queue = Promise.resolve();
    this.multipv = 1;
    this.name = 'Stockfish';
  }

  start(hash = 32) {
    return new Promise((resolve, reject) => {
      let w;
      try { w = new Worker(this.url); } catch (e) { reject(e); return; }
      this.worker = w;
      let phase = 'uci';
      const timer = setTimeout(() => reject(new Error('Движок не запустился')), 60000);
      w.onerror = (e) => { if (phase !== 'ready') { clearTimeout(timer); reject(e); } };
      w.onmessage = (e) => {
        const data = typeof e.data === 'string' ? e.data : String(e.data ?? '');
        for (const line of data.split('\n')) {
          if (!line) continue;
          if (phase === 'ready') { this.onLine(line); continue; }
          if (line.startsWith('id name ')) this.name = line.slice(8).trim();
          if (phase === 'uci' && line === 'uciok') {
            phase = 'isready';
            w.postMessage(`setoption name Hash value ${hash}`);
            w.postMessage('isready');
          } else if (phase === 'isready' && line === 'readyok') {
            phase = 'ready'; clearTimeout(timer); resolve(this);
          }
        }
      };
      w.postMessage('uci');
    });
  }

  onLine(line) {
    const job = this.job;
    if (!job) return;
    if (line.startsWith('bestmove')) {
      this.job = null;
      const lines = Object.keys(job.pvs).map(Number).sort((a, b) => a - b).map((k) => job.pvs[k]);
      job.resolve(lines);
      return;
    }
    if (!line.startsWith('info ') || !line.includes(' pv ')) return;
    const o = parseInfo(line);
    if (!o.pv || !o.pv.length || o.bound) return;
    const k = o.multipv || 1;
    job.pvs[k] = { uci: o.pv[0], cp: o.cp, mate: o.mate, pv: o.pv.slice(0, 16), depth: o.depth };
    if (job.onInfo && k === 1) job.onInfo(job.pvs, o.depth);
  }

  /** Analyse a position. Searches are serialised; resolves with MultiPV lines. */
  analyse(fen, { depth = 16, movetime = 0, multipv = 3, onInfo = null } = {}) {
    const run = () => new Promise((resolve) => {
      if (!this.worker) { resolve([]); return; }
      this.job = { pvs: {}, resolve, onInfo };
      if (this.multipv !== multipv) { this.worker.postMessage(`setoption name MultiPV value ${multipv}`); this.multipv = multipv; }
      this.worker.postMessage(`position fen ${fen}`);
      this.worker.postMessage(`go depth ${depth}${movetime ? ` movetime ${movetime}` : ''}`);
    });
    const p = this.queue.then(run);
    this.queue = p.catch(() => {});
    return p;
  }

  stop() { if (this.job && this.worker) this.worker.postMessage('stop'); }

  terminate() {
    try { this.worker && this.worker.terminate(); } catch { /* ignore */ }
    this.worker = null;
    if (this.job) { this.job.resolve([]); this.job = null; }
  }
}

export class EnginePool {
  constructor(url, size) {
    this.url = url;
    this.size = size;
    this.engines = [];
    this.cancelled = false;
  }

  async start() {
    const started = await Promise.allSettled(
      Array.from({ length: this.size }, () => new Stockfish(this.url).start(32)));
    this.engines = started.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    if (!this.engines.length) throw (started[0] && started[0].reason) || new Error('Движок не запустился');
    return this;
  }

  /**
   * Run every job; each engine pulls the next one as soon as it is free.
   * jobs: [{fen, depth, movetime, multipv}] → resolves with an array of line lists.
   */
  async run(jobs, onDone) {
    this.cancelled = false;
    const results = new Array(jobs.length);
    let next = 0;
    const worker = async (eng) => {
      while (!this.cancelled && next < jobs.length) {
        const i = next++;
        const j = jobs[i];
        results[i] = await eng.analyse(j.fen, j);
        if (this.cancelled) return;
        if (onDone) onDone(i, results[i]);
      }
    };
    await Promise.all(this.engines.map(worker));
    return results;
  }

  cancel() {
    this.cancelled = true;
    for (const e of this.engines) e.stop();
  }

  terminate() {
    this.cancel();
    for (const e of this.engines) e.terminate();
    this.engines = [];
  }
}
