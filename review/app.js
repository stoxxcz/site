import { Chess } from '../chess/vendor/chess.js';
import { EnginePool } from './engine.js';
import * as A from './analysis.js';

/* =====================================================================
 *  Разбор партии — free game review: paste a PGN, Stockfish checks every
 *  move, moves get classified and the coach explains them in words.
 * ===================================================================== */

const ENGINE_URL = '../chess/engine/stockfish-19-lite-single.js';
const DEPTHS = {
  fast: { depth: 11, movetime: 1200 },
  normal: { depth: 14, movetime: 3000 },
  deep: { depth: 18, movetime: 8000 },
};
const LIVE = { depth: 16, movetime: 5000, multipv: 3 };
const RECENT_MAX = 6;

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('rv.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('rv.' + k, JSON.stringify(v)); return true; } catch { return false; } },
};
const coarse = matchMedia('(pointer: coarse)').matches;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const S = {
  game: null,          // {headers, startFen, moves, fens, clocks, pgn}
  pos: null,           // analysed positions, one per fen
  review: null,        // {results, stats, opening}
  ply: 0,
  orientation: 'w',
  view: 'input',
  depth: store.get('depth', 'normal'),
  src: store.get('src', 'chesscom'),
  showArrow: store.get('arrow', true),
  openings: null,
  pool: null,
  running: false,
  variation: null,     // {base, nodes:[{fen, move, lines, score, result}], idx}
  retry: null,         // {idx, state, wrong, fen, move}
  selected: null,
  targets: [],
  lastShown: null,     // fen currently drawn
};

/* ============================== Icons =============================== */

const ICON_PATHS = {
  star: 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
  thumb: 'M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z',
  check: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  book: 'M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z',
  x: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  arrow: 'M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z',
};
function iconSvg(cls) {
  const c = A.CLS[cls];
  if (!c) return '';
  const inner = c.icon
    ? `<g transform="translate(5.3 5.3) scale(.56)"><path d="${ICON_PATHS[c.icon]}" fill="#fff"/></g>`
    : `<text x="12" y="16.4" text-anchor="middle" font-size="${c.glyph.length > 1 ? 12 : 14}" font-weight="900" fill="#fff" font-family="Arial,Helvetica,sans-serif" letter-spacing="-.6">${c.glyph}</text>`;
  return `<svg viewBox="0 0 24 24" role="img" aria-label="${c.label}"><circle cx="12" cy="12" r="11.6" fill="${c.color}"/>${inner}</svg>`;
}
const pieceSvg = (c, t) => `<svg viewBox="1.5 1.5 37 37"><use href="#p-${c}${t}"/></svg>`;

/* ============================== Utils =============================== */

function toast(msg, ms = 2400) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), ms);
}
function setSeg(id, v) {
  for (const b of $(id).querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === v);
}
const moveNo = (ply, startFen) => {
  const p = startFen.split(' ');
  const offset = p[1] === 'b' ? 1 : 0;
  return { no: (+p[5] || 1) + Math.floor((ply + offset) / 2), black: (ply + offset) % 2 === 1 };
};
function moveLabel(i) {
  const { no, black } = moveNo(i, S.game.startFen);
  return `${no}${black ? '…' : '.'} ${A.figurine(S.game.moves[i].san)}`;
}
function fmtClock(sec) {
  if (sec == null || isNaN(sec)) return '';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const ss = sec < 20 ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/* =============================== PGN ================================ */

function cleanPgn(text) {
  let t = text.replace(/\r\n?/g, '\n').replace(/ /g, ' ').trim();
  // Keep only the first game when several are pasted.
  const parts = t.split(/\n\s*\n(?=\s*\[Event )/);
  if (parts.length > 1) t = parts[0];
  // Russian piece letters → English (Кр, Ф, Л, С, К).
  if (/[КФЛС][a-h1-8x]/.test(t) || /Кр[a-h]/.test(t)) {
    t = t.replace(/Кр/g, 'K').replace(/Ф/g, 'Q').replace(/Л/g, 'R').replace(/С/g, 'B').replace(/К/g, 'N');
  }
  return t;
}
function stripPgn(t) {
  let s = t.replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ').replace(/\$\d+/g, ' ');
  for (let i = 0; i < 10 && /\([^()]*\)/.test(s); i++) s = s.replace(/\([^()]*\)/g, ' ');
  s = s.replace(/(\d+)\.\.\./g, '$1.').replace(/[!?]+/g, '').replace(/0-0-0/g, 'O-O-O').replace(/0-0/g, 'O-O');
  return s;
}

function parseGame(text) {
  const t = cleanPgn(text);
  if (!t) throw new Error('Вставьте PGN партии.');
  const c = new Chess();
  try { c.loadPgn(t); } catch (e1) {
    try { c.loadPgn(stripPgn(t)); } catch (e2) {
      const msg = String(e2.message || e2);
      const m = msg.match(/Invalid move in PGN: (\S+)/);
      throw new Error(m ? `Не получается прочитать ход «${m[1]}». Проверьте PGN.` : 'Не получается прочитать PGN. Проверьте, что это запись партии.');
    }
  }
  const moves = c.history({ verbose: true });
  if (!moves.length) throw new Error('В PGN нет ни одного хода.');
  const headers = c.getHeaders();
  const startFen = moves[0].before;
  const fens = [startFen, ...moves.map((m) => m.after)];
  // Clock comments: [%clk 0:09:58.5]
  const byFen = new Map();
  try { for (const { fen, comment } of c.getComments()) byFen.set(fen, comment); } catch { /* none */ }
  const clocks = moves.map((m) => {
    const cm = byFen.get(m.after);
    const k = cm && cm.match(/\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)\]/);
    return k ? +k[1] * 3600 + +k[2] * 60 + +k[3] : null;
  });
  const tc = (headers.TimeControl || '').match(/^(\d+)/);
  return { headers, startFen, moves, fens, clocks, base: tc ? +tc[1] : null, pgn: t };
}

/* ============================ Positions ============================= */

function basePositions(game) {
  return game.fens.map((fen) => {
    const c = new Chess(fen);
    const p = { fen, turn: c.turn(), legal: c.moves().length, lines: null, score: null };
    if (c.isCheckmate()) { p.score = { res: 0 }; p.lines = []; p.done = true; }
    else if (c.isStalemate() || c.isInsufficientMaterial()) { p.score = { res: 0.5 }; p.lines = []; p.done = true; }
    return p;
  });
}
function setLines(p, lines) {
  p.lines = (lines || []).map((l) => ({ uci: l.uci, cp: l.cp, mate: l.mate, pv: (l.pv || []).slice(0, 14), depth: l.depth }));
  const l = p.lines[0];
  if (l) p.score = l.mate != null && l.mate !== 0 ? { mate: l.mate } : { cp: l.cp ?? 0 };
  else if (!p.score) p.score = { cp: 0 };
}

/* ============================== Engine ============================== */

function getPool() {
  if (S.poolPromise) return S.poolPromise;
  const cores = navigator.hardwareConcurrency || 2;
  const size = Math.max(1, Math.min(coarse ? 3 : 4, cores - 1));
  const pool = new EnginePool(ENGINE_URL, size);
  S.poolPromise = pool.start().then(() => { S.pool = pool; return pool; }, (e) => { S.poolPromise = null; throw e; });
  return S.poolPromise;
}
async function getOpenings() {
  if (S.openings) return S.openings;
  try { S.openings = await (await fetch('openings.json')).json(); } catch { S.openings = {}; }
  return S.openings;
}

async function analyse(game, opts = {}) {
  S.game = game;
  S.pos = basePositions(game);
  S.review = null;
  S.ply = 0;
  S.variation = null;
  S.retry = null;
  if (opts.orientation) S.orientation = opts.orientation;
  setView('progress');
  renderPlayers();
  renderBoard(false);

  const cfg = DEPTHS[S.depth] || DEPTHS.normal;
  const progress = (done, total, text) => {
    const pct = total ? Math.round((done / total) * 100) : 0;
    $('progressBar').style.width = pct + '%';
    $('progressPct').textContent = pct + '%';
    if (text) $('progressText').textContent = text;
  };
  S.running = true;
  const token = (S.runToken = (S.runToken || 0) + 1);
  try {
    progress(0, 1, 'Запускаю Stockfish…');
    const [pool] = await Promise.all([getPool(), getOpenings()]);
    if (token !== S.runToken) return;
    const todo = S.pos.map((p, i) => i).filter((i) => !S.pos[i].done);
    const jobs = todo.map((i) => ({ fen: S.pos[i].fen, depth: cfg.depth, movetime: cfg.movetime, multipv: 3 }));
    const t0 = performance.now();
    let done = 0;
    const total = jobs.length;
    progress(0, total, `Проверяю каждый ход: 0 из ${game.moves.length}`);
    await pool.run(jobs, (k, lines) => {
      if (token !== S.runToken) return;
      const i = todo[k];
      setLines(S.pos[i], lines);
      done++;
      const left = ((performance.now() - t0) / done) * (total - done) / 1000;
      progress(done * 0.92, total, `Проверяю каждый ход: ${Math.min(done, game.moves.length)} из ${game.moves.length}`);
      $('progressEta').textContent = done > 2 && left > 1 ? `осталось ≈ ${Math.ceil(left)} с` : '';
      if (S.ply !== i && done % 3 === 0) { S.ply = i; renderBoard(false); renderEval(); }
    });
    if (token !== S.runToken || pool.cancelled) return;

    // Second look at positions where the engine contradicted itself.
    const verify = A.positionsToVerify(game, S.pos).slice(0, 24);
    if (verify.length) {
      progress(total * 0.93, total, 'Перепроверяю спорные моменты…');
      const vjobs = verify.map((i) => ({ fen: S.pos[i].fen, depth: cfg.depth + 4, movetime: cfg.movetime * 2, multipv: 3 }));
      let vd = 0;
      await pool.run(vjobs, (k, lines) => {
        if (lines && lines.length) setLines(S.pos[verify[k]], lines);
        vd++;
        progress(total * (0.93 + 0.07 * vd / vjobs.length), total);
      });
      if (token !== S.runToken || pool.cancelled) return;
    }
    finishReview();
    saveRecent();
    if (!opts.silentUrl) history.replaceState(null, '', location.pathname + location.search);
  } catch (e) {
    console.error(e);
    setView('input');
    showError('Не удалось запустить движок: ' + (e.message || e) + '. Попробуйте обновить страницу.');
  } finally {
    if (token === S.runToken) S.running = false;
  }
}

function finishReview() {
  S.review = A.reviewGame(S.game, S.pos, S.openings);
  S.ply = 0;
  setView('summary');
  renderAll(false);
}

function cancelAnalysis() {
  S.runToken = (S.runToken || 0) + 1;
  if (S.pool) S.pool.cancel();
  S.running = false;
  setView('input');
}

/* ============================== Views =============================== */

function setView(v) {
  S.view = v;
  for (const id of ['inputView', 'progressView', 'summaryView', 'reviewView']) $(id).hidden = id !== v + 'View';
  document.body.dataset.view = v;
  if (v === 'review' || v === 'summary') renderAll(false);
  if (v === 'input') { S.variation = null; S.retry = null; renderRecent(); }
}
function showError(msg) {
  const el = $('pgnError');
  el.textContent = msg;
  el.hidden = !msg;
}

/* ============================== Board =============================== */

const boardEl = $('board');
const squaresEl = $('squares');
const piecesEl = $('pieces');
const sqEls = [];
let pieceState = [];   // [{el, c, t, sq}]

function buildSquares() {
  for (let i = 0; i < 64; i++) {
    const d = document.createElement('div');
    d.className = 'sq';
    squaresEl.appendChild(d);
    sqEls.push(d);
  }
}
/** Visual cell (0..63, row-major from top-left) → square index (a1 = 0). */
function cellToSq(cell) {
  const x = cell & 7, y = cell >> 3;
  return S.orientation === 'w' ? (7 - y) * 8 + x : y * 8 + (7 - x);
}
function sqXY(sq) {
  const f = sq & 7, r = sq >> 3;
  return S.orientation === 'w' ? { x: f, y: 7 - r } : { x: 7 - f, y: r };
}

function currentFen() {
  if (S.retry) return S.retry.fen;
  if (S.variation && S.variation.idx >= 0) return S.variation.nodes[S.variation.idx].fen;
  if (S.variation) return S.game.fens[S.variation.base];
  return S.game ? S.game.fens[S.ply] : A.START_FEN;
}
/** The move that led to the shown position + its review result. */
function currentMoveInfo() {
  if (S.retry) {
    if (S.retry.move) return { move: S.retry.move, result: S.retry.result || null };
    return { move: null, result: null };
  }
  if (S.variation) {
    const v = S.variation;
    if (v.idx >= 0) return { move: v.nodes[v.idx].move, result: v.nodes[v.idx].result };
    return mainMoveInfo(v.base);
  }
  return mainMoveInfo(S.ply);
}
function mainMoveInfo(ply) {
  if (!S.game || ply === 0) return { move: null, result: null };
  return { move: S.game.moves[ply - 1], result: S.review ? S.review.results[ply - 1] : null };
}

function renderSquares(info) {
  const fen = currentFen();
  const c = new Chess(fen);
  let checkSq = -1;
  if (c.inCheck()) {
    const b = A.parseBoard(fen);
    checkSq = b.findIndex((p) => p && p.t === 'k' && p.c === c.turn());
  }
  const mv = info.move;
  const markColor = info.result ? hexA(A.CLS[info.result.cls].color, 0.5) : 'rgba(255, 214, 60, .42)';
  const from = mv ? A.sqIndex(mv.from) : -1, to = mv ? A.sqIndex(mv.to) : -1;
  for (let cell = 0; cell < 64; cell++) {
    const sq = cellToSq(cell);
    const el = sqEls[cell];
    const f = sq & 7, r = sq >> 3;
    let cls = 'sq ' + ((f + r) % 2 ? 'l' : 'd');
    if (sq === from || sq === to) cls += ' mark';
    if (S.selected === sq) cls += ' sel';
    if (S.targets.includes(sq)) cls += ' tgt' + (A.parseBoard(fen)[sq] ? ' cap' : '');
    if (sq === checkSq) cls += ' check';
    el.className = cls;
    el.style.setProperty('--mk', markColor);
    const x = cell & 7, y = cell >> 3;
    let html = '';
    if (x === 0) html += `<span class="co r">${r + 1}</span>`;
    if (y === 7) html += `<span class="co f">${'abcdefgh'[f]}</span>`;
    if (el._co !== html) { el.innerHTML = html; el._co = html; }
  }
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function placePiece(el, sq) {
  const { x, y } = sqXY(sq);
  el.style.transform = `translate(${x * 100}%, ${y * 100}%)`;
}

function renderPieces(animate) {
  const fen = currentFen();
  const b = A.parseBoard(fen);
  const next = [];
  for (let s = 0; s < 64; s++) if (b[s]) next.push({ c: b[s].c, t: b[s].t, sq: s });
  const prev = pieceState;
  const used = new Set();
  const match = new Array(next.length).fill(null);
  next.forEach((p, i) => {
    const j = prev.findIndex((q, k) => !used.has(k) && q.sq === p.sq && q.c === p.c && q.t === p.t);
    if (j >= 0) { used.add(j); match[i] = prev[j]; }
  });
  const dist = (a, z) => Math.max(Math.abs((a & 7) - (z & 7)), Math.abs((a >> 3) - (z >> 3)));
  next.forEach((p, i) => {
    if (match[i]) return;
    let best = -1, bd = 99;
    prev.forEach((q, k) => {
      if (used.has(k) || q.c !== p.c || (q.t !== p.t && !(q.t === 'p' && 'qrbn'.includes(p.t)))) return;
      const d = dist(q.sq, p.sq) + (q.t !== p.t ? 0.5 : 0);
      if (d < bd) { bd = d; best = k; }
    });
    if (best >= 0) { used.add(best); match[i] = prev[best]; }
  });
  const moved = next.filter((p, i) => match[i] && match[i].sq !== p.sq).length;
  const anim = animate && moved > 0 && moved <= 4;
  prev.forEach((q, k) => { if (!used.has(k)) q.el.remove(); });
  pieceState = next.map((p, i) => {
    let el;
    const m = match[i];
    if (m) {
      el = m.el;
      if (m.t !== p.t || m.c !== p.c) el.innerHTML = pieceSvg(p.c, p.t);
      el.classList.toggle('anim', anim && m.sq !== p.sq);
    } else {
      el = document.createElement('div');
      el.className = 'piece' + (animate ? ' fade' : '');
      el.innerHTML = pieceSvg(p.c, p.t);
      piecesEl.appendChild(el);
    }
    el.classList.remove('drag');
    placePiece(el, p.sq);
    return { el, c: p.c, t: p.t, sq: p.sq };
  });
  S.lastShown = fen;
}

function arrowSvg(from, to, color, width = 0.17) {
  const a = sqXY(A.sqIndex(from)), b = sqXY(A.sqIndex(to));
  const A0 = { x: a.x + 0.5, y: a.y + 0.5 }, B0 = { x: b.x + 0.5, y: b.y + 0.5 };
  const dx = b.x - a.x, dy = b.y - a.y;
  const knight = Math.abs(dx * dy) === 2;
  const pts = [A0];
  if (knight) pts.push(Math.abs(dx) === 2 ? { x: B0.x, y: A0.y } : { x: A0.x, y: B0.y });
  const P = pts[pts.length - 1];
  const len = Math.hypot(B0.x - P.x, B0.y - P.y);
  const ux = (B0.x - P.x) / len, uy = (B0.y - P.y) / len;
  const head = 0.42, hw = 0.24;
  const base = { x: B0.x - ux * head, y: B0.y - uy * head };
  // Pull the start a little towards the target so it doesn't cover the piece centre.
  const s0 = pts[0], n1 = pts[1] || base;
  const l0 = Math.hypot(n1.x - s0.x, n1.y - s0.y) || 1;
  const start = { x: s0.x + (n1.x - s0.x) / l0 * 0.18, y: s0.y + (n1.y - s0.y) / l0 * 0.18 };
  const d = [start, ...pts.slice(1), base].map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join(' ');
  const tip = `${B0.x - ux * 0.06},${B0.y - uy * 0.06}`;
  const l = `${base.x - uy * hw},${base.y + ux * hw}`, r = `${base.x + uy * hw},${base.y - ux * hw}`;
  return `<g opacity=".82"><path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="round"/><polygon points="${tip} ${l} ${r}" fill="${color}"/></g>`;
}

function renderArrows(info) {
  let html = '';
  const fenNow = currentFen();
  if (S.retry) {
    if (S.retry.state === 'hint' && S.retry.hintSq) {
      // highlight drawn via selection
    }
    if (S.retry.state === 'shown' && S.retry.best) html += arrowSvg(S.retry.best.slice(0, 2), S.retry.best.slice(2, 4), A.CLS.best.color);
  } else if (S.showArrow && info.result && info.result.bestUci && info.result.bestUci !== info.result.uci &&
    !['book', 'forced'].includes(info.result.cls)) {
    // Best move was in the position *before* the move: draw it when looking at the move.
    const u = info.result.bestUci;
    html += arrowSvg(u.slice(0, 2), u.slice(2, 4), A.CLS.best.color);
  }
  if (S.variation && S.variation.idx >= 0) {
    const node = S.variation.nodes[S.variation.idx];
    if (node.result && node.result.bestUci && node.result.bestUci !== node.result.uci && S.showArrow) {
      // already handled above via info.result
    }
  }
  void fenNow;
  $('arrows').innerHTML = html;
}

function renderBadges(info) {
  const el = $('badges');
  if (!info.move || !info.result) { el.innerHTML = ''; return; }
  const { x, y } = sqXY(A.sqIndex(info.move.to));
  el.innerHTML = `<div class="badge${x === 7 ? ' edge-r' : ''}${y === 0 ? ' edge-t' : ''}" style="left:${x * 12.5}%;top:${y * 12.5}%"><div class="ic">${iconSvg(info.result.cls)}</div></div>`;
}

function renderBoard(animate = true) {
  const info = currentMoveInfo();
  renderSquares(info);
  renderPieces(animate);
  renderArrows(info);
  renderBadges(info);
}

/* ============================== Eval ================================ */

function shownPosition() {
  if (S.retry) return null;
  if (S.variation && S.variation.idx >= 0) {
    const n = S.variation.nodes[S.variation.idx];
    return n.score ? { score: n.score, turn: n.fen.split(' ')[1] } : null;
  }
  const p = S.pos && S.pos[S.variation ? S.variation.base : S.ply];
  return p && p.score ? p : null;
}

function renderEval() {
  const p = shownPosition();
  const bar = $('evalBar');
  bar.classList.toggle('flipped', S.orientation === 'b');
  const txt = $('evalText');
  if (!p) {
    if (!S.retry) { $('evalFill').style.height = '50%'; txt.textContent = ''; }
    return;
  }
  const ws = A.whiteScore(p);
  const w = A.ep(ws);
  $('evalFill').style.height = Math.max(3, Math.min(97, w * 100)) + '%';
  let t;
  if (ws.res != null) t = ws.res === 1 ? '1-0' : ws.res === 0 ? '0-1' : '½';
  else if (ws.mate != null) t = 'M' + Math.abs(ws.mate);
  else t = (Math.abs(ws.cp) / 100).toFixed(Math.abs(ws.cp) >= 1000 ? 0 : 1);
  const whiteBetter = ws.res != null ? ws.res >= 0.5 : ws.mate != null ? ws.mate > 0 : ws.cp >= 0;
  const atBottom = (whiteBetter && S.orientation === 'w') || (!whiteBetter && S.orientation === 'b');
  txt.textContent = t;
  txt.className = 'evaltext ' + (atBottom ? 'low' : 'high');
  if (whiteBetter) txt.style.color = '#333'; else txt.style.color = '#eee';
}

/* ============================= Players ============================== */

function clockAt(color, ply) {
  const g = S.game;
  if (!g) return null;
  for (let i = Math.min(ply, g.moves.length) - 1; i >= 0; i--) {
    if (g.moves[i].color === color && g.clocks[i] != null) return g.clocks[i];
  }
  return g.clocks.some((c) => c != null) ? g.base : null;
}
function renderPlayers() {
  const g = S.game;
  const h = g ? g.headers : {};
  const side = (c) => {
    const name = c === 'w' ? h.White : h.Black;
    const elo = c === 'w' ? h.WhiteElo : h.BlackElo;
    const acc = S.review && S.review.stats.accuracy[c];
    const ply = S.variation ? S.variation.base : S.retry ? S.retry.idx : S.ply;
    const clk = clockAt(c, ply);
    const turn = g ? g.fens[Math.min(ply, g.fens.length - 1)].split(' ')[1] : 'w';
    return `<span class="pcolor ${c}">${pieceSvg(c, 'k')}</span>
      <span class="pname">${esc(name && name !== '?' ? name : c === 'w' ? 'Белые' : 'Чёрные')}</span>
      ${elo && elo !== '?' ? `<span class="prating">(${esc(elo)})</span>` : ''}
      ${acc != null ? `<span class="pacc" title="Точность">${acc.toFixed(1)}%</span>` : ''}
      ${clk != null ? `<span class="pclock ${c}${turn === c ? '' : ' dim'}">${fmtClock(clk)}</span>` : ''}`;
  };
  const top = S.orientation === 'w' ? 'b' : 'w';
  $('playerTop').innerHTML = side(top);
  $('playerBottom').innerHTML = side(top === 'w' ? 'b' : 'w');
}

/* ============================== Coach =============================== */

function coachTitle(result, move) {
  const c = A.CLS[result.cls];
  return `<span class="san">${A.figurine(move.san)}</span> — ${c.label.toLowerCase()}`;
}

function renderCoach() {
  const icon = $('coachIcon'), title = $('coachTitle'), evalEl = $('coachEval');
  const text = $('coachText'), line = $('coachLine'), actions = $('coachActions');
  line.hidden = true; line.innerHTML = ''; actions.innerHTML = '';
  evalEl.textContent = ''; evalEl.className = 'ceval';
  evalEl.hidden = true;
  const setEval = (pos) => {
    if (!pos || !pos.score) return;
    const ws = A.whiteScore(pos);
    evalEl.hidden = false;
    evalEl.textContent = A.fmtScore(ws);
    evalEl.classList.toggle('w', A.ep(ws) >= 0.5);
  };
  const addBtn = (label, fn, primary) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (primary) b.className = 'primary';
    b.onclick = fn;
    actions.appendChild(b);
  };

  /* --- retry mode --- */
  if (S.retry) {
    const rt = S.retry;
    const color = S.game.moves[rt.idx].color;
    if (rt.state === 'solved') {
      icon.innerHTML = iconSvg(rt.result.cls);
      title.innerHTML = `Верно! <span class="san">${A.figurine(rt.move.san)}</span>`;
      text.innerHTML = rt.text;
      addBtn('Продолжить ▶', () => exitRetry(true), true);
    } else if (rt.state === 'shown') {
      icon.innerHTML = iconSvg('best');
      title.innerHTML = `Лучший ход: <span class="san">${A.figurine(rt.bestSan)}</span>`;
      text.innerHTML = rt.text;
      addBtn('Продолжить ▶', () => exitRetry(true), true);
    } else {
      icon.innerHTML = '';
      title.textContent = rt.state === 'wrong' ? 'Не то…' : 'Найдите ход лучше';
      text.innerHTML = rt.state === 'wrong'
        ? `${rt.wrongText || 'Есть ход сильнее.'} Попробуйте ещё раз — ход за ${color === 'w' ? 'белых' : 'чёрных'}.`
        : `В партии было сыграно <span class="san">${A.figurine(S.game.moves[rt.idx].san)}</span>. Сделайте на доске ход получше за ${color === 'w' ? 'белых' : 'чёрных'}.`;
      if (rt.wrong >= 1 && !rt.hinted) addBtn('Подсказка', () => showRetryHint());
      addBtn('Показать ответ', () => showRetryAnswer());
      addBtn('Отмена', () => exitRetry(false));
    }
    return;
  }

  /* --- variation (own moves) --- */
  if (S.variation && S.variation.idx >= 0) {
    const node = S.variation.nodes[S.variation.idx];
    if (!node.result) {
      icon.innerHTML = '';
      title.innerHTML = `<span class="san">${A.figurine(node.move.san)}</span>`;
      text.textContent = 'Анализирую…';
      return;
    }
    const r = node.result;
    icon.innerHTML = iconSvg(r.cls);
    title.innerHTML = coachTitle(r, node.move);
    text.innerHTML = r.text;
    setEval({ score: node.score, turn: node.fen.split(' ')[1] });
    if (r.bestLine) showLine(r, S.variation.idx === 0 ? S.game.fens[S.variation.base] : S.variation.nodes[S.variation.idx - 1].fen, 'var');
    return;
  }

  const ply = S.variation ? S.variation.base : S.ply;
  if (!S.review) return;
  if (ply === 0) {
    icon.innerHTML = '';
    title.textContent = 'Начинаем разбор';
    const op = S.review.opening ? ` Дебют: <i>${esc(S.review.opening)}</i>.` : '';
    text.innerHTML = `Пройдём партию ход за ходом — я объясню каждый важный момент.${op} Нажмите <b>▶</b> или клавишу <b>→</b>. Можно делать свои ходы на доске — я их тоже оценю.`;
    setEval(S.pos[0]);
    addBtn('Первый ход ▶', () => goTo(1), true);
    return;
  }
  const r = S.review.results[ply - 1];
  const m = S.game.moves[ply - 1];
  icon.innerHTML = iconSvg(r.cls);
  title.innerHTML = coachTitle(r, m);
  let body = r.text;
  if (ply === S.game.moves.length) body += endNote();
  text.innerHTML = body;
  setEval(S.pos[ply]);
  if (r.bestLine && !['book', 'forced'].includes(r.cls)) showLine(r, S.game.fens[ply - 1], 'main');
  if (r.bestUci && r.bestUci !== r.uci && !['book', 'forced', 'best', 'brilliant', 'great'].includes(r.cls)) {
    addBtn('Показать лучший ход', () => startVariationLine(ply - 1, r.bestLineUci, 0));
    if (A.BAD.has(r.cls)) addBtn('Попробовать снова', () => startRetry(ply - 1), true);
  }
  if (ply < S.game.moves.length) addBtn('Дальше ▶', () => goTo(ply + 1), !A.BAD.has(r.cls));
}

function endNote() {
  const h = S.game.headers;
  const res = h.Result;
  const last = S.game.moves[S.game.moves.length - 1];
  if (last.san.includes('#')) return '';
  const term = h.Termination ? ` (${esc(h.Termination)})` : '';
  if (res === '1-0') return ` <br><b>Партия окончена: победа белых${term}.</b>`;
  if (res === '0-1') return ` <br><b>Партия окончена: победа чёрных${term}.</b>`;
  if (res === '1/2-1/2') return ` <br><b>Партия окончена вничью${term}.</b>`;
  return '';
}

function showLine(r, fenBefore, kind) {
  const line = $('coachLine');
  const moves = A.lineSan(fenBefore, r.bestLineUci, 10);
  if (!moves.length) return;
  const parts = A.numbered(fenBefore, moves).split(' ');
  // numbered() returns tokens; wrap moves (not numbers) as clickable
  let k = 0;
  const html = parts.map((tok) => {
    if (/^\d+[.…]/.test(tok)) {
      const [no, san] = tok.split(' ');
      if (san === undefined) return esc(tok);
      return `${esc(no)} <span class="pvmv" data-k="${k++}">${esc(san)}</span>`;
    }
    return `<span class="pvmv" data-k="${k++}">${esc(tok)}</span>`;
  }).join(' ');
  line.innerHTML = `<b>Лучшая линия:</b> ${html}`;
  line.hidden = false;
  line.onclick = (e) => {
    const t = e.target.closest('.pvmv');
    if (!t) return;
    const idx = +t.dataset.k;
    if (kind === 'main') startVariationLine(S.ply - 1, r.bestLineUci, idx);
    else {
      const v = S.variation;
      const baseIdx = v.idx - 1;
      const fen = baseIdx < 0 ? S.game.fens[v.base] : v.nodes[baseIdx].fen;
      v.nodes = v.nodes.slice(0, baseIdx + 1);
      appendLine(fen, r.bestLineUci);
      v.idx = Math.min(v.nodes.length - 1, baseIdx + 1 + idx);
      afterVariationChange();
    }
  };
}

/* =========================== Navigation ============================= */

function goTo(ply, animate) {
  if (!S.game) return;
  S.variation = null;
  S.retry = null;
  const n = Math.max(0, Math.min(S.game.moves.length, ply));
  const anim = animate ?? Math.abs(n - S.ply) === 1;
  S.ply = n;
  clearSelection();
  if (S.view === 'summary' && n > 0) setView('review');
  renderAll(anim);
}
function step(d) {
  if (S.retry) return;
  if (S.variation) {
    const v = S.variation;
    const ni = v.idx + d;
    if (ni < -1) { exitVariation(); return; }
    if (ni >= v.nodes.length) return;
    v.idx = ni;
    afterVariationChange(true);
    return;
  }
  goTo(S.ply + d);
}

function renderAll(animate = false) {
  if (!S.game) { renderBoard(false); return; }
  renderBoard(animate);
  renderEval();
  renderPlayers();
  if (S.review) {
    renderCoach();
    renderMoveList();
    renderGraph($('graph'));
    if (S.view === 'summary') renderSummary();
    renderVarBar();
  }
}

/* ============================ Move list ============================= */

function renderMoveList() {
  const el = $('moveList');
  const g = S.game;
  const { results } = S.review;
  const start = moveNo(0, g.startFen);
  let html = '';
  let i = 0;
  const cell = (k) => {
    const r = results[k];
    const cur = !S.variation && !S.retry && S.ply === k + 1 ? ' cur' : '';
    const minor = ['best', 'excellent', 'good', 'book'].includes(r.cls) ? ' minor' : '';
    return `<div class="mv${cur}${minor}" data-ply="${k + 1}"><span class="ic">${iconSvg(r.cls)}</span><span class="t">${A.figurine(g.moves[k].san)}</span></div>`;
  };
  if (start.black) {
    html += `<div class="mrow"><span class="mno">${start.no}.</span><div class="mv"></div>${cell(0)}</div>`;
    i = 1;
  }
  for (; i < g.moves.length; i += 2) {
    const { no } = moveNo(i, g.startFen);
    html += `<div class="mrow"><span class="mno">${no}.</span>${cell(i)}${i + 1 < g.moves.length ? cell(i + 1) : '<div></div>'}</div>`;
  }
  if (el._html !== html) { el.innerHTML = html; el._html = html; }
  const cur = el.querySelector('.mv.cur');
  if (cur) {
    const top = cur.offsetTop - el.offsetTop;
    if (top < el.scrollTop + 4 || top > el.scrollTop + el.clientHeight - 36) el.scrollTop = top - el.clientHeight / 2;
  }
}

/* ============================== Graph =============================== */

const NOTABLE = new Set(['brilliant', 'great', 'miss', 'mistake', 'blunder']);
function renderGraph(el) {
  if (!el || !S.review || el.offsetParent === null) return;
  const W = el.clientWidth || 400, H = el.clientHeight || 96;
  const n = S.pos.length;
  const xs = (i) => (n <= 1 ? 0 : (i / (n - 1)) * W);
  const ys = (p) => (1 - A.ep(A.whiteScore(p) || { cp: 0 })) * (H - 6) + 3;
  let d = `M0 ${H}`;
  S.pos.forEach((p, i) => { d += ` L${xs(i).toFixed(1)} ${ys(p).toFixed(1)}`; });
  d += ` L${W} ${H} Z`;
  const cur = S.variation ? S.variation.base : S.retry ? S.retry.idx : S.ply;
  let dots = '';
  S.review.results.forEach((r, i) => {
    if (!NOTABLE.has(r.cls)) return;
    dots += `<circle cx="${xs(i + 1).toFixed(1)}" cy="${ys(S.pos[i + 1]).toFixed(1)}" r="4" fill="${A.CLS[r.cls].color}" stroke="#222" stroke-width="1"/>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="#3b3834"/>
    <path d="${d}" fill="#efefef"/>
    <line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="#888" stroke-opacity=".45" stroke-dasharray="3 3"/>
    <line x1="${xs(cur)}" x2="${xs(cur)}" y1="0" y2="${H}" stroke="${S.view === 'summary' ? 'transparent' : '#e9a23b'}" stroke-width="2"/>
    ${dots}
  </svg><div class="tip" hidden></div>`;
  const tip = el.querySelector('.tip');
  const plyAt = (e) => {
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width) * (n - 1))));
  };
  el.onpointermove = (e) => {
    if (e.pointerType === 'touch') return;
    const i = plyAt(e);
    tip.hidden = false;
    tip.style.left = Math.max(40, Math.min(W - 40, xs(i))) + 'px';
    tip.textContent = i === 0 ? `Начало ${A.fmtWhite(S.pos[0])}` : `${moveLabel(i - 1)} ${A.fmtWhite(S.pos[i])}`;
  };
  el.onpointerleave = () => { tip.hidden = true; };
  el.onclick = (e) => goTo(plyAt(e), false);
}

/* ============================= Summary ============================== */

function renderSummary() {
  const { stats } = S.review;
  const h = S.game.headers;
  $('summaryText').innerHTML = A.summaryText(S.game, S.review);
  const box = (c) => {
    const name = c === 'w' ? h.White : h.Black;
    const elo = c === 'w' ? h.WhiteElo : h.BlackElo;
    const acc = stats.accuracy[c];
    const rate = stats.rating[c];
    return `<div class="accbox ${c}">
      <div class="who">${esc(name && name !== '?' ? name : c === 'w' ? 'Белые' : 'Чёрные')}${elo && elo !== '?' ? ` <small>${esc(elo)}</small>` : ''}</div>
      <div class="num">${acc != null ? acc.toFixed(1) : '—'}</div>
      <div class="cap">Точность</div>
      ${rate ? `<div class="rate" title="Грубая оценка по точности, не рейтинг">Уровень игры ≈ <b>${rate}</b></div>` : ''}
    </div>`;
  };
  $('accRow').innerHTML = box('w') + box('b');
  let rows = '';
  for (const k of A.CLS_ORDER) {
    const w = stats.counts.w[k], b = stats.counts.b[k];
    if (k === 'forced' && !w && !b) continue;
    const col = A.CLS[k].color;
    rows += `<tr data-cls="${k}"><td class="n${w ? '' : ' zero'}" style="${w ? `color:${col}` : ''}">${w}</td>
      <td class="lab"><span class="lw">${iconSvg(k)}${A.CLS[k].short}</span></td>
      <td class="n${b ? '' : ' zero'}" style="${b ? `color:${col}` : ''}">${b}</td></tr>`;
  }
  $('countsTable').innerHTML = rows;
  const phaseNames = { opening: 'Дебют', middlegame: 'Миттельшпиль', endgame: 'Эндшпиль' };
  let prow = '';
  for (const [k, label] of Object.entries(phaseNames)) {
    const a = stats.phaseAcc[k];
    if (a.w == null && a.b == null) continue;
    const cell = (v) => {
      const c = A.phaseClass(v);
      return c ? `<span title="${v.toFixed(0)}%">${iconSvg(c)}</span>` : '<span style="color:#777">—</span>';
    };
    prow += `<tr><td class="n">${cell(a.w)}</td><td class="lab">${label}</td><td class="n">${cell(a.b)}</td></tr>`;
  }
  $('phasesTable').innerHTML = prow;
  renderGraph($('graphSummary'));
}

/* ============================ Variations ============================ */

function startVariationLine(baseIdx, ucis, idx) {
  S.retry = null;
  S.variation = { base: baseIdx, nodes: [], idx: -1 };
  appendLine(S.game.fens[baseIdx], ucis);
  S.variation.idx = Math.min(idx, S.variation.nodes.length - 1);
  if (S.view !== 'review') setView('review');
  afterVariationChange(false);
}
function appendLine(fen, ucis) {
  const c = new Chess(fen);
  for (const u of ucis) {
    let m;
    try { m = c.move(A.uciToMove(u)); } catch { break; }
    if (!m) break;
    S.variation.nodes.push({ fen: m.after, move: m, lines: null, score: null, result: null });
  }
}
function addVariationMove(m) {
  if (!S.variation) {
    // Playing the game's own next move just steps forward.
    const next = S.game.moves[S.ply];
    if (next && next.from === m.from && next.to === m.to && (next.promotion || '') === (m.promotion || '')) { goTo(S.ply + 1); return; }
    S.variation = { base: S.ply, nodes: [], idx: -1 };
  }
  const v = S.variation;
  const nxt = v.nodes[v.idx + 1];
  if (nxt && nxt.move.from === m.from && nxt.move.to === m.to && (nxt.move.promotion || '') === (m.promotion || '')) {
    v.idx++;
  } else {
    v.nodes = v.nodes.slice(0, v.idx + 1);
    v.nodes.push({ fen: m.after, move: m, lines: null, score: null, result: null });
    v.idx = v.nodes.length - 1;
  }
  afterVariationChange(true);
}
function exitVariation() {
  if (!S.variation) return;
  const base = S.variation.base;
  S.variation = null;
  S.ply = base;
  renderAll(false);
}
function afterVariationChange(animate) {
  clearSelection();
  renderAll(animate);
  liveAnalyse();
}
function renderVarBar() {
  const bar = $('varBar');
  const v = S.variation;
  if (!v) { bar.hidden = true; return; }
  bar.hidden = false;
  const fen = S.game.fens[v.base];
  const moves = v.nodes.map((n) => n.move);
  $('varText').textContent = 'Вариант: ' + (moves.length ? A.numbered(fen, moves) : '…');
}

function variationParent(i) {
  const v = S.variation;
  if (i === 0) return S.pos[v.base];
  const p = v.nodes[i - 1];
  return p.lines ? { fen: p.fen, turn: p.fen.split(' ')[1], lines: p.lines, score: p.score, legal: new Chess(p.fen).moves().length } : null;
}
function nodePos(n) {
  const c = new Chess(n.fen);
  if (c.isCheckmate()) return { fen: n.fen, turn: c.turn(), lines: [], score: { res: 0 }, legal: 0 };
  if (c.isStalemate() || c.isInsufficientMaterial() || c.isDraw()) {
    if (c.isStalemate() || c.isInsufficientMaterial()) return { fen: n.fen, turn: c.turn(), lines: [], score: { res: 0.5 }, legal: c.moves().length };
  }
  return n.lines ? { fen: n.fen, turn: c.turn(), lines: n.lines, score: n.score, legal: c.moves().length } : null;
}
function computeNodeResult(i) {
  const v = S.variation;
  const n = v.nodes[i];
  const parent = variationParent(i);
  const np = nodePos(n);
  if (!parent || !np || !parent.lines) return false;
  if (!n.score) n.score = np.score;
  const prevMove = i === 0 ? S.game.moves[v.base - 1] || null : v.nodes[i - 1].move;
  const prevResult = i === 0 ? (S.review.results[v.base - 1] || null) : v.nodes[i - 1].result;
  try {
    n.result = A.reviewMove(parent, np, n.move, { ply: v.base + i, prevMove, prevResult });
  } catch (e) { console.error(e); return false; }
  return true;
}

async function liveAnalyse() {
  const v = S.variation;
  if (!v || v.idx < 0 || !S.pool || !S.pool.engines.length) return;
  const eng = S.pool.engines[0];
  const token = (S.liveToken = (S.liveToken || 0) + 1);
  eng.stop();
  // Analyse every node from the start of the variation up to the shown one that still lacks lines.
  for (let i = 0; i <= v.idx; i++) {
    if (token !== S.liveToken || S.variation !== v) return;
    const n = v.nodes[i];
    const term = nodePos(n);
    if (!n.lines && !(term && term.lines && !term.lines.length)) {
      const lines = await eng.analyse(n.fen, { ...LIVE, onInfo: null });
      if (S.variation !== v) return;
      const p = {};
      setLines(p, lines);
      n.lines = p.lines; n.score = p.score;
      if (token !== S.liveToken && i !== v.idx) { /* superseded but keep data */ }
    } else if (term && !n.score) {
      n.score = term.score; n.lines = term.lines;
    }
    if (!n.result) computeNodeResult(i);
    if (S.variation === v && i === v.idx) { renderAll(false); }
  }
}

/* ============================== Retry =============================== */

function startRetry(idx) {
  S.variation = null;
  S.retry = { idx, state: 'ask', wrong: 0, fen: S.game.fens[idx], move: null };
  S.ply = idx + 1;
  clearSelection();
  renderAll(false);
}
function exitRetry(advance) {
  const idx = S.retry.idx;
  S.retry = null;
  S.ply = advance ? Math.min(S.game.moves.length, idx + 1) : idx + 1;
  clearSelection();
  renderAll(false);
}
function retryLines() {
  const p = S.pos[S.retry.idx];
  return p.lines || [];
}
function handleRetryMove(m) {
  const rt = S.retry;
  const lines = retryLines();
  const uci = m.from + m.to + (m.promotion || '');
  const best = lines[0];
  const played = S.game.moves[rt.idx];
  const l = lines.find((x) => x.uci === uci);
  const sc = (x) => (x.mate != null ? { mate: x.mate } : { cp: x.cp });
  const prevMove = S.game.moves[rt.idx - 1] || null;
  if (l && best && A.ep(sc(l)) >= A.ep(sc(best)) - 0.025) {
    rt.state = 'solved';
    rt.move = m;
    rt.fen = m.after;
    rt.result = { cls: l === best ? 'best' : 'excellent', uci };
    const what = A.purposeText(S.game.fens[rt.idx], m, prevMove, rt.idx);
    rt.text = `${l === best ? 'Это лучший ход в позиции.' : 'Отличный ход — почти не уступает лучшему.'} ${what}`;
    renderAll(true);
    return;
  }
  rt.state = 'wrong';
  rt.wrong++;
  rt.wrongText = uci === played.from + played.to + (played.promotion || '') ? 'Это ход из партии.' : l ? 'Неплохо, но есть сильнее.' : 'Этот ход хуже, чем кажется.';
  rt.move = m;
  rt.fen = m.after;
  rt.result = null;
  renderAll(true);
  setTimeout(() => {
    if (S.retry !== rt) return;
    rt.fen = S.game.fens[rt.idx];
    rt.move = null;
    renderAll(true);
  }, 650);
}
function showRetryHint() {
  const rt = S.retry;
  const best = retryLines()[0];
  if (!best) return;
  rt.hinted = true;
  const sq = A.sqIndex(best.uci.slice(0, 2));
  const b = A.parseBoard(rt.fen);
  const p = b[sq];
  S.selected = sq;
  S.targets = [];
  const names = { p: 'пешкой', n: 'конём', b: 'слоном', r: 'ладьёй', q: 'ферзём', k: 'королём' };
  rt.wrongText = `Подсказка: ходите ${p ? names[p.t] : 'фигурой'} с ${best.uci.slice(0, 2)}.`;
  rt.state = 'wrong';
  renderAll(false);
}
function showRetryAnswer() {
  const rt = S.retry;
  const best = retryLines()[0];
  if (!best) { exitRetry(true); return; }
  const c = new Chess(S.game.fens[rt.idx]);
  let m = null;
  try { m = c.move(A.uciToMove(best.uci)); } catch { m = null; }
  if (!m) { exitRetry(true); return; }
  rt.state = 'shown';
  rt.best = best.uci;
  rt.bestSan = m.san;
  rt.move = m;
  rt.fen = m.after;
  rt.result = { cls: 'best', uci: best.uci };
  const r = S.review.results[rt.idx];
  rt.text = (A.purposeText(S.game.fens[rt.idx], m, S.game.moves[rt.idx - 1] || null, rt.idx) || 'Сильнейший ход по оценке движка.') +
    (r.bestLine ? `<br><span style="color:#5d5850;font-size:13px">Линия: ${r.bestLine}</span>` : '');
  clearSelection();
  renderAll(true);
}

/* ========================= Board interaction ======================== */

function canMove() {
  if (!S.game || !S.review || S.view !== 'review') return false;
  if (S.retry) return S.retry.state === 'ask' || S.retry.state === 'wrong';
  return true;
}
function clearSelection() { S.selected = null; S.targets = []; }
function squareAt(e) {
  const r = boardEl.getBoundingClientRect();
  const x = Math.floor(((e.clientX - r.left) / r.width) * 8);
  const y = Math.floor(((e.clientY - r.top) / r.height) * 8);
  if (x < 0 || x > 7 || y < 0 || y > 7) return -1;
  return cellToSq(y * 8 + x);
}
function selectSq(sq) {
  const c = new Chess(currentFen());
  const name = A.sqName(sq);
  const p = c.get(name);
  if (!p || p.color !== c.turn()) { clearSelection(); return false; }
  S.selected = sq;
  S.targets = c.moves({ square: name, verbose: true }).map((m) => A.sqIndex(m.to));
  return true;
}

let drag = null;
boardEl.addEventListener('pointerdown', (e) => {
  if (!canMove() || e.button > 0) return;
  const sq = squareAt(e);
  if (sq < 0) return;
  if (S.selected != null && S.targets.includes(sq)) { tryMove(S.selected, sq); return; }
  const had = S.selected === sq;
  if (!selectSq(sq)) { renderSquares(currentMoveInfo()); return; }
  renderSquares(currentMoveInfo());
  const ps = pieceState.find((p) => p.sq === sq);
  if (!ps) return;
  drag = { sq, el: ps.el, x0: e.clientX, y0: e.clientY, moved: false, had };
  boardEl.setPointerCapture(e.pointerId);
  e.preventDefault();
});
boardEl.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
  drag.moved = true;
  const r = boardEl.getBoundingClientRect();
  const s = r.width / 8;
  drag.el.classList.add('drag');
  drag.el.classList.remove('anim');
  drag.el.style.transform = `translate(${e.clientX - r.left - s / 2}px, ${e.clientY - r.top - s / 2}px)`;
});
const endDrag = (e) => {
  if (!drag) return;
  const d = drag;
  drag = null;
  d.el.classList.remove('drag');
  if (d.moved) {
    const sq = squareAt(e);
    if (sq >= 0 && sq !== d.sq && S.targets.includes(sq)) { tryMove(d.sq, sq); return; }
    placePiece(d.el, d.sq);
  } else if (d.had) {
    clearSelection();
    renderSquares(currentMoveInfo());
  }
};
boardEl.addEventListener('pointerup', endDrag);
boardEl.addEventListener('pointercancel', (e) => { if (drag) { placePiece(drag.el, drag.sq); drag = null; } void e; });

async function tryMove(from, to) {
  const fen = currentFen();
  const c = new Chess(fen);
  const cands = c.moves({ square: A.sqName(from), verbose: true }).filter((m) => m.to === A.sqName(to));
  if (!cands.length) { clearSelection(); renderBoard(false); return; }
  let promo;
  if (cands.some((m) => m.promotion)) {
    promo = await askPromotion(to, c.turn());
    if (!promo) { clearSelection(); renderBoard(false); return; }
  }
  let m;
  try { m = c.move({ from: A.sqName(from), to: A.sqName(to), promotion: promo }); } catch { m = null; }
  clearSelection();
  if (!m) { renderBoard(false); return; }
  if (S.retry) handleRetryMove(m);
  else addVariationMove(m);
}

function askPromotion(sq, color) {
  return new Promise((resolve) => {
    const el = $('promo');
    const { x, y } = sqXY(sq);
    const down = y === 0;
    el.style.left = x * 12.5 + '%';
    el.style.top = down ? '0' : 'auto';
    el.style.bottom = down ? 'auto' : '0';
    el.innerHTML = ['q', 'n', 'r', 'b'].map((t) => `<button data-t="${t}" aria-label="${t}">${pieceSvg(color, t)}</button>`).join('');
    el.hidden = false;
    const done = (v) => { el.hidden = true; document.removeEventListener('pointerdown', outside, true); resolve(v); };
    const outside = (e) => { if (!el.contains(e.target)) done(null); };
    el.onclick = (e) => { const b = e.target.closest('button'); if (b) done(b.dataset.t); };
    setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  });
}

function flip() {
  S.orientation = S.orientation === 'w' ? 'b' : 'w';
  pieceState.forEach((p) => p.el.classList.remove('anim'));
  renderAll(false);
}

/* ========================== Recent & share ========================== */

function compactPos(pos) {
  return pos.map((p) => ({ l: (p.lines || []).map((l) => [l.uci, l.cp ?? null, l.mate ?? null, (l.pv || []).slice(0, 10).join(' ')]) }));
}
function expandPos(game, cp) {
  const pos = basePositions(game);
  pos.forEach((p, i) => {
    if (p.done) return;
    const c = cp[i];
    setLines(p, (c ? c.l : []).map(([uci, cpv, mate, pv]) => ({ uci, cp: cpv ?? undefined, mate: mate ?? undefined, pv: pv ? pv.split(' ') : [uci] })));
  });
  return pos;
}
function gameId(pgn) {
  let h = 0;
  for (let i = 0; i < pgn.length; i++) h = (h * 31 + pgn.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
function saveRecent() {
  const g = S.game;
  const id = gameId(g.pgn);
  const list = store.get('recent', []).filter((x) => x.id !== id);
  const st = S.review.stats;
  list.unshift({
    id, pgn: g.pgn, depth: S.depth, orientation: S.orientation, t: Date.now(),
    w: g.headers.White || 'Белые', b: g.headers.Black || 'Чёрные', res: g.headers.Result || '*',
    aw: st.accuracy.w, ab: st.accuracy.b, pos: compactPos(S.pos),
  });
  while (list.length > RECENT_MAX) list.pop();
  while (list.length && !store.set('recent', list)) list.pop();
}
function renderRecent() {
  const list = store.get('recent', []);
  $('recentCard').hidden = !list.length;
  $('recentList').innerHTML = list.map((x, i) => `<button class="game" data-i="${i}">
      <span class="gres ${x.res === '1-0' ? 'win' : x.res === '0-1' ? 'loss' : 'draw'}">${x.res === '1-0' ? '1' : x.res === '0-1' ? '0' : '½'}</span>
      <span class="gnames"><div><b>${esc(x.w)}</b> ${x.aw != null ? `<small>${x.aw.toFixed(0)}%</small>` : ''}</div><div><b>${esc(x.b)}</b> ${x.ab != null ? `<small>${x.ab.toFixed(0)}%</small>` : ''}</div></span>
      <span class="gmeta">${new Date(x.t).toLocaleDateString('ru-RU')}</span></button>`).join('');
}
async function openRecent(i) {
  const x = store.get('recent', [])[i];
  if (!x) return;
  try {
    const game = parseGame(x.pgn);
    await getOpenings();
    S.game = game;
    S.pos = expandPos(game, x.pos);
    S.orientation = x.orientation || 'w';
    S.variation = null; S.retry = null;
    $('pgnInput').value = x.pgn;
    finishReview();
    getPool().catch(() => {});
  } catch (e) { toast('Не удалось открыть разбор'); console.error(e); }
}

function b64url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
function shareLink() {
  const g = S.game;
  const keep = ['Event', 'Date', 'White', 'Black', 'Result', 'WhiteElo', 'BlackElo', 'SetUp', 'FEN', 'Termination'];
  const hdr = keep.filter((k) => g.headers[k]).map((k) => `[${k} "${g.headers[k]}"]`).join('\n');
  const c = new Chess(g.startFen);
  g.moves.forEach((m) => c.move(m.san));
  const body = c.pgn({ maxWidth: 0 }).replace(/^\[.*\]\s*$/gm, '').trim();
  const url = `${location.origin}${location.pathname}#pgn=${b64url(hdr + '\n\n' + body)}&side=${S.orientation}`;
  if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => toast('Ссылка скопирована'), () => prompt('Ссылка на разбор:', url));
  else prompt('Ссылка на разбор:', url);
}

/* ======================== Import from accounts ====================== */

async function fetchJson(url, opts) {
  const r = await fetch(url, opts);
  if (r.status === 404) throw new Error('Игрок не найден');
  if (!r.ok) throw new Error('Ошибка ' + r.status);
  return r.json();
}
async function loadChessCom(user) {
  const a = await fetchJson(`https://api.chess.com/pub/player/${encodeURIComponent(user.toLowerCase())}/games/archives`);
  const arch = a.archives || [];
  const out = [];
  for (let k = arch.length - 1; k >= Math.max(0, arch.length - 3) && out.length < 25; k--) {
    const g = await fetchJson(arch[k]);
    for (const x of (g.games || []).slice().reverse()) {
      if (x.rules !== 'chess' || !x.pgn) continue;
      const me = x.white.username.toLowerCase() === user.toLowerCase() ? 'w' : 'b';
      const res = x.white.result === 'win' ? '1-0' : x.black.result === 'win' ? '0-1' : '1/2-1/2';
      out.push({ pgn: x.pgn, w: x.white.username, b: x.black.username, wr: x.white.rating, br: x.black.rating, res, me, t: x.end_time * 1000, tc: x.time_class });
    }
  }
  return out.slice(0, 25);
}
async function loadLichess(user) {
  const r = await fetch(`https://lichess.org/api/games/user/${encodeURIComponent(user)}?max=25&pgnInJson=true&clocks=true&opening=true`, { headers: { Accept: 'application/x-ndjson' } });
  if (r.status === 404) throw new Error('Игрок не найден');
  if (!r.ok) throw new Error('Ошибка ' + r.status);
  const text = await r.text();
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((g) => g.variant === 'standard' && g.pgn).map((g) => {
    const wn = g.players.white.user ? g.players.white.user.name : 'Аноним';
    const bn = g.players.black.user ? g.players.black.user.name : 'Аноним';
    return {
      pgn: g.pgn, w: wn, b: bn, wr: g.players.white.rating, br: g.players.black.rating,
      res: g.winner === 'white' ? '1-0' : g.winner === 'black' ? '0-1' : '1/2-1/2',
      me: wn.toLowerCase() === user.toLowerCase() ? 'w' : 'b', t: g.createdAt, tc: g.speed,
    };
  });
}
const TC = { bullet: 'пуля', blitz: 'блиц', rapid: 'рапид', daily: 'по переписке', classical: 'классика', correspondence: 'по переписке', ultraBullet: 'ультрапуля' };
let fetchedGames = [];
async function findGames(e) {
  e.preventDefault();
  const user = $('userInput').value.trim();
  if (!user) return;
  store.set('user', user);
  const list = $('gamesList');
  list.innerHTML = '<div class="note">Загружаю партии…</div>';
  try {
    fetchedGames = S.src === 'lichess' ? await loadLichess(user) : await loadChessCom(user);
    if (!fetchedGames.length) { list.innerHTML = '<div class="note">Партий не найдено.</div>'; return; }
    list.innerHTML = fetchedGames.map((g, i) => {
      const mine = g.me === 'w' ? g.res === '1-0' : g.res === '0-1';
      const draw = g.res === '1/2-1/2';
      return `<button class="game" data-g="${i}">
        <span class="gres ${draw ? 'draw' : mine ? 'win' : 'loss'}">${draw ? '½' : mine ? '+' : '−'}</span>
        <span class="gnames"><div>⚪ <b>${esc(g.w)}</b> ${g.wr ? `(${g.wr})` : ''}</div><div>⚫ <b>${esc(g.b)}</b> ${g.br ? `(${g.br})` : ''}</div></span>
        <span class="gmeta">${esc(TC[g.tc] || g.tc || '')}<br>${new Date(g.t).toLocaleDateString('ru-RU')}</span></button>`;
    }).join('');
  } catch (err) {
    const hint = S.src === 'lichess' ? ' Можно вставить в поле выше ссылку на партию lichess или её PGN.' : '';
    list.innerHTML = `<div class="note">${esc((err.message === 'Failed to fetch' ? 'Нет связи с сервером.' : err.message + '.') + hint)}</div>`;
  }
}

/* ============================ Samples =============================== */

const SAMPLES = {
  opera: `[Event "Paris"]
[Site "Paris FRA"]
[Date "1858.??.??"]
[White "Пол Морфи"]
[Black "Герцог Брауншвейгский и граф Изуар"]
[Result "1-0"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`,
  immortal: `[Event "London"]
[Site "London ENG"]
[Date "1851.06.21"]
[White "Адольф Андерсен"]
[Black "Лионель Кизерицкий"]
[Result "1-0"]

1. e4 e5 2. f4 exf4 3. Bc4 Qh4+ 4. Kf1 b5 5. Bxb5 Nf6 6. Nf3 Qh6 7. d3 Nh5 8. Nh4 Qg5 9. Nf5 c6 10. g4 Nf6 11. Rg1 cxb5 12. h4 Qg6 13. h5 Qg5 14. Qf3 Ng8 15. Bxf4 Qf6 16. Nc3 Bc5 17. Nd5 Qxb2 18. Bd6 Bxg1 19. e5 Qxa1+ 20. Ke2 Na6 21. Nxg7+ Kd8 22. Qf6+ Nxf6 23. Be7# 1-0`,
};

/* ============================== Start =============================== */

async function startFromInput(orientation) {
  showError('');
  const raw = $('pgnInput').value.trim();
  // A link to a lichess game instead of a PGN.
  const li = raw.match(/^(?:https?:\/\/)?(?:www\.)?lichess\.org\/([A-Za-z0-9]{8})(?:[A-Za-z0-9]{4})?(?:\/(white|black))?/);
  if (li && !raw.includes('[') && !/\s1\.\s/.test(raw)) {
    try {
      const r = await fetch(`https://lichess.org/game/export/${li[1]}?clocks=true&evals=false`, { headers: { Accept: 'application/x-chess-pgn' } });
      if (!r.ok) throw new Error('Партия не найдена');
      const pgn = await r.text();
      $('pgnInput').value = pgn.trim();
      orientation = orientation || (li[2] === 'black' ? 'b' : 'w');
    } catch (e) { showError('Не удалось загрузить партию с lichess: ' + e.message); return; }
  } else if (/chess\.com\/(?:[a-z]+\/)?game\//i.test(raw) && !raw.includes('[')) {
    showError('Ссылки chess.com напрямую не открываются: введите свой ник в блоке «Загрузить мои партии» ниже или скопируйте PGN (Поделиться → PGN).');
    return;
  }
  let game;
  try { game = parseGame($('pgnInput').value); } catch (e) { showError(e.message); return; }
  analyse(game, { orientation: orientation || 'w' });
}

function bind() {
  $('analyzeBtn').onclick = () => startFromInput();
  $('pgnInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) startFromInput(); });
  $('depthSeg').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    S.depth = b.dataset.v; store.set('depth', S.depth); setSeg('depthSeg', S.depth);
  };
  $('srcSeg').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    S.src = b.dataset.v; store.set('src', S.src); setSeg('srcSeg', S.src);
  };
  for (const b of document.querySelectorAll('[data-sample]')) {
    b.onclick = () => { $('pgnInput').value = SAMPLES[b.dataset.sample]; showError(''); startFromInput('w'); };
  }
  $('userForm').addEventListener('submit', findGames);
  $('gamesList').onclick = (e) => {
    const b = e.target.closest('[data-g]'); if (!b) return;
    const g = fetchedGames[+b.dataset.g];
    $('pgnInput').value = g.pgn;
    startFromInput(g.me);
  };
  $('recentList').onclick = (e) => { const b = e.target.closest('[data-i]'); if (b) openRecent(+b.dataset.i); };
  $('cancelBtn').onclick = cancelAnalysis;
  $('startReviewBtn').onclick = () => { setView('review'); goTo(0, false); };
  $('newGameBtn').onclick = $('newGameBtn2').onclick = () => { setView('input'); window.scrollTo({ top: 0 }); };
  $('summaryBtn').onclick = () => { S.variation = null; S.retry = null; setView('summary'); };
  $('shareBtn').onclick = shareLink;
  $('navStart').onclick = () => (S.variation ? exitVariation() : goTo(0, false));
  $('navPrev').onclick = () => step(-1);
  $('navNext').onclick = () => step(1);
  $('navEnd').onclick = () => {
    if (S.variation) { S.variation.idx = S.variation.nodes.length - 1; afterVariationChange(false); } else goTo(S.game.moves.length, false);
  };
  $('navFlip').onclick = flip;
  $('varExit').onclick = exitVariation;
  $('arrowToggle').checked = S.showArrow;
  $('arrowToggle').onchange = (e) => { S.showArrow = e.target.checked; store.set('arrow', S.showArrow); renderBoard(false); };
  const jumpMistake = (dir) => {
    const res = S.review.results;
    const from = S.variation ? S.variation.base : S.ply;
    if (dir > 0) { for (let p = from + 1; p <= res.length; p++) if (A.BAD.has(res[p - 1].cls)) return goTo(p, false); }
    else { for (let p = from - 1; p >= 1; p--) if (A.BAD.has(res[p - 1].cls)) return goTo(p, false); }
    toast(dir > 0 ? 'Дальше ошибок нет' : 'Раньше ошибок нет');
  };
  $('nextMistakeBtn').onclick = () => jumpMistake(1);
  $('prevMistakeBtn').onclick = () => jumpMistake(-1);
  $('moveList').onclick = (e) => { const m = e.target.closest('[data-ply]'); if (m) goTo(+m.dataset.ply); };
  $('countsTable').onclick = (e) => {
    const tr = e.target.closest('tr[data-cls]'); if (!tr) return;
    const i = S.review.results.findIndex((r) => r.cls === tr.dataset.cls);
    if (i >= 0) { setView('review'); goTo(i + 1, false); }
  };
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (S.view === 'summary' && (e.key === 'ArrowRight' || e.key === 'Enter')) { setView('review'); goTo(S.ply ? S.ply : 1); e.preventDefault(); return; }
    if (S.view !== 'review') return;
    if (e.key === 'ArrowLeft') { step(-1); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { step(1); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { S.variation ? exitVariation() : goTo(0, false); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { goTo(S.game.moves.length, false); e.preventDefault(); }
    else if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') flip();
    else if (e.key === 'Escape') { if (S.retry) exitRetry(false); else if (S.variation) exitVariation(); }
  });
  let rz = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(rz);
    rz = requestAnimationFrame(() => { if (S.review) { renderGraph($('graph')); renderGraph($('graphSummary')); } });
  });
}

function boot() {
  buildSquares();
  bind();
  setSeg('depthSeg', S.depth);
  setSeg('srcSeg', S.src);
  $('userInput').value = store.get('user', '');
  renderBoard(false);
  renderPlayers();
  renderRecent();
  // Shared link: #pgn=…&side=b
  const hp = new URLSearchParams(location.hash.slice(1));
  if (hp.get('pgn')) {
    try {
      $('pgnInput').value = unb64url(hp.get('pgn'));
      startFromInput(hp.get('side') === 'b' ? 'b' : 'w');
      return;
    } catch (e) { console.warn(e); }
  }
  // Warm up the engines in the background so the first review starts fast.
  setTimeout(() => { getPool().catch(() => {}); getOpenings(); }, 400);
}

boot();
