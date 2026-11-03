import { Chess, validateFen } from './vendor/chess.js';

/* =====================================================================
 *  Лучший ход — Stockfish 18 analysis board.
 *  The engine analyses every position the moment it appears on the board,
 *  so the best move (and any forced mate) is shown with no button presses.
 * ===================================================================== */

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const FILES = 'abcdefgh';
const ANALYSIS_CAP_MS = 45000;   // stop "infinite" analysis after this, to save battery
const MIN_PLAY_DEPTH = 10;       // "Сделать ход" waits for at least this depth (or ~0.4 s)
const ENGINE_MT = 'engine/stockfish-18-lite.js';
const ENGINE_ST = 'engine/stockfish-18-lite-single.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) {
    try { const v = localStorage.getItem('nm.' + k); return v == null ? d : JSON.parse(v); } catch { return d; }
  },
  set(k, v) { try { localStorage.setItem('nm.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const coarse = matchMedia('(pointer: coarse)').matches;
const cores = Math.max(1, navigator.hardwareConcurrency || 1);

/* ============================== Engine ============================== */

function parseInfo(line) {
  const t = line.split(' ');
  const o = {};
  for (let i = 1; i < t.length; i++) {
    switch (t[i]) {
      case 'depth': o.depth = +t[++i]; break;
      case 'seldepth': o.seldepth = +t[++i]; break;
      case 'multipv': o.multipv = +t[++i]; break;
      case 'nodes': o.nodes = +t[++i]; break;
      case 'nps': o.nps = +t[++i]; break;
      case 'time': o.time = +t[++i]; break;
      case 'hashfull': o.hashfull = +t[++i]; break;
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

class Engine {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.worker = null;
    this.ready = false;
    this.searching = false;
    this.ignore = 0;          // number of stale "bestmove" replies still to swallow
    this.mt = false;
    this.name = 'Stockfish 18';
    this.maxThreads = 1;
    this.opts = {};
  }

  /** optsFor(engine) is called once the build's limits (max threads) are known. */
  async start(preferMt, optsFor) {
    this.optsFor = optsFor;
    if (preferMt) {
      try { await this.boot(ENGINE_MT, true); return; } catch (e) {
        console.warn('Multi-threaded engine failed, using single-threaded one.', e);
        this.kill();
      }
    }
    await this.boot(ENGINE_ST, false);
  }

  kill() {
    try { this.worker && this.worker.terminate(); } catch { /* ignore */ }
    this.worker = null; this.ready = false; this.searching = false; this.ignore = 0;
  }

  boot(url, mt) {
    return new Promise((resolve, reject) => {
      let w;
      try { w = new Worker(url); } catch (e) { reject(e); return; }
      this.worker = w; this.mt = mt;
      let phase = 'uci';
      const timer = setTimeout(() => { if (phase !== 'done') reject(new Error('engine timeout')); }, 45000);
      w.onerror = (e) => {
        if (phase !== 'done') { clearTimeout(timer); reject(e); } else { console.error('engine error', e); }
      };
      w.onmessage = (e) => {
        const data = typeof e.data === 'string' ? e.data : String(e.data ?? '');
        for (const line of data.split('\n')) {
          if (!line) continue;
          if (phase === 'done') { this.line(line); continue; }
          if (phase === 'uci') {
            if (line.startsWith('id name ')) this.name = line.slice(8).trim();
            else if (line.startsWith('option name Threads')) {
              const m = line.match(/ max (\d+)/); if (m) this.maxThreads = +m[1];
            } else if (line === 'uciok') {
              phase = 'ready';
              this.opts = this.optsFor ? this.optsFor(this) : {};
              this.applyOptions();
              w.postMessage('isready');
            }
          } else if (phase === 'ready' && line === 'readyok') {
            // Warm-up: the first "go" loads the NNUE net and spins up threads.
            // Doing it now means the first real analysis starts instantly.
            phase = 'warmup';
            w.postMessage('position startpos');
            w.postMessage('go depth 3');
          } else if (phase === 'warmup' && line.startsWith('bestmove')) {
            phase = 'done'; clearTimeout(timer); this.ready = true; resolve();
          }
        }
      };
      w.postMessage('uci');
    });
  }

  send(cmd) { if (this.worker) this.worker.postMessage(cmd); }

  applyOptions() {
    for (const [k, v] of Object.entries(this.opts)) {
      if (k === 'Threads' && !this.mt) continue;
      this.send(`setoption name ${k} value ${v}`);
    }
  }

  setOptions(opts) {
    Object.assign(this.opts, opts);
    if (!this.ready) return;
    this.stop();
    // Only send what changed: re-sending Hash would wipe the transposition table.
    for (const [k, v] of Object.entries(opts)) {
      if (k === 'Threads' && !this.mt) continue;
      this.send(`setoption name ${k} value ${v}`);
    }
  }

  go(positionCmd, goCmd) {
    if (!this.ready) return false;
    if (this.searching) { this.send('stop'); this.ignore++; }
    this.send(positionCmd);
    this.send(goCmd);
    this.searching = true;
    return true;
  }

  stop() {
    if (this.searching) { this.send('stop'); this.ignore++; this.searching = false; }
  }

  line(line) {
    if (line.startsWith('bestmove')) {
      if (this.ignore > 0) { this.ignore--; return; }
      this.searching = false;
      this.onMessage({ type: 'bestmove', move: line.split(' ')[1] });
      return;
    }
    if (this.ignore > 0) return;                       // output of a search we already abandoned
    if (line.startsWith('info ') && line.includes(' pv ')) {
      this.onMessage({ type: 'info', info: parseInfo(line) });
    }
  }
}

/* ============================== State =============================== */

const S = {
  startFen: START_FEN,
  moves: [],                // [{from,to,promotion,san,uci}]
  cursor: 0,                // number of moves applied
  game: new Chess(),
  orientation: store.get('orientation', 'w'),
  mySide: store.get('side', 'w'),
  autoPlay: store.get('auto', false),
  moveTime: store.get('time', 1000),
  multiPv: store.get('multipv', 1),
  threads: store.get('threads', 0),   // 0 = auto
  hash: store.get('hash', 0),         // 0 = auto
  selected: null,
  targets: [],
  editing: false,
  edit: null,
  analysis: null,
  pendingPlay: false,
  autoTimer: 0,
  capTimer: 0,
};

const engine = new Engine(onEngine);

/* ============================ Utilities ============================= */

const otherColor = (c) => (c === 'w' ? 'b' : 'w');
const colorName = (c, cap = true) => (c === 'w' ? (cap ? 'Белые' : 'белые') : (cap ? 'Чёрные' : 'чёрные'));
const uciOf = (m) => m.from + m.to + (m.promotion || '');
const parseUci = (u) => ({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u[4] : undefined });

function plural(n, one, few, many) {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}

function fmtNum(n) {
  if (n == null) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + ' млн';
  if (n >= 1e3) return Math.round(n / 1e3) + ' тыс';
  return String(n);
}

let toastTimer = 0;
function toast(msg, ms = 2200) {
  const el = $('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

const sanCache = new Map();
function pvToSan(fen, pv, max) {
  const list = pv.slice(0, max);
  const key = fen + '|' + list.join(' ');
  let out = sanCache.get(key);
  if (out) return out;
  out = [];
  try {
    const g = new Chess(fen);
    for (const u of list) out.push(g.move(parseUci(u)).san);
  } catch { /* illegal tail of a stale pv — keep what we have */ }
  if (sanCache.size > 400) sanCache.clear();
  sanCache.set(key, out);
  return out;
}

function numberedLine(fen, sans) {
  const parts = fen.split(' ');
  let turn = parts[1]; let n = parseInt(parts[5], 10) || 1;
  const out = [];
  sans.forEach((s, i) => {
    if (turn === 'w') out.push(`${n}. ${s}`);
    else { out.push(i === 0 ? `${n}… ${s}` : s); n++; }
    turn = otherColor(turn);
  });
  return out.join(' ');
}

/** Score from White's point of view. */
function whiteScore(line, turn) {
  const s = turn === 'w' ? 1 : -1;
  if (line.mate != null) return { mate: line.mate * s };
  if (line.cp != null) return { cp: line.cp * s };
  return null;
}
function fmtScore(ws) {
  if (!ws) return '';
  if (ws.mate != null) return (ws.mate >= 0 ? '#' : '#-') + Math.abs(ws.mate);
  const v = ws.cp / 100;
  return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2);
}
function whitePercent(ws) {
  if (!ws) return 50;
  if (ws.mate != null) return ws.mate > 0 ? 100 : ws.mate < 0 ? 0 : 50;
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * ws.cp)) - 1);
}

/** Repair castling rights / clocks so a loaded FEN is always safe for the engine. */
function normalizeFen(raw) {
  const f = raw.trim().replace(/\s+/g, ' ').split(' ');
  if (!f[0]) return null;
  const defaults = ['', 'w', '-', '-', '0', '1'];
  for (let i = f.length; i < 6; i++) f[i] = defaults[i];
  f.length = 6;
  const rows = f[0].split('/');
  if (rows.length !== 8) return f.join(' ');
  const at = (sq) => {
    const r = 8 - (+sq[1]); const file = sq.charCodeAt(0) - 97;
    let x = 0;
    for (const ch of rows[r]) {
      if (/\d/.test(ch)) { x += +ch; if (x > file) return null; } else { if (x === file) return ch; x++; }
    }
    return null;
  };
  let c = '';
  const cr = f[2] === '-' ? '' : f[2];
  if (at('e1') === 'K') { if (cr.includes('K') && at('h1') === 'R') c += 'K'; if (cr.includes('Q') && at('a1') === 'R') c += 'Q'; }
  if (at('e8') === 'k') { if (cr.includes('k') && at('h8') === 'r') c += 'k'; if (cr.includes('q') && at('a8') === 'r') c += 'q'; }
  f[2] = c || '-';
  if (!/^\d+$/.test(f[4])) f[4] = '0';
  if (!/^[1-9]\d*$/.test(f[5])) f[5] = '1';
  return f.join(' ');
}

/** Returns an error string, or null when the position is playable. */
function positionError(fen) {
  const v = validateFen(fen);
  if (!v.ok) {
    const e = v.error || '';
    if (e.includes('missing white king')) return 'Нет белого короля';
    if (e.includes('missing black king')) return 'Нет чёрного короля';
    if (e.includes('too many white kings')) return 'Больше одного белого короля';
    if (e.includes('too many black kings')) return 'Больше одного чёрного короля';
    if (e.includes('pawns are on the edge')) return 'Пешки не могут стоять на 1-й или 8-й горизонтали';
    return 'Некорректный FEN: ' + e.replace('Invalid FEN: ', '');
  }
  const g = new Chess(fen);
  const board = g.board().flat().filter(Boolean);
  for (const c of ['w', 'b']) {
    const mine = board.filter((p) => p.color === c);
    if (mine.length > 16) return `У ${c === 'w' ? 'белых' : 'чёрных'} больше 16 фигур`;
    if (mine.filter((p) => p.type === 'p').length > 8) return `У ${c === 'w' ? 'белых' : 'чёрных'} больше 8 пешек`;
  }
  const opp = otherColor(g.turn());
  const k = g.findPiece({ type: 'k', color: opp })[0];
  if (k && g.isAttacked(k, g.turn())) return `Король ${opp === 'w' ? 'белых' : 'чёрных'} под шахом, но ход не их`;
  return null;
}

/* ========================= Game management ========================== */

function rebuildGame() {
  const g = new Chess(S.startFen);
  for (let i = 0; i < S.cursor; i++) g.move(S.moves[i]);
  S.game = g;
}

function setGame(startFen, moves, cursor = moves.length) {
  S.startFen = startFen;
  S.moves = moves;
  S.cursor = cursor;
  positionChanged();
}

function commitMove(m) {
  S.moves.length = S.cursor;
  S.moves.push({ from: m.from, to: m.to, promotion: m.promotion, san: m.san, uci: uciOf(m) });
  S.cursor = S.moves.length;
  positionChanged();
}

/** Plays a move given as {from,to,promotion} or SAN/UCI text; returns the move or null. */
function playMove(input) {
  const g = new Chess(S.game.fen());
  let m = null;
  try { m = g.move(input); } catch { m = null; }
  if (!m) return null;
  commitMove(m);
  return m;
}

function goTo(n) {
  n = Math.max(0, Math.min(S.moves.length, n));
  if (n === S.cursor) return;
  S.cursor = n;
  positionChanged();
}

function save() {
  store.set('game', { startFen: S.startFen, moves: S.moves.map((m) => m.uci), cursor: S.cursor });
}

function restore() {
  const params = new URLSearchParams(location.search);
  const urlFen = params.get('fen');
  if (urlFen) {
    const fen = normalizeFen(urlFen);
    if (fen && !positionError(fen)) { S.startFen = fen; S.moves = []; S.cursor = 0; return; }
  }
  const saved = store.get('game', null);
  if (!saved) return;
  try {
    const g = new Chess(saved.startFen);
    const moves = [];
    for (const u of saved.moves || []) {
      const m = g.move(parseUci(u));
      moves.push({ from: m.from, to: m.to, promotion: m.promotion, san: m.san, uci: uciOf(m) });
    }
    S.startFen = saved.startFen; S.moves = moves;
    S.cursor = Math.max(0, Math.min(moves.length, saved.cursor ?? moves.length));
  } catch {
    S.startFen = START_FEN; S.moves = []; S.cursor = 0;
  }
}

function positionChanged() {
  S.selected = null; S.targets = [];
  rebuildGame();
  save();
  renderBoard();
  renderMoveList();
  renderControls();
  startAnalysis();
}

/* ============================ Analysis ============================== */

function positionCommand() {
  const ms = S.moves.slice(0, S.cursor).map((m) => m.uci);
  return 'position fen ' + S.startFen + (ms.length ? ' moves ' + ms.join(' ') : '');
}

function startAnalysis() {
  clearTimeout(S.autoTimer); clearTimeout(S.capTimer);
  const g = S.game;
  const a = {
    fen: g.fen(), turn: g.turn(), lines: [], started: performance.now(),
    done: false, played: false, paused: false, gameOver: g.isGameOver(),
  };
  S.analysis = a;
  S.pendingPlay = false;
  if (a.gameOver || S.editing || !engine.ready || document.hidden) {
    engine.stop();
    if (document.hidden && !a.gameOver) a.paused = true;
    scheduleRender();
    return;
  }
  engine.go(positionCommand(), 'go infinite');
  if (autoArmed()) S.autoTimer = setTimeout(maybeAutoPlay, S.moveTime + 5);
  S.capTimer = setTimeout(() => {
    if (S.analysis === a && !a.done) { engine.stop(); a.done = true; a.paused = true; scheduleRender(); }
  }, ANALYSIS_CAP_MS);
  scheduleRender();
}

function onEngine(msg) {
  const a = S.analysis;
  if (!a) return;
  if (msg.type === 'info') {
    if (a.done) return;
    const i = msg.info;
    if (!i.pv || !i.pv.length) return;
    const idx = (i.multipv || 1) - 1;
    if (i.bound && a.lines[idx]) return;   // keep the last exact score
    a.lines[idx] = {
      depth: i.depth, seldepth: i.seldepth, cp: i.cp, mate: i.mate, pv: i.pv,
      nodes: i.nodes, nps: i.nps, time: i.time,
    };
    if (idx === 0) { a.nodes = i.nodes; a.nps = i.nps; a.time = i.time; a.depth = i.depth; }
    scheduleRender();
    if (S.pendingPlay) playBest();
    maybeAutoPlay();
  } else if (msg.type === 'bestmove') {
    if (a.done) return;
    a.done = true;
    if (msg.move && msg.move !== '(none)' && !a.lines[0]) a.lines[0] = { pv: [msg.move], depth: 0 };
    scheduleRender();
    if (S.pendingPlay) playBest(true);
    maybeAutoPlay(true);
  }
}

function autoArmed() {
  return S.autoPlay && !S.editing && S.game.turn() === S.mySide &&
    S.cursor === S.moves.length && !S.game.isGameOver();
}

function maybeAutoPlay(force = false) {
  const a = S.analysis;
  if (!a || a.played || !autoArmed() || a.fen !== S.game.fen()) return;
  const best = a.lines[0];
  if (!best || !best.pv || !best.pv.length) return;
  const elapsed = performance.now() - a.started;
  const mating = best.mate != null && best.mate > 0 && (best.depth || 0) >= 4;
  if (force || elapsed >= S.moveTime || (mating && elapsed >= Math.min(150, S.moveTime))) {
    a.played = true;
    if (!playMove(parseUci(best.pv[0]))) a.played = false;
  }
}

function playBest(force = false) {
  const a = S.analysis;
  if (S.editing || !a || a.gameOver || a.played || a.fen !== S.game.fen()) return;
  const best = a.lines[0];
  const elapsed = performance.now() - a.started;
  if (best && best.pv && best.pv.length &&
      (force || a.done || best.mate != null || (best.depth || 0) >= MIN_PLAY_DEPTH || elapsed > 400)) {
    a.played = true; S.pendingPlay = false;
    if (!playMove(parseUci(best.pv[0]))) a.played = false;
  } else {
    if (!engine.ready) toast('Движок ещё загружается…');
    S.pendingPlay = true;
    if (a.paused || a.done) startAnalysis();
    S.pendingPlay = true;
  }
}

/* ============================= Rendering ============================ */

const squaresEl = $('squares');
const boardEl = $('board');
const arrowsEl = $('arrows');

function pieceSvg(code, cls = 'pc') {
  return `<svg class="${cls}" viewBox="1.5 1.5 37 37"><use href="#p-${code}" x="1.5" y="1.5" width="37" height="37"/></svg>`;
}

function boardPieces() {
  if (S.editing) return S.edit.board;
  const map = {};
  for (const row of S.game.board()) for (const p of row) if (p) map[p.square] = p;
  return map;
}

function renderBoard() {
  const flip = S.orientation === 'b';
  const pieces = boardPieces();
  const last = !S.editing && S.cursor > 0 ? S.moves[S.cursor - 1] : null;
  let checkSq = null;
  if (!S.editing && S.game.inCheck()) checkSq = S.game.findPiece({ type: 'k', color: S.game.turn() })[0];
  const targets = new Set(S.targets.map((m) => m.to));
  let html = '';
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const f = flip ? 7 - col : col;
      const r = flip ? row : 7 - row;
      const sq = FILES[f] + (r + 1);
      let cls = 'sq ' + ((f + r) % 2 ? 'l' : 'd');
      if (last && (sq === last.from || sq === last.to)) cls += ' last';
      if (sq === S.selected) cls += ' sel';
      if (sq === checkSq) cls += ' check';
      if (targets.has(sq)) cls += pieces[sq] ? ' hint cap' : ' hint';
      html += `<div class="${cls}" data-sq="${sq}">`;
      if (col === 0) html += `<span class="co rk">${r + 1}</span>`;
      if (row === 7) html += `<span class="co fl">${FILES[f]}</span>`;
      const p = pieces[sq];
      if (p) html += pieceSvg(p.color + p.type);
      html += '</div>';
    }
  }
  squaresEl.innerHTML = html;
  $('evalBar').classList.toggle('flip', flip);
  renderArrows();
}

function sqCenter(sq) {
  const f = sq.charCodeAt(0) - 97; const r = +sq[1] - 1;
  return S.orientation === 'w' ? [f + 0.5, 7.5 - r] : [7.5 - f, r + 0.5];
}

function arrowPolygon(from, to, width) {
  const [x1, y1] = sqCenter(from); let [x2, y2] = sqCenter(to);
  const dx = x2 - x1, dy = y2 - y1; const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
  x2 -= ux * 0.12; y2 -= uy * 0.12;
  const head = width * 2.3, hw = width * 1.35, sw = width / 2;
  const bx = x2 - ux * head, by = y2 - uy * head;
  const pts = [
    [x1 + nx * sw, y1 + ny * sw], [bx + nx * sw, by + ny * sw], [bx + nx * hw, by + ny * hw],
    [x2, y2],
    [bx - nx * hw, by - ny * hw], [bx - nx * sw, by - ny * sw], [x1 - nx * sw, y1 - ny * sw],
  ];
  return pts.map((p) => p[0].toFixed(3) + ',' + p[1].toFixed(3)).join(' ');
}

function renderArrows() {
  const a = S.analysis;
  if (S.editing || !a || a.gameOver || a.fen !== S.game.fen()) { arrowsEl.innerHTML = ''; return; }
  const mine = a.turn === S.mySide;
  let svg = '';
  for (let i = Math.min(a.lines.length, S.multiPv) - 1; i >= 0; i--) {
    const l = a.lines[i];
    if (!l || !l.pv || !l.pv[0]) continue;
    const u = l.pv[0];
    const color = i === 0 ? (mine ? 'var(--arrow-me)' : 'var(--arrow-opp)') : 'var(--arrow-alt)';
    const w = i === 0 ? 0.19 : 0.12;
    svg += `<polygon points="${arrowPolygon(u.slice(0, 2), u.slice(2, 4), w)}" style="fill:${color}"/>`;
  }
  arrowsEl.innerHTML = svg;
}

let rafPending = false;
function scheduleRender() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; renderAnalysis(); });
}

function renderAnalysis() {
  renderArrows();
  const a = S.analysis; const g = S.game;
  const card = $('bestCard');
  const label = $('bestLabel'); const moveEl = $('bestMove'); const scoreEl = $('bestScore');
  const mateEl = $('mateBanner'); const pvEl = $('bestPv'); const metaEl = $('bestMeta');
  card.classList.remove('me', 'opp');
  mateEl.hidden = true; mateEl.className = 'mate';

  if (S.editing) {
    label.textContent = 'Редактор позиции'; moveEl.textContent = '✎'; scoreEl.textContent = '';
    pvEl.textContent = 'Расставьте фигуры и нажмите «Готово».'; metaEl.textContent = '';
    setEval(null); renderLines(); return;
  }
  if (!a) return;

  if (a.gameOver) {
    scoreEl.textContent = ''; pvEl.textContent = ''; metaEl.textContent = '';
    if (g.isCheckmate()) {
      const winner = otherColor(g.turn());
      label.textContent = 'Партия окончена';
      moveEl.textContent = 'Мат!';
      mateEl.hidden = false;
      mateEl.textContent = `${colorName(winner)} победили`;
      if (winner !== S.mySide) mateEl.classList.add('lose');
      setEval({ mate: winner === 'w' ? 1 : -1 });
    } else {
      label.textContent = 'Партия окончена';
      moveEl.textContent = 'Ничья';
      pvEl.textContent = g.isStalemate() ? 'Пат.' : g.isInsufficientMaterial() ? 'Недостаточно материала.'
        : g.isThreefoldRepetition() ? 'Троекратное повторение.' : 'Правило 50 ходов.';
      setEval({ cp: 0 });
    }
    renderLines(); return;
  }

  const mine = a.turn === S.mySide;
  card.classList.add(mine ? 'me' : 'opp');
  label.textContent = mine ? `Ваш ход (${colorName(a.turn, false)}) — лучший:` : `Ход соперника (${colorName(a.turn, false)}) — лучший:`;

  const best = a.lines[0];
  if (!best) {
    moveEl.textContent = '…';
    scoreEl.textContent = '';
    pvEl.textContent = '';
    metaEl.textContent = engine.ready ? (a.paused ? 'Анализ на паузе' : 'Считаю…') : 'Загрузка движка…';
    if (a.paused) addResume(metaEl);
    setEval(null);
    renderLines(); return;
  }

  const sans = pvToSan(a.fen, best.pv, best.mate != null ? Math.min(best.pv.length, Math.abs(best.mate) * 2) : 12);
  const firstSan = sans[0] || best.pv[0];
  moveEl.innerHTML = `${firstSan}<small>${best.pv[0].slice(0, 2)}→${best.pv[0].slice(2, 4)}</small>`;
  const ws = whiteScore(best, a.turn);
  scoreEl.textContent = fmtScore(ws);
  setEval(ws);

  if (best.mate != null && best.mate !== 0) {
    const n = Math.abs(best.mate);
    const moves = `${n} ${plural(n, 'ход', 'хода', 'ходов')}`;
    const iWin = (best.mate > 0) === mine;           // the mating side is me
    mateEl.hidden = false;
    if (best.mate > 0 && mine) mateEl.textContent = `Мат в ${moves}!`;
    else if (iWin) mateEl.textContent = `Вы ставите мат в ${moves}`;
    else mateEl.textContent = `Соперник ставит мат в ${moves}`;
    if (!iWin) mateEl.classList.add('lose');
  }
  pvEl.textContent = numberedLine(a.fen, sans);

  const secs = ((best.time ?? a.time ?? 0) / 1000).toFixed(1);
  metaEl.innerHTML = '';
  const bits = [
    `глубина ${best.depth ?? '—'}${best.seldepth ? '/' + best.seldepth : ''}`,
    `${fmtNum(a.nps)} поз/с`,
    `${secs} с`,
  ];
  if (a.paused) bits.push('пауза');
  else if (a.done) bits.push('готово');
  for (const b of bits) { const s = document.createElement('span'); s.textContent = b; metaEl.appendChild(s); }
  if (a.paused) addResume(metaEl);
  renderLines();
}

function addResume(el) {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = '↻ считать дальше';
  b.onclick = () => startAnalysis();
  el.appendChild(b);
}

function setEval(ws) {
  const bar = $('evalBar');
  const pct = whitePercent(ws);
  $('evalFill').style.height = pct + '%';
  bar.classList.toggle('black-better', pct < 50);
  let txt = '';
  if (ws) {
    if (ws.mate != null) txt = (ws.mate ? 'M' + Math.abs(ws.mate) : '');
    else { const v = Math.abs(ws.cp / 100); txt = v >= 10 ? v.toFixed(0) : v.toFixed(1); }
  }
  $('evalText').textContent = txt;
}

function renderLines() {
  const card = $('linesCard'); const list = $('lines');
  const a = S.analysis;
  if (S.multiPv <= 1 || S.editing || !a || a.gameOver || !a.lines.length) { card.hidden = true; return; }
  card.hidden = false;
  let html = '';
  a.lines.slice(0, S.multiPv).forEach((l, i) => {
    if (!l || !l.pv) return;
    const sans = pvToSan(a.fen, l.pv, 10);
    html += `<li data-i="${i}"><span class="score">${fmtScore(whiteScore(l, a.turn))}</span><span class="pv">${numberedLine(a.fen, sans)}</span></li>`;
  });
  list.innerHTML = html;
}

function renderMoveList() {
  const el = $('moveList');
  if (!S.moves.length) { el.innerHTML = '<span class="empty">Ходов пока нет — сделайте ход на доске или нажмите «Сделать ход».</span>'; return; }
  const parts = S.startFen.split(' ');
  let turn = parts[1]; let n = parseInt(parts[5], 10) || 1;
  let html = '';
  S.moves.forEach((m, i) => {
    if (turn === 'w') html += `<span class="n">${n}.</span>`;
    else if (i === 0) html += `<span class="n">${n}…</span>`;
    html += `<span class="m${i + 1 === S.cursor ? ' cur' : ''}" data-i="${i + 1}">${m.san}</span>`;
    if (turn === 'b') n++;
    turn = otherColor(turn);
  });
  el.innerHTML = html;
  // Scroll only the list itself (scrollIntoView would also jump the whole page on phones).
  const cur = el.querySelector('.cur');
  if (cur) {
    const top = cur.offsetTop;
    if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - 24) el.scrollTop = top - el.clientHeight / 2;
  } else if (S.cursor === 0) el.scrollTop = 0;
}

function setSeg(id, value) {
  for (const b of $(id).querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === String(value));
}

function renderControls() {
  setSeg('sideSeg', S.mySide);
  setSeg('timeSeg', S.moveTime);
  setSeg('pvSeg', S.multiPv);
  $('autoPlay').checked = S.autoPlay;
  $('undoBtn').disabled = S.cursor === 0 || S.editing;
  $('redoBtn').disabled = S.cursor >= S.moves.length || S.editing;
  $('playBtn').disabled = S.editing || S.game.isGameOver();
  if (document.activeElement !== $('fenInput')) $('fenInput').value = S.game.fen();
}

function renderEngineStatus(state, text) {
  const el = $('engineStatus');
  el.className = 'status ' + state;
  $('engineText').textContent = text;
}

/* ======================= Board interaction ========================= */

let drag = null;

function squareAt(x, y) {
  const r = boardEl.getBoundingClientRect();
  if (x < r.left || x >= r.right || y < r.top || y >= r.bottom) return null;
  const col = Math.floor(((x - r.left) / r.width) * 8);
  const row = Math.floor(((y - r.top) / r.height) * 8);
  const f = S.orientation === 'w' ? col : 7 - col;
  const rank = S.orientation === 'w' ? 7 - row : row;
  return FILES[f] + (rank + 1);
}
const sqEl = (sq) => squaresEl.querySelector(`[data-sq="${sq}"]`);

function select(sq) {
  S.selected = sq;
  S.targets = sq ? S.game.moves({ square: sq, verbose: true }) : [];
  renderBoard();
}

boardEl.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (!$('promo').hidden) return;
  const sq = squareAt(e.clientX, e.clientY);
  if (!sq) return;
  e.preventDefault();
  if (S.editing) {
    const p = S.edit.board[sq];
    if (p) drag = { from: sq, code: p.color + p.type, x0: e.clientX, y0: e.clientY, moved: false, edit: true };
    else applyEditTool(sq);
    return;
  }
  if (S.selected && S.selected !== sq && S.targets.some((m) => m.to === sq)) {
    tryUserMove(S.selected, sq);
    return;
  }
  const p = S.game.get(sq);
  if (p && p.color === S.game.turn()) {
    const wasSelected = S.selected === sq;
    if (!wasSelected) select(sq);
    drag = { from: sq, code: p.color + p.type, x0: e.clientX, y0: e.clientY, moved: false, deselect: wasSelected };
  } else if (S.selected) {
    select(null);
  }
});

window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.moved) {
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 4) return;
    drag.moved = true;
    const size = boardEl.getBoundingClientRect().width / 8;
    const ghost = document.createElement('div');
    ghost.className = 'ghost';
    ghost.style.width = ghost.style.height = size + 'px';
    ghost.innerHTML = pieceSvg(drag.code, 'pc-ghost');
    ghost.firstChild.style.width = ghost.firstChild.style.height = '100%';
    document.body.appendChild(ghost);
    drag.ghost = ghost; drag.size = size;
    const src = sqEl(drag.from); if (src) src.classList.add('drag-src');
  }
  drag.ghost.style.transform = `translate(${e.clientX - drag.size / 2}px, ${e.clientY - drag.size / 2}px) scale(1.12)`;
  const over = squareAt(e.clientX, e.clientY);
  if (over !== drag.over) {
    if (drag.over) sqEl(drag.over)?.classList.remove('hover');
    if (over) sqEl(over)?.classList.add('hover');
    drag.over = over;
  }
});

function endDrag(e, cancelled) {
  if (!drag) return;
  const d = drag; drag = null;
  if (d.ghost) d.ghost.remove();
  const target = cancelled ? null : squareAt(e.clientX, e.clientY);
  if (d.edit) {
    if (d.moved && !cancelled) {
      const piece = S.edit.board[d.from];
      delete S.edit.board[d.from];
      if (target) S.edit.board[target] = piece;
      renderBoard();
    } else if (!d.moved && !cancelled) applyEditTool(d.from);
    else renderBoard();
    return;
  }
  if (d.moved) {
    if (target && target !== d.from && S.targets.some((m) => m.to === target)) tryUserMove(d.from, target);
    else renderBoard();
  } else if (d.deselect) {
    select(null);
  }
}
window.addEventListener('pointerup', (e) => endDrag(e, false));
window.addEventListener('pointercancel', (e) => endDrag(e, true));

function tryUserMove(from, to) {
  const cands = S.game.moves({ square: from, verbose: true }).filter((m) => m.to === to);
  if (!cands.length) { select(null); return; }
  if (cands.some((m) => m.promotion)) {
    askPromotion(S.game.turn()).then((pr) => {
      if (pr) playMove({ from, to, promotion: pr }); else renderBoard();
    });
    return;
  }
  playMove({ from, to });
}

function askPromotion(color) {
  return new Promise((resolve) => {
    const el = $('promo');
    el.innerHTML = ['q', 'r', 'b', 'n']
      .map((t) => `<button type="button" data-t="${t}" aria-label="${t}">${pieceSvg(color + t, 'p')}</button>`).join('');
    el.hidden = false;
    const done = (v) => { el.hidden = true; el.onclick = null; resolve(v); };
    el.onclick = (ev) => {
      const b = ev.target.closest('button');
      done(b ? b.dataset.t : null);
    };
  });
}

/* ========================== Position editor ========================= */

const PALETTE = ['wk', 'wq', 'wr', 'wb', 'wn', 'wp', 'x', 'bk', 'bq', 'br', 'bb', 'bn', 'bp', 'move'];

function enterEdit() {
  const board = {};
  for (const row of S.game.board()) for (const p of row) if (p) board[p.square] = { type: p.type, color: p.color };
  S.editing = true;
  S.edit = { board, turn: S.game.turn(), tool: 'move' };
  S.selected = null; S.targets = [];
  engine.stop();
  clearTimeout(S.autoTimer);
  $('palette').hidden = false;
  $('posDetails').open = false;
  renderPalette();
  renderBoard(); renderControls(); renderAnalysis();
  $('palette').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function renderPalette() {
  $('palPieces').innerHTML = PALETTE.map((t) => {
    const on = S.edit.tool === t ? ' on' : '';
    if (t === 'x') return `<button type="button" class="tool${on}" data-t="x" title="Ластик">🗑</button>`;
    if (t === 'move') return `<button type="button" class="tool${on}" data-t="move" title="Перетаскивание">✋</button>`;
    return `<button type="button" class="${on.trim()}" data-t="${t}">${pieceSvg(t, 'p')}</button>`;
  }).join('');
  setSeg('editTurnSeg', S.edit.turn);
}

function applyEditTool(sq) {
  const tool = S.edit.tool;
  if (tool === 'move') return;
  const b = S.edit.board;
  if (tool === 'x') delete b[sq];
  else {
    const cur = b[sq];
    if (cur && cur.color + cur.type === tool) delete b[sq];
    else b[sq] = { color: tool[0], type: tool[1] };
  }
  renderBoard();
}

function editFen() {
  const b = S.edit.board;
  const rows = [];
  for (let r = 7; r >= 0; r--) {
    let row = ''; let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = b[FILES[f] + (r + 1)];
      if (!p) { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      row += p.color === 'w' ? p.type.toUpperCase() : p.type;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return normalizeFen(`${rows.join('/')} ${S.edit.turn} KQkq - 0 1`);
}

function exitEdit(apply) {
  if (apply) {
    const fen = editFen();
    const err = positionError(fen);
    if (err) { toast(err, 3000); return; }
    S.editing = false; S.edit = null;
    $('palette').hidden = true;
    setGame(fen, []);
  } else {
    S.editing = false; S.edit = null;
    $('palette').hidden = true;
    positionChanged();
  }
}

$('palPieces').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  S.edit.tool = b.dataset.t; renderPalette();
});
$('editTurnSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  S.edit.turn = b.dataset.v; setSeg('editTurnSeg', S.edit.turn);
});
$('editStart').onclick = () => {
  const g = new Chess(); const board = {};
  for (const row of g.board()) for (const p of row) if (p) board[p.square] = { type: p.type, color: p.color };
  S.edit.board = board; S.edit.turn = 'w'; renderPalette(); renderBoard();
};
$('editClear').onclick = () => {
  S.edit.board = { e1: { type: 'k', color: 'w' }, e8: { type: 'k', color: 'b' } };
  renderBoard();
};
$('editFlip').onclick = () => flip();
$('editCancel').onclick = () => exitEdit(false);
$('editDone').onclick = () => exitEdit(true);

/* ============================== Controls ============================ */

function flip() {
  S.orientation = otherColor(S.orientation);
  store.set('orientation', S.orientation);
  renderBoard();
}

$('playBtn').onclick = () => playBest();
$('undoBtn').onclick = () => goTo(S.cursor - 1);
$('redoBtn').onclick = () => goTo(S.cursor + 1);
$('flipBtn').onclick = () => flip();

$('sideSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  S.mySide = b.dataset.v; store.set('side', S.mySide);
  S.orientation = S.mySide; store.set('orientation', S.orientation);
  renderControls(); renderBoard(); scheduleRender();
  if (autoArmed()) { clearTimeout(S.autoTimer); S.autoTimer = setTimeout(maybeAutoPlay, S.moveTime); maybeAutoPlay(); }
});
$('autoPlay').addEventListener('change', (e) => {
  S.autoPlay = e.target.checked; store.set('auto', S.autoPlay);
  if (autoArmed()) {
    if (S.analysis && S.analysis.done) startAnalysis();
    clearTimeout(S.autoTimer); S.autoTimer = setTimeout(maybeAutoPlay, S.moveTime);
    maybeAutoPlay();
  }
});
$('timeSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  S.moveTime = +b.dataset.v; store.set('time', S.moveTime); renderControls();
});
$('pvSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  S.multiPv = +b.dataset.v; store.set('multipv', S.multiPv); renderControls();
  engine.setOptions({ MultiPV: S.multiPv });
  startAnalysis();
});
$('threadsSel').addEventListener('change', (e) => {
  S.threads = +e.target.value; store.set('threads', S.threads);
  engine.setOptions({ Threads: effectiveThreads() });
  updateEngineStatus();
  startAnalysis();
});
$('hashSel').addEventListener('change', (e) => {
  S.hash = +e.target.value; store.set('hash', S.hash);
  engine.setOptions({ Hash: effectiveHash() });
  updateEngineStatus();
  startAnalysis();
});

$('lines').addEventListener('click', (e) => {
  const li = e.target.closest('li'); if (!li) return;
  const l = S.analysis && S.analysis.lines[+li.dataset.i];
  if (l && l.pv && l.pv[0] && !S.analysis.played) { S.analysis.played = true; playMove(parseUci(l.pv[0])); }
});
$('moveList').addEventListener('click', (e) => {
  const m = e.target.closest('.m'); if (m) goTo(+m.dataset.i);
});

$('moveForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('moveInput');
  let text = input.value.trim().replace(/[–—−]/g, '-').replace(/0/g, 'O');
  if (!text || S.editing) return;
  // Accept Russian piece letters too: К Ф Л С Кр
  text = text.replace(/^Кр/i, 'K').replace(/^Ф/i, 'Q').replace(/^Л/i, 'R').replace(/^С/i, 'B').replace(/^К/, 'N');
  // UCI-style (e2e4 / e7e8q)
  const uci = text.toLowerCase().replace(/[-x:]/g, '');
  let m = null;
  if (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) m = playMove(parseUci(uci));
  if (!m) m = playMove(text);
  if (!m && /^[a-h]/.test(text)) m = playMove(text.toLowerCase());
  if (m) { input.value = ''; input.classList.remove('bad'); }
  else {
    input.classList.remove('bad'); void input.offsetWidth; input.classList.add('bad');
    toast('Ход не распознан или невозможен');
  }
});

$('newGameBtn').onclick = () => { setGame(START_FEN, []); $('posDetails').open = false; };
$('editBtn').onclick = () => enterEdit();
$('fenLoad').onclick = () => {
  const fen = normalizeFen($('fenInput').value);
  const err = fen ? positionError(fen) : 'Пустой FEN';
  if (err) { toast(err, 3000); return; }
  setGame(fen, []);
  toast('Позиция загружена');
};
$('fenInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('fenLoad').click(); });
$('fenCopy').onclick = () => copy(S.game.fen(), 'FEN скопирован');

$('pgnLoad').onclick = () => {
  const text = $('pgnInput').value.trim();
  if (!text) { toast('Вставьте PGN'); return; }
  const g = new Chess();
  try { g.loadPgn(text, { strict: false }); } catch (err) { toast('Не удалось прочитать PGN', 3000); return; }
  const hist = g.history({ verbose: true });
  const start = hist.length ? hist[0].before : g.fen();
  setGame(start, hist.map((m) => ({ from: m.from, to: m.to, promotion: m.promotion, san: m.san, uci: uciOf(m) })));
  toast(`Загружено ходов: ${hist.length}`);
};
$('pgnCopy').onclick = () => {
  const g = new Chess(S.startFen);
  for (const m of S.moves) g.move(m);
  copy(g.pgn(), 'PGN скопирован');
};

async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); } catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta);
    ta.select(); try { document.execCommand('copy'); toast(msg); } catch { toast('Не удалось скопировать'); }
    ta.remove();
  }
}

document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (S.editing) { if (e.key === 'Escape') exitEdit(false); return; }
  switch (e.key) {
    case ' ': case 'Enter':
      if (t && t.tagName === 'BUTTON' && e.key === 'Enter') return;
      e.preventDefault(); playBest(); break;
    case 'ArrowLeft': e.preventDefault(); goTo(S.cursor - 1); break;
    case 'ArrowRight': e.preventDefault(); goTo(S.cursor + 1); break;
    case 'Home': goTo(0); break;
    case 'End': goTo(S.moves.length); break;
    case 'f': case 'F': case 'а': case 'А': flip(); break;
    case 'Escape': if (S.selected) select(null); break;
    default: break;
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (S.analysis && !S.analysis.done) { engine.stop(); S.analysis.paused = true; S.analysis.done = true; }
    clearTimeout(S.autoTimer);
    scheduleRender();
  } else if (!S.editing) {
    startAnalysis();
  }
});

/* ============================== Startup ============================= */

function effectiveThreads() {
  if (!engine.mt) return 1;
  const max = Math.min(engine.maxThreads, cores);
  const auto = Math.max(1, Math.min(cores - 1, 16));
  return Math.max(1, Math.min(max, S.threads || auto));
}
function effectiveHash() {
  if (S.hash) return S.hash;
  return coarse ? 64 : 128;
}

function fillEngineSettings() {
  const sel = $('threadsSel');
  if (engine.mt) {
    const max = Math.min(engine.maxThreads, cores);
    let html = `<option value="0">Авто (${effectiveThreadsFor(0)})</option>`;
    for (let i = 1; i <= max; i++) html += `<option value="${i}">${i}</option>`;
    sel.innerHTML = html; sel.value = String(S.threads <= max ? S.threads : 0); sel.disabled = false;
    $('engineNote').textContent = `Многопоточный режим: ${cores} ${plural(cores, 'ядро', 'ядра', 'ядер')} доступно.`;
  } else {
    sel.innerHTML = '<option value="1">1</option>'; sel.disabled = true;
    $('engineNote').textContent = 'Однопоточный режим: браузер не дал включить многопоточность '
      + '(нужен HTTPS и поддержка SharedArrayBuffer). Движок всё равно очень сильный.';
  }
  const hs = $('hashSel'); hs.value = String(effectiveHash());
}
function effectiveThreadsFor(v) { const s = S.threads; S.threads = v; const r = effectiveThreads(); S.threads = s; return r; }

function updateEngineStatus() {
  const th = effectiveThreads();
  renderEngineStatus('ok', `${engine.name.replace(/\s+lite.*$/i, '')} · ${th} ${plural(th, 'поток', 'потока', 'потоков')} · ${effectiveHash()} МБ`);
}

async function boot() {
  restore();
  rebuildGame();
  renderBoard(); renderMoveList(); renderControls();
  S.analysis = { fen: S.game.fen(), turn: S.game.turn(), lines: [], started: performance.now(), gameOver: S.game.isGameOver() };
  renderAnalysis();

  renderEngineStatus('busy', 'Загрузка движка…');
  let isolated = false;
  try { isolated = await (window.__coi || Promise.resolve(false)); } catch { isolated = false; }
  const canMt = isolated && typeof SharedArrayBuffer !== 'undefined' && cores > 1;
  try {
    await engine.start(canMt, () => ({ Threads: effectiveThreads(), Hash: effectiveHash(), MultiPV: S.multiPv }));
  } catch (e) {
    console.error(e);
    renderEngineStatus('err', 'Не удалось запустить движок');
    toast('Не удалось запустить Stockfish в этом браузере', 5000);
    return;
  }
  fillEngineSettings();
  updateEngineStatus();
  const wanted = S.pendingPlay;   // "Сделать ход" pressed while the engine was loading
  startAnalysis();
  S.pendingPlay = wanted;
}

window.__nm = { S, engine };   // handy for debugging from the console
boot();
