import { Chess } from '../chess/vendor/chess.js';

/* =====================================================================
 *  Game review logic: move classification, accuracy and the coach's
 *  explanations. Pure functions — no DOM — so it can be tested in Node.
 * ===================================================================== */

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const KING_VAL = 100;
const FILES = 'abcdefgh';

export const CLS = {
  brilliant:  { label: 'Блестящий ход',   short: 'Блестящие',   glyph: '!!', color: '#22b8a0' },
  great:      { label: 'Сильный ход',     short: 'Сильные',     glyph: '!',  color: '#4a8ff0' },
  best:       { label: 'Лучший ход',      short: 'Лучшие',      icon: 'star',  color: '#68b33a' },
  excellent:  { label: 'Отличный ход',    short: 'Отличные',    icon: 'thumb', color: '#86c255' },
  good:       { label: 'Хороший ход',     short: 'Хорошие',     icon: 'check', color: '#93ab8c' },
  book:       { label: 'Теория',          short: 'Теория',      icon: 'book',  color: '#ab8862' },
  forced:     { label: 'Вынужденный ход', short: 'Вынужденные', icon: 'arrow', color: '#8a9099' },
  inaccuracy: { label: 'Неточность',      short: 'Неточности',  glyph: '?!', color: '#e6bd2e' },
  mistake:    { label: 'Ошибка',          short: 'Ошибки',      glyph: '?',  color: '#ee8720' },
  miss:       { label: 'Упущение',        short: 'Упущения',    icon: 'x',     color: '#e0577f' },
  blunder:    { label: 'Зевок',           short: 'Зевки',       glyph: '??', color: '#e23b36' },
};
export const CLS_ORDER = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'forced',
  'inaccuracy', 'mistake', 'miss', 'blunder'];
export const BAD = new Set(['inaccuracy', 'mistake', 'miss', 'blunder']);

/* ----------------------------- Russian ------------------------------ */

const PIECE = {
  p: { nom: 'пешка', acc: 'пешку', gen: 'пешки', dat: 'пешке', ins: 'пешкой', g: 'f', pl: 'пешек' },
  n: { nom: 'конь', acc: 'коня', gen: 'коня', dat: 'коню', ins: 'конём', g: 'm', pl: 'коней' },
  b: { nom: 'слон', acc: 'слона', gen: 'слона', dat: 'слону', ins: 'слоном', g: 'm', pl: 'слонов' },
  r: { nom: 'ладья', acc: 'ладью', gen: 'ладьи', dat: 'ладье', ins: 'ладьёй', g: 'f', pl: 'ладей' },
  q: { nom: 'ферзь', acc: 'ферзя', gen: 'ферзя', dat: 'ферзю', ins: 'ферзём', g: 'm', pl: 'ферзей' },
  k: { nom: 'король', acc: 'короля', gen: 'короля', dat: 'королю', ins: 'королём', g: 'm', pl: 'королей' },
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const him = (t) => (PIECE[t].g === 'f' ? 'её' : 'его');
export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
const moves_ = (n) => (n === 1 ? 'один ход' : `${n} ${plural(n, 'ход', 'хода', 'ходов')}`);
const mateIn = (n) => (n === 1 ? 'мат следующим ходом' : `форсированный мат в ${moves_(n)}`);
export const colorName = (c) => (c === 'w' ? 'белые' : 'чёрные');
function listAnd(items) {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' и ' + items[items.length - 1];
}

const FIG = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞' };
export const figurine = (san) => san.replace(/[KQRBN]/g, (c) => FIG[c]);
const S = (san) => `<b class="san">${figurine(san)}</b>`;

/* ----------------------------- Scores ------------------------------- */
// A score is {cp}, {mate: n≠0} or {res: 0|0.5|1} (finished game), always
// from the point of view of the side to move unless said otherwise.

export function neg(s) {
  if (!s) return s;
  if (s.res != null) return { res: 1 - s.res };
  if (s.mate != null) return { mate: -s.mate };
  return { cp: -s.cp };
}
/*
 * Chess.com-style "expected points". The curve and the accuracy formula
 * were fitted to Chess.com's own accuracy numbers on 84 real games across
 * all rating levels (beginners to masters); the cut-offs for Best /
 * Excellent / Good / Inaccuracy / Mistake / Blunder are Chess.com's
 * published ones (0 / 0.02 / 0.05 / 0.10 / 0.20 expected points lost).
 */
// k: slope used for move classes; kAcc/b/hfloor: accuracy formula fitted to
// Chess.com's numbers (mean abs. error ≈ 4 points; rating made no real difference).
export const MODEL = { k0: 0.0035, k1: 0, kmin: 0.003, kmax: 0.004, kAcc: 0.0022, b: 0.1, bonus: 0, hfloor: 15 };
const K_DEFAULT = 0.00368208;
/** Slope of the expected-points curve for a player of the given rating. */
export function kFor(rating) {
  const R = +rating;
  if (!R) return MODEL.k0;
  return Math.max(MODEL.kmin, Math.min(MODEL.kmax, MODEL.k0 + MODEL.k1 * (R - 1500) / 1000));
}
export function ratingK(headers, color) {
  return kFor(headers ? (color === 'w' ? headers.WhiteElo : headers.BlackElo) : null);
}

/** Expected points (0..1) for the side the score belongs to. */
export function ep(s, k = K_DEFAULT) {
  if (!s) return 0.5;
  if (s.res != null) return s.res;
  if (s.mate != null) return s.mate > 0 ? 1 : 0;
  return 1 / (1 + Math.exp(-k * Math.max(-1500, Math.min(1500, s.cp))));
}
export function fmtScore(s) {
  if (!s) return '';
  if (s.res != null) return s.res === 0.5 ? '½–½' : s.res === 1 ? '1–0' : '0–1';
  if (s.mate != null) return (s.mate > 0 ? '' : '−') + 'M' + Math.abs(s.mate);
  const v = s.cp / 100;
  const t = Math.abs(v).toFixed(Math.abs(v) >= 10 ? 1 : 2);
  return (v > 0.004 ? '+' : v < -0.004 ? '−' : '') + t;
}
/** Format a score given from `color`'s point of view as a white-POV number. */
export function fmtPov(s, color) { return fmtScore(color === 'w' ? s : neg(s)); }

/** White-perspective score of an analysed position. */
export function whiteScore(pos) {
  if (!pos || !pos.score) return null;
  const s = pos.score;
  if (s.res != null) return pos.turn === 'w' ? s : neg(s); // res is from side-to-move POV
  return pos.turn === 'w' ? s : neg(s);
}
export function fmtWhite(pos) {
  const s = whiteScore(pos);
  if (!s) return '';
  if (s.res != null) {
    if (s.res === 0.5) return '½–½';
    return s.res === 1 ? '1–0' : '0–1';
  }
  return fmtScore(s);
}

/* --------------------------- Board helpers -------------------------- */

export const sqName = (i) => FILES[i & 7] + ((i >> 3) + 1);
export const sqIndex = (s) => FILES.indexOf(s[0]) + 8 * (+s[1] - 1);
const other = (c) => (c === 'w' ? 'b' : 'w');

export function parseBoard(fen) {
  const b = new Array(64).fill(null);
  const rows = fen.split(' ')[0].split('/');
  for (let r = 0; r < 8; r++) {
    let f = 0;
    for (const ch of rows[r]) {
      if (ch >= '1' && ch <= '8') f += +ch;
      else { b[(7 - r) * 8 + f] = { c: ch === ch.toUpperCase() ? 'w' : 'b', t: ch.toLowerCase() }; f++; }
    }
  }
  return b;
}

const KN = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
const KG = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Squares of `color` pieces that attack `sq` (pins ignored). */
export function attackers(b, sq, color) {
  const out = [];
  const f = sq & 7, r = sq >> 3;
  const at = (ff, rr) => (ff >= 0 && ff < 8 && rr >= 0 && rr < 8 ? rr * 8 + ff : -1);
  const pr = color === 'w' ? r - 1 : r + 1;
  for (const df of [-1, 1]) {
    const s = at(f + df, pr);
    if (s >= 0 && b[s] && b[s].c === color && b[s].t === 'p') out.push(s);
  }
  for (const [df, dr] of KN) {
    const s = at(f + df, r + dr);
    if (s >= 0 && b[s] && b[s].c === color && b[s].t === 'n') out.push(s);
  }
  for (const [df, dr] of KG) {
    const s = at(f + df, r + dr);
    if (s >= 0 && b[s] && b[s].c === color && b[s].t === 'k') out.push(s);
  }
  for (const [dirs, types] of [[DIAG, 'bq'], [ORTH, 'rq']]) {
    for (const [df, dr] of dirs) {
      let ff = f + df, rr = r + dr;
      while (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) {
        const s = rr * 8 + ff, p = b[s];
        if (p) { if (p.c === color && types.includes(p.t)) out.push(s); break; }
        ff += df; rr += dr;
      }
    }
  }
  return out;
}

const pval = (p) => (p.t === 'k' ? KING_VAL : VAL[p.t]);
function leastAttacker(b, sq, color) {
  let best = -1, bv = Infinity;
  for (const s of attackers(b, sq, color)) { const v = pval(b[s]); if (v < bv) { bv = v; best = s; } }
  return best;
}

/** Static exchange evaluation: net material `side` wins by starting a capture sequence on `sq`. */
export function see(board, sq, side, first = -1) {
  if (!board[sq]) return 0;
  const b = board.slice();
  let from = first >= 0 ? first : leastAttacker(b, sq, side);
  if (from < 0) return 0;
  if (b[from].t === 'k' && attackers(b, sq, other(side)).length) return 0;
  const gain = [pval(b[sq])];
  let d = 0, cur = side;
  for (;;) {
    const piece = b[from];
    b[sq] = piece; b[from] = null;
    cur = other(cur);
    const nxt = leastAttacker(b, sq, cur);
    if (nxt < 0) break;
    if (b[nxt].t === 'k' && attackers(b, sq, other(cur)).length) break;
    d++;
    gain[d] = pval(piece) - gain[d - 1];
    from = nxt;
  }
  while (d > 0) { gain[d - 1] = -Math.max(-gain[d - 1], gain[d]); d--; }
  return gain[0];
}

function withTurn(fen, turn) {
  const p = fen.split(' ');
  p[1] = turn; p[3] = '-';
  return p.join(' ');
}
function safeChess(fen) { try { return new Chess(fen); } catch { return null; } }

/**
 * Pieces of `victim` colour that the other side could win right now
 * (as if it were its move). First capture must be legal; the rest is SEE.
 */
export function threatened(fen, victim) {
  const attacker = other(victim);
  const b = parseBoard(fen);
  const c = safeChess(withTurn(fen, attacker));
  let legal = null;
  const vk = b.findIndex((p) => p && p.t === 'k' && p.c === victim);
  const victimInCheck = vk >= 0 && attackers(b, vk, attacker).length > 0;
  if (c && !c.inCheck() && !victimInCheck) {
    try { legal = c.moves({ verbose: true }).filter((m) => m.captured && !m.flags.includes('e')); } catch { legal = null; }
  }
  const out = [];
  for (let s = 0; s < 64; s++) {
    const p = b[s];
    if (!p || p.c !== victim || p.t === 'k') continue;
    const name = sqName(s);
    const firsts = legal ? legal.filter((m) => m.to === name).map((m) => sqIndex(m.from)) : attackers(b, s, attacker);
    let g = 0;
    for (const f of firsts) g = Math.max(g, see(b, s, attacker, f));
    if (g > 0) out.push({ sq: name, t: p.t, gain: g });
  }
  return out.sort((x, y) => y.gain - x.gain || VAL[y.t] - VAL[x.t]);
}

/* ---------------------------- Lines --------------------------------- */

export function uciToMove(u) {
  return { from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined };
}

/** Play UCI moves from `fen`; continues past `maxPlies` while captures are still going on. */
export function playLine(fen, ucis, maxPlies = 8) {
  const c = safeChess(fen);
  const out = [];
  if (!c) return out;
  for (const u of ucis || []) {
    let m;
    try { m = c.move(uciToMove(u)); } catch { break; }
    if (!m) break;
    out.push(m);
    if (out.length >= maxPlies && (!m.captured || out.length >= maxPlies + 6)) break;
  }
  return out;
}

/** Material swing for `color` along a list of chess.js moves. */
export function materialSwing(moves, color) {
  let delta = 0, gained = null, lost = null, firstLoss = null;
  for (const m of moves) {
    if (m.captured) {
      if (m.color === color) { delta += VAL[m.captured]; if (!gained || VAL[m.captured] > VAL[gained]) gained = m.captured; }
      else {
        delta -= VAL[m.captured];
        if (!lost || VAL[m.captured] > VAL[lost]) lost = m.captured;
        if (!firstLoss) firstLoss = m;
      }
    }
    if (m.promotion) delta += (m.color === color ? 1 : -1) * (VAL[m.promotion] - 1);
  }
  return { delta, gained, lost, firstLoss };
}

/** Pieces won and given along a line, with even trades cancelled out. */
export function netCaptures(moves, color) {
  const g = { p: 0, n: 0, b: 0, r: 0, q: 0 }, l = { p: 0, n: 0, b: 0, r: 0, q: 0 };
  for (const m of moves) {
    const mine = m.color === color;
    if (m.captured) (mine ? g : l)[m.captured]++;
    if (m.promotion) { (mine ? g : l)[m.promotion]++; (mine ? l : g).p++; }
  }
  for (const t of 'pnbrq') { const k = Math.min(g[t], l[t]); g[t] -= k; l[t] -= k; }
  // A bishop for a knight is an even trade too.
  const k = Math.min(g.b + g.n, l.b + l.n);
  for (let i = 0; i < k; i++) {
    if (g.b) g.b--; else g.n--;
    if (l.b) l.b--; else l.n--;
  }
  return { g, l };
}

const PAWNS_ACC = ['', 'пешку', 'две пешки', 'три пешки', 'четыре пешки'];
/** "коня", "качество", "ферзя за ладью", "две пешки"… — what `g` wins against `l`. */
export function gainWords({ g, l }) {
  const big = ['q', 'r', 'b', 'n'];
  const G = big.filter((t) => g[t] > 0), L = big.filter((t) => l[t] > 0);
  const pawns = g.p - l.p;
  if (!G.length && !L.length) return pawns > 0 ? (PAWNS_ACC[pawns] || `${pawns} пешек`) : 'материал';
  if (G.length === 1 && g[G[0]] === 1 && !L.length) return PIECE[G[0]].acc;
  if (G.length === 1 && g[G[0]] === 1 && L.length === 1 && l[L[0]] === 1) {
    if (G[0] === 'r' && 'nb'.includes(L[0])) return 'качество';
    if (VAL[G[0]] > VAL[L[0]]) return `${PIECE[G[0]].acc} за ${PIECE[L[0]].acc}`;
  }
  if (G.length === 1 && g[G[0]] === 1 && !L.length) return PIECE[G[0]].acc;
  if (G.length === 2 && !L.length && g[G[0]] === 1 && g[G[1]] === 1) return `${PIECE[G[0]].acc} и ${PIECE[G[1]].acc}`;
  if (G.length === 1 && g[G[0]] === 2 && !L.length) return `двух ${PIECE[G[0]].pl}`.replace('двух пешек', 'две пешки');
  return 'материал';
}

export function lineSan(fen, ucis, max = 10) {
  const moves = [];
  const c = safeChess(fen);
  if (!c) return [];
  for (const u of (ucis || []).slice(0, max)) {
    try { const m = c.move(uciToMove(u)); if (!m) break; moves.push(m); } catch { break; }
  }
  return moves;
}

/** "12. Nf3 Nc6 13. Bb5" from chess.js moves starting at `fen`. */
export function numbered(fen, moves, fig = true) {
  const parts = fen.split(' ');
  let no = +parts[5] || 1;
  let turn = parts[1];
  const out = [];
  moves.forEach((m, i) => {
    const san = fig ? figurine(m.san) : m.san;
    if (turn === 'w') out.push(`${no}. ${san}`);
    else out.push(i === 0 ? `${no}… ${san}` : san);
    if (turn === 'b') no++;
    turn = other(turn);
  });
  return out.join(' ');
}

/* --------------------------- Move features -------------------------- */

const CENTER = new Set(['d4', 'e4', 'd5', 'e5']);

function isPassed(b, sq, color) {
  const f = sq & 7, r = sq >> 3;
  for (let ff = Math.max(0, f - 1); ff <= Math.min(7, f + 1); ff++) {
    for (let rr = color === 'w' ? r + 1 : r - 1; color === 'w' ? rr < 8 : rr >= 0; rr += color === 'w' ? 1 : -1) {
      const p = b[rr * 8 + ff];
      if (p && p.t === 'p' && p.c !== color) return false;
    }
  }
  return true;
}
function fileOpen(b, f) {
  for (let r = 0; r < 8; r++) { const p = b[r * 8 + f]; if (p && p.t === 'p') return false; }
  return true;
}

/**
 * What a move does: captures, checks, forks, threats, saving a piece,
 * leaving pieces en prise, development…
 */
export function moveFeatures(fenBefore, m, prevMove, ply) {
  const color = m.color, opp = other(color);
  const after = m.after;
  const bA = parseBoard(after);
  const cA = safeChess(after);
  const f = {
    check: m.san.includes('+') || m.san.includes('#'),
    mate: m.san.includes('#'),
    capture: m.captured || null,
    castle: m.flags.includes('k') ? 'k' : m.flags.includes('q') ? 'q' : null,
    promotion: m.promotion || null,
    recapture: !!(prevMove && prevMove.captured && prevMove.to === m.to && m.captured),
  };
  const toIdx = sqIndex(m.to);
  const moved = m.promotion || m.piece;

  // Threats before and after.
  const ownBefore = threatened(fenBefore, color);
  const ownAfter = cA ? threatened(after, color) : [];
  const oppBefore = threatened(withTurn(fenBefore, color), opp);
  const oppAfter = threatened(after, opp);
  const key = (x) => x.sq + x.t;
  const afterKeys = new Set(ownAfter.map(key));
  const beforeKeys = new Set(ownBefore.map(key));

  // A piece of ours that was en prise and is now safe.
  for (const x of ownBefore) {
    if (afterKeys.has(key(x)) || x.t === 'p') continue;
    if (x.sq === m.from && m.captured) continue;
    if (x.sq === m.from) { f.saves = { ...x, how: 'move' }; break; }
    if (bA[sqIndex(x.sq)] && bA[sqIndex(x.sq)].c === color) { f.saves = { ...x, how: 'defend' }; break; }
  }
  // Our pieces left en prise.
  f.hangs = ownAfter.filter((x) => !beforeKeys.has(key(x)) || x.sq === m.to);
  f.ignored = ownAfter.filter((x) => beforeKeys.has(key(x)) && x.sq !== m.to);

  // New targets for us.
  const oppBeforeKeys = new Set(oppBefore.map(key));
  f.attacks = oppAfter.filter((x) => !oppBeforeKeys.has(key(x)));

  // Fork: the moved piece hits two or more worthwhile targets.
  const targets = [];
  for (let s = 0; s < 64; s++) {
    const p = bA[s];
    if (!p || p.c !== opp) continue;
    if (!attackers(bA, s, color).includes(toIdx)) continue;
    if (p.t === 'k') targets.push({ sq: sqName(s), t: 'k' });
    else if (VAL[p.t] > VAL[moved] || (VAL[p.t] >= 3 && attackers(bA, s, opp).length === 0)) targets.push({ sq: sqName(s), t: p.t });
  }
  const movedSafe = !ownAfter.some((x) => x.sq === m.to);
  if (targets.length >= 2 && (movedSafe || targets.some((t) => t.t === 'k'))) f.fork = targets;

  if (ply < 30 && 'nb'.includes(m.piece) && ((color === 'w' && m.from[1] === '1') || (color === 'b' && m.from[1] === '8'))) f.develop = true;
  if (ply < 24 && m.piece === 'p' && CENTER.has(m.to)) f.center = true;
  if (m.piece === 'p' && !m.promotion && isPassed(bA, toIdx, color) && (color === 'w' ? +m.to[1] >= 5 : +m.to[1] <= 4)) f.passed = true;
  if (m.piece === 'r' && m.from[0] !== m.to[0] && fileOpen(bA, toIdx & 7)) f.openFile = true;
  if (f.capture && cA) {
    // Will the capturing piece be taken back evenly? → a trade.
    const back = see(bA, toIdx, opp);
    f.trade = !f.check && back > 0 && Math.abs(back - VAL[f.capture]) <= 0.5;
    // Nothing comes back at all → the piece was simply free.
    f.free = !f.recapture && back <= 0 && VAL[f.capture] >= 1;
  }
  if (m.piece === 'r' && +m.to[1] === (color === 'w' ? 7 : 2)) f.rook7 = true;

  // Was the mover in check before the move?
  const cB = safeChess(fenBefore);
  if (cB && cB.inCheck()) f.escape = m.piece === 'k' ? 'king' : m.captured ? 'capture' : 'block';

  // Pins / skewers created by the move.
  const lineTactics = (b) => {
    const out = [];
    for (let s0 = 0; s0 < 64; s0++) {
      const sp = b[s0];
      if (!sp || sp.c !== color || !'brq'.includes(sp.t)) continue;
      const dirs = sp.t === 'b' ? DIAG : sp.t === 'r' ? ORTH : DIAG.concat(ORTH);
      for (const [df, dr] of dirs) {
        let ff = (s0 & 7) + df, rr = (s0 >> 3) + dr, first = -1;
        while (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) {
          const q = rr * 8 + ff, pc = b[q];
          if (pc) {
            if (first < 0) { if (pc.c !== opp) break; first = q; }
            else {
              const x = b[first];
              if (pc.c === opp) {
                if (x.t !== 'k' && (pc.t === 'k' || VAL[pc.t] > VAL[x.t]) && VAL[x.t] >= 1) out.push({ kind: 'pin', t: x.t, to: pc.t, by: s0 });
                else if ((x.t === 'k' || x.t === 'q') && pc.t !== 'k' && VAL[pc.t] >= 3 && (x.t === 'k' || VAL[pc.t] < 9)) out.push({ kind: 'skewer', t: pc.t, front: x.t, by: s0 });
              }
              break;
            }
          }
          ff += df; rr += dr;
        }
      }
    }
    return out;
  };
  const bB = parseBoard(fenBefore);
  const tacKey = (x) => x.kind + x.t + (x.to || x.front);
  const oldTac = new Set(lineTactics(bB).map(tacKey));
  const newTac = lineTactics(bA).filter((x) => !oldTac.has(tacKey(x)));
  f.pin = newTac.find((x) => x.kind === 'pin' && x.t !== 'p') || null;
  f.skewer = newTac.find((x) => x.kind === 'skewer') || null;

  // Discovered check / attack: another of our pieces now hits the king or a big piece.
  const oppK = bA.findIndex((p) => p && p.t === 'k' && p.c === opp);
  if (f.check && oppK >= 0 && !attackers(bA, oppK, color).includes(toIdx)) f.discoveredCheck = true;
  if (!f.fork) {
    for (const x of f.attacks) {
      if (VAL[x.t] < 5) continue;
      const by = attackers(bA, sqIndex(x.sq), color);
      if (by.length && !by.includes(toIdx)) { f.discovered = x; break; }
    }
  }

  // Threat of mate next move (computed only if someone asks: it is the slow part).
  let mt;
  Object.defineProperty(f, 'mateThreat', {
    enumerable: true,
    get() {
      if (mt === undefined) {
        mt = false;
        if (!f.check && !f.mate) {
          const cT = safeChess(withTurn(after, color));
          if (cT && !cT.inCheck()) { try { mt = cT.moves({ verbose: true }).some((x) => x.san.endsWith('#')); } catch { mt = false; } }
        }
      }
      return mt;
    },
  });

  // Pushing a pawn in front of one's own castled king.
  let minorsMajors = 0, matUs = 0, matThem = 0;
  for (const p of bA) if (p && 'nbrq'.includes(p.t)) minorsMajors++;
  for (const p of bB) { if (!p) continue; if (p.c === color) matUs += VAL[p.t]; else matThem += VAL[p.t]; }
  const ourK = bA.findIndex((p) => p && p.t === 'k' && p.c === color);
  if (ourK >= 0 && m.piece === 'p' && !m.captured && minorsMajors > 6) {
    const kf = ourK & 7, home = color === 'w' ? 0 : 7;
    const fromRank = +m.from[1] - 1, ff = FILES.indexOf(m.from[0]);
    const shieldRank = color === 'w' ? 1 : 6;
    if ((ourK >> 3) === home && fromRank === shieldRank && ((kf >= 6 && ff >= 5) || (kf <= 2 && ff <= 2))) f.weakens = true;
  }
  if (f.trade && matUs - matThem >= 2) f.simplify = true;
  return f;
}

/* ------------------------- Classification --------------------------- */

const scoreOf = (line) => (line.res != null ? { res: line.res } : line.mate != null ? { mate: line.mate } : { cp: line.cp });

/**
 * Two engine opinions about the same move (both from the mover's POV):
 * its MultiPV line in the parent search and the separate search of the
 * resulting position. A found mate is a proof, so it wins; otherwise the
 * dedicated (and, on disagreement, re-verified deeper) search wins.
 */
function trustedScore(parent, child) {
  if (!child) return parent;
  if (child.res != null || child.mate != null) return child;
  if (parent && parent.mate != null) return parent;
  return child;
}

/** Positions whose evaluation contradicts the parent's line for the played move — worth a deeper look. */
export function positionsToVerify(game, pos) {
  const out = new Set();
  game.moves.forEach((m, i) => {
    const prev = pos[i], next = pos[i + 1];
    if (!prev || !next || !prev.lines || !next.lines || !next.lines.length) return;
    const uci = m.from + m.to + (m.promotion || '');
    const l = prev.lines.find((x) => x.uci === uci);
    if (!l) return;
    const a = scoreOf(l), b = neg(next.score);
    if (b.mate != null) return;
    if (a.mate != null || Math.abs(ep(a) - ep(b)) > 0.06) out.add(i + 1);
  });
  return [...out];
}

/**
 * prev — analysed position before the move: {fen, turn, lines:[{uci,cp|mate,pv}], score, legal}
 * next — analysed position after the move
 * m    — chess.js verbose move
 * ctx  — {ply, prevMove, prevResult, book, opening, prevPrevScore}
 */
export function reviewMove(prev, next, m, ctx = {}) {
  const color = m.color;
  const uci = m.from + m.to + (m.promotion || '');
  const k = ctx.k || MODEL.k0;
  const E = (sc) => ep(sc, k);
  // The position after the move was searched on its own, which is more
  // reliable than its MultiPV line here: trust it when the two disagree.
  let lines = (prev.lines || []).map((l) => ({ ...l }));
  const idx0 = lines.findIndex((l) => l.uci === uci);
  if (idx0 >= 0 && next.score) {
    const corr = trustedScore(scoreOf(lines[idx0]), neg(next.score));
    if (Math.abs(E(corr) - E(scoreOf(lines[idx0]))) > 0.05) {
      const l = lines[idx0];
      delete l.cp; delete l.mate; delete l.res;
      Object.assign(l, corr);
      lines = lines.map((x, i) => [x, i]).sort((a, b) => E(scoreOf(b[0])) - E(scoreOf(a[0])) || a[1] - b[1]).map((x) => x[0]);
    }
  }
  const best = lines[0];
  const epBest = best ? E(scoreOf(best)) : E(prev.score);
  const nextMover = neg(next.score);           // position after the move, from mover's POV
  const inLines = lines.findIndex((l) => l.uci === uci);
  let epPlayed;
  if (inLines === 0) epPlayed = epBest;
  else if (inLines > 0) epPlayed = E(scoreOf(lines[inLines]));
  else epPlayed = E(nextMover);
  if (next.score && next.score.res != null) epPlayed = E(nextMover);
  const loss = Math.max(0, epBest - epPlayed);
  // Same comparison on the flatter curve used for the accuracy score.
  const playedScore = inLines >= 0 && !(next.score && next.score.res != null) ? scoreOf(lines[inLines]) : nextMover;
  const lossAcc = inLines === 0 ? 0 : Math.max(0, ep(best ? scoreOf(best) : prev.score, MODEL.kAcc) - ep(playedScore, MODEL.kAcc));

  const r = {
    ply: ctx.ply, color, san: m.san, uci, from: m.from, to: m.to,
    loss, lossAcc, epBest, epPlayed, rank: inLines,
    bestUci: best ? best.uci : null,
    scoreAfter: nextMover, scoreBest: best ? scoreOf(best) : null,
  };
  if (best && best.uci !== uci) {
    const bm = lineSan(prev.fen, [best.uci], 1)[0];
    r.bestSan = bm ? bm.san : best.uci;
  }

  const legal = prev.legal ?? 2;
  let cls;
  const feats = moveFeatures(prev.fen, m, ctx.prevMove, ctx.ply);
  r.feats = feats;

  // Lines: what actually happens after the move, and what the best move leads to.
  const playedLine = [m, ...playLine(m.after, (next.lines && next.lines[0] && next.lines[0].pv) || [], 7)];
  const bestLine = best ? playLine(prev.fen, best.pv || [best.uci], 8) : [];
  const matPlayed = materialSwing(playedLine, color);
  const matBest = best && best.uci !== uci ? materialSwing(bestLine, color) : matPlayed;
  r.matPlayed = matPlayed.delta; r.matBest = matBest.delta;
  const moveGain = (m.captured ? VAL[m.captured] : 0) + (m.promotion ? VAL[m.promotion] - 1 : 0);

  const sacrifice = (() => {
    const fresh = feats.hangs.filter((x) => x.t !== 'p');
    if (!fresh.length) return null;
    const top = fresh[0];
    return top.gain - moveGain >= 2 ? top : null;
  })();

  const mateAfter = nextMover && nextMover.mate != null ? nextMover.mate : null; // >0: we mate, <0: we get mated
  const bestMate = best && best.mate != null && best.mate > 0 ? best.mate : null;

  // Best move among the others (to judge "only good move" / "winning anyway").
  const alt = lines.find((l) => l.uci !== uci);
  const epAlt = alt ? E(scoreOf(alt)) : null;
  const simpleRecapture = feats.recapture && ctx.prevMove && VAL[m.captured] >= VAL[ctx.prevMove.captured || 'p'];
  if (ctx.book && legal > 1) cls = 'book';
  else if (legal === 1) cls = 'best';
  else if (loss <= 0.01 && (inLines === 0 || loss <= 0.005 || inLines < 0)) {
    // Brilliant (Chess.com): a good piece sacrifice; not in a bad position
    // after it, and not completely winning even without it.
    if (sacrifice && epPlayed >= 0.45 && !feats.mate && (epAlt == null || epAlt < 0.97)) cls = 'brilliant';
    // Great: critical to the outcome — the only good move in the position.
    else if (inLines === 0 && epAlt != null && legal > 2 && !simpleRecapture && !feats.mate &&
      epPlayed - epAlt >= 0.1 && epPlayed >= 0.45 && epAlt < 0.97) cls = 'great';
    if (!cls) cls = inLines === 0 || loss === 0 ? 'best' : 'excellent';
  } else if (loss < 0.02) cls = 'excellent';
  else if (loss < 0.05) cls = 'good';
  else if (loss < 0.1) cls = 'inaccuracy';
  else if (loss < 0.2) cls = 'mistake';
  else cls = 'blunder';

  // Allowing a forced mate that wasn't there before is never just an inaccuracy.
  const wasMated = best && best.mate != null && best.mate < 0;
  if (mateAfter != null && mateAfter < 0 && !wasMated && legal > 1 && cls !== 'book') {
    const rank = CLS_ORDER.indexOf(cls);
    if (epBest > 0.15) cls = 'blunder';
    else if (rank < CLS_ORDER.indexOf('mistake')) cls = 'mistake';
  }
  // Miss: the opponent slipped and this move didn't punish it (or a short mate was overlooked).
  if (BAD.has(cls) || cls === 'good' || cls === 'excellent' || cls === 'best') {
    const pr = ctx.prevResult;
    const beforeErr = pr ? 1 - pr.epBest : null;
    const oppErred = pr && pr.loss >= 0.1;
    const missedPunish = oppErred && cls !== 'best' && loss >= 0.1 && epBest >= 0.5 &&
      epBest - beforeErr >= 0.1 && epPlayed >= beforeErr - 0.03;
    const playedMates = (mateAfter != null && mateAfter > 0) || feats.mate;
    const missedMate = bestMate && !playedMates && epPlayed >= 0.5 &&
      (bestMate <= 2 || (bestMate <= 4 && loss >= 0.02));
    if (missedPunish || missedMate) cls = 'miss';
  }

  // Sacrifice is only "brilliant" if it was also strong — keep for coach text.
  r.cls = cls;
  r.sacrifice = sacrifice;
  r.mateAfter = mateAfter;
  r.bestMate = bestMate;
  r.legal = legal;
  const memo = {};
  const featsOf = (key, fn) => { if (!(key in memo)) { try { memo[key] = fn(); } catch { memo[key] = null; } } return memo[key]; };
  const d = {
    m, prev, next, best, lines, playedLine, bestLine, matPlayed, matBest, feats, ctx,
    bestFeat: () => (best && best.uci !== uci && bestLine[0] ? featsOf('b', () => moveFeatures(prev.fen, bestLine[0], ctx.prevMove, ctx.ply)) : null),
    replyFeat: () => (playedLine[1] ? featsOf('r', () => moveFeatures(m.after, playedLine[1], m, ctx.ply + 1)) : null),
  };
  const P = ctx.picker || new Picker((ctx.ply || 0) + 7);
  r.texts = { me: explain(r, d, true, P), opp: explain(r, d, false, P) };
  r.text = r.texts.me;
  r.bestLine = best && best.uci !== uci ? numbered(prev.fen, lineSan(prev.fen, best.pv || [best.uci], 10)) : '';
  r.bestLineUci = best ? (best.pv || [best.uci]).slice(0, 12) : [];
  return r;
}

/* ---------------------------- Phrasebook ---------------------------- */
// The coach talks to the player ("ты") about their own moves and about
// "соперник" for the other side, in short lively lines like a real coach.
// Past tense is avoided for "ты" (the player's gender is unknown) and no
// square names are used — just the idea of the move.

/** Deterministic phrase picker that avoids repeating itself. */
export class Picker {
  constructor(seed = 1) { this.s = (seed * 2654435761) >>> 0 || 1; this.recent = new Map(); }
  rand() { let x = this.s; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.s = x >>> 0; return this.s / 4294967296; }
  pick(key, arr) {
    if (!arr || !arr.length) return '';
    if (arr.length === 1) return arr[0];
    const used = this.recent.get(key) || [];
    const free = arr.map((_, i) => i).filter((i) => !used.includes(i));
    const i = (free.length ? free : arr.map((_, k) => k))[Math.floor(this.rand() * (free.length || arr.length))];
    used.push(i);
    while (used.length > Math.min(arr.length - 1, 4)) used.shift();
    this.recent.set(key, used);
    return arr[i];
  }
}

const fem = (t) => PIECE[t].g === 'f';
const freeAcc = (t) => `${fem(t) ? 'бесплатную' : 'бесплатного'} ${PIECE[t].acc}`;
const yourAcc = (t) => `${fem(t) ? 'твою' : 'твоего'} ${PIECE[t].acc}`;
const yourNom = (t) => `${fem(t) ? 'твоя' : 'твой'} ${PIECE[t].nom}`;
const fill = (str, v) => str.replace(/\{(\w+)\}/g, (_, k) => (v[k] ?? ''));

/**
 * One short sentence about the main idea of a move.
 * me — the player made the move (else the opponent did).
 */
function idea(m, f, me, P) {
  const t = m.promotion || m.piece;
  const v = { P: PIECE[t].acc, N: cap(PIECE[t].nom) };
  const say = (key, you, they, extra = {}) => fill(P.pick((me ? 'y.' : 't.') + key, me ? you : they), { ...v, ...extra });
  if (f.promotion) return say('promo', ['Пешка проходит в ферзи!', 'Новый ферзь!', 'Пешка становится ферзём!'], ['Соперник проводит пешку в ферзи.', 'У соперника новый ферзь.']);
  if (f.fork) {
    const hasK = f.fork.some((x) => x.t === 'k');
    const T = listAnd([...(hasK ? ['короля'] : []), ...f.fork.filter((x) => x.t !== 'k').map((x) => PIECE[x.t].acc)]);
    return say('fork', ['Вилка! Нападаешь сразу на {T}.', 'Двойной удар — под атакой {T2}!', 'Вилка! Одним ходом нападаешь на {T}.'],
      ['Вилка! Соперник нападает сразу на {T}.', 'Соперник ставит вилку — под ударом {T2}.'],
      { T, T2: listAnd([...(hasK ? ['король'] : []), ...f.fork.filter((x) => x.t !== 'k').map((x) => PIECE[x.t].nom)]) });
  }
  if (f.discoveredCheck) return say('dchk', ['Вскрытый шах!', 'Открываешь линию — вскрытый шах!'], ['Соперник даёт вскрытый шах.']);
  if (f.mateThreat) return say('mthr', ['Угрожаешь матом!', 'Создаёшь угрозу мата!', 'Теперь в воздухе угроза мата!'], ['Соперник угрожает матом!', 'Осторожно: угроза мата!']);
  if (f.discovered) return say('disc', ['Вскрытое нападение на {X}!', 'Открываешь линию — и {X} под ударом!'], ['Соперник открывает линию: под ударом {Y}.'], { X: PIECE[f.discovered.t].acc, Y: yourNom(f.discovered.t) });
  const movedLost = (f.hangs || []).some((x) => x.sq === m.to);
  if (f.trade && f.capture && m.piece === f.capture && f.capture !== 'p' && !f.fork) {
    return say('trade', ['Размен {PL}.', 'Меняешься фигурами.', 'Размен — позиция упрощается.'], ['Соперник идёт на размен {PL}.', 'Размен {PL}.'], { PL: PIECE[f.capture].pl });
  }
  if (f.free && f.capture) return say('free', ['Забираешь {F}!', 'Бесплатный материал — забираем!', fem(f.capture) ? '{C} висела — и вот она твоя.' : '{C} висел — и вот он твой.'],
    ['Соперник забирает {F}.', 'Соперник забирает то, что висело.'], { F: freeAcc(f.capture), C: cap(PIECE[f.capture].nom) });
  if (f.pin && !movedLost) return say('pin', ['Связываешь {X}!', 'Связка! {XN} не может сдвинуться.', 'Отличная связка.'], ['Соперник связывает {Y}.', 'Связка: {YN} теперь прикован{a}.'],
    { X: PIECE[f.pin.t].acc, XN: cap(PIECE[f.pin.t].nom), Y: yourAcc(f.pin.t), YN: yourNom(f.pin.t), a: fem(f.pin.t) ? 'а' : '' });
  if (f.skewer && !movedLost) return say('skew', ['Сквозной удар!', 'Сквозной удар — за {F} стоит {X}.'], ['Соперник проводит сквозной удар.'], { F: PIECE[f.skewer.front].ins, X: PIECE[f.skewer.t].nom });
  const bigAttack = (f.attacks || []).find((x) => x.t === 'q' || x.t === 'r');
  if (bigAttack && !f.capture) return say('att', ['Нападаешь на {X}!', '{XN} соперника под ударом!', 'Атакуешь {X} с темпом.'], ['Соперник нападает на {Y}.', 'Под ударом {YN}!'],
    { X: PIECE[bigAttack.t].acc, XN: cap(PIECE[bigAttack.t].nom), Y: yourAcc(bigAttack.t), YN: yourNom(bigAttack.t) });
  if (f.saves && f.saves.how === 'move') return say('save', ['Уводишь {X} из-под удара.', 'Спасаешь {X}.', 'Вовремя убираешь {X}.'], ['Соперник уводит {X} из-под удара.', 'Соперник спасает {X}.'], { X: PIECE[f.saves.t].acc });
  if (f.escape === 'king') return say('esck', ['Уходишь от шаха.', 'Король уходит от шаха.'], ['Соперник уходит от шаха.']);
  if (f.escape === 'block') return say('escb', ['Закрываешься от шаха.', 'Прикрываешься от шаха.'], ['Соперник закрывается от шаха.']);
  if (f.recapture) return say('recap', ['Отыгрываешь {X}.', 'Забираешь {X} назад.', 'Восстанавливаешь материал.'], ['Соперник отыгрывает {X}.', 'Соперник забирает {X} назад.'], { X: PIECE[f.capture].acc });
  if (f.simplify) return say('simp', ['Ты впереди — меняться выгодно.', 'Разменивайся, когда впереди, — так и надо.', 'Упрощаешь позицию — материал за тобой.'], ['Соперник впереди по материалу и меняется.']);
  if (f.check) return say('chk', ['Шах!', 'Шах королю!', 'Даёшь шах.'], ['Шах от соперника.', 'Соперник даёт шах.']);
  if (f.castle) return say('castle', ['Рокировка — король в безопасности.', 'Прячешь короля. Правильно!', 'Король в домике, ладья в игре.'], ['Соперник делает рокировку.', 'Соперник прячет короля.']);
  if (f.trade && f.capture) {
    if (m.piece === f.capture && f.capture !== 'p') return say('trade', ['Размен {PL}.', 'Меняешься фигурами.', 'Размен — позиция упрощается.'], ['Соперник идёт на размен {PL}.', 'Размен {PL}.'], { PL: PIECE[f.capture].pl });
    return say('take', ['Забираешь {X}.', 'Берёшь {X}.'], ['Соперник забирает {X}.'], { X: PIECE[f.capture].acc });
  }
  if (f.capture) return say('take', ['Забираешь {X}.', 'Берёшь {X}.'], ['Соперник забирает {X}.'], { X: PIECE[f.capture].acc });
  if (f.saves) return say('def', ['Защищаешь {X}.', 'Прикрываешь {X}.'], ['Соперник защищает {X}.'], { X: PIECE[f.saves.t].acc });
  if (f.develop) return say('dev', ['Выводишь {P} в игру.', 'Развитие! {N} в деле.', 'Ещё одна фигура вступает в игру.', '{N} выходит на хорошую позицию.'], ['Соперник развивает {P}.', 'Соперник выводит {P}.']);
  if (f.center) return say('center', ['Занимаешь центр.', 'Борьба за центр — правильно.', 'Хватаешь центр.'], ['Соперник занимает центр.', 'Соперник борется за центр.']);
  if (f.passed) return say('passed', ['Проходная рвётся вперёд!', 'Двигаешь проходную.', 'Проходную — вперёд!'], ['Проходная соперника идёт вперёд.']);
  if (f.rook7) return say('r7', ['Ладья врывается на седьмую горизонталь!'], ['Ладья соперника врывается в твой лагерь.']);
  if (f.openFile) return say('file', ['Ладья на открытой линии.', 'Занимаешь открытую вертикаль.'], ['Соперник занимает открытую вертикаль.']);
  if (bigAttack) return say('att2', ['Нападаешь на {X}.'], ['Соперник нападает на {X}.'], { X: PIECE[bigAttack.t].acc });
  return '';
}

/** Short reason for the better move, as a participle phrase ("выигрывая коня"). */
function gerund(best, bestLine, matBest, matPlayed, bf, pf) {
  const same = (k) => pf && pf[k];
  if (best.mate != null && best.mate > 0) return best.mate === 1 ? ' — и сразу мат' : ` — там мат в ${moves_(best.mate)}`;
  const diff = matBest.delta - matPlayed.delta;
  if (diff >= 1.5 && matBest.delta >= 1) return `, выигрывая ${gainWords(netCaptures(bestLine, bestLine[0].color))}`;
  if (!bf) return '';
  if (bf.fork) return ' с вилкой';
  if (bf.free && bf.capture) return `, забирая ${freeAcc(bf.capture)}`;
  if (bf.mateThreat) return ' с угрозой мата';
  if (bf.pin) return `, связывая ${PIECE[bf.pin.t].acc}`;
  if (bf.discoveredCheck) return ' со вскрытым шахом';
  if (diff >= 1.5) return ', сохраняя материал';
  if (bf.saves && bf.saves.how === 'move' && !same('saves')) return `, спасая ${PIECE[bf.saves.t].acc}`;
  const big = (bf.attacks || []).find((x) => x.t === 'q' || x.t === 'r');
  if (big) return `, нападая на ${PIECE[big.t].acc}`;
  if (bf.check && !same('check')) return ' с шахом';
  if (bf.castle) return ' — рокировка';
  if (bf.capture) return `, забирая ${PIECE[bf.capture].acc}`;
  if (bf.develop && !(same('develop') && pf.piece === bestLine[0].piece)) return `, развивая ${PIECE[bestLine[0].piece].acc}`;
  if (bf.center && !same('center')) return ', занимая центр';
  return '';
}

/** Sentence describing what a move does (used for retries and explorations). */
export function purposeText(fenBefore, m, prevMove, ply, mode = 'you') {
  try { return idea(m, moveFeatures(fenBefore, m, prevMove, ply), mode !== 'they', new Picker(ply + 1)); } catch { return ''; }
}

/* ------------------------------ Coach ------------------------------- */

/**
 * The coach's words about a move. `me` — the move was made by the player
 * the review is for (the side at the bottom of the board).
 */
function explain(r, d, me, P) {
  const { m, prev, best, playedLine, bestLine, matPlayed, matBest, feats, ctx } = d;
  const Y = (mine, theirs) => (me ? mine : theirs);
  const pk = (key, mine, theirs) => P.pick((me ? 'y.' : 't.') + key, me ? mine : theirs);
  const out = [];
  const reply = playedLine[1];
  const bestMove = bestLine[0];
  const bestFeat = d.bestFeat();
  const B = bestMove ? S(bestMove.san) : '';
  const why = bestMove && best ? gerund(best, bestLine, matBest, matPlayed, bestFeat, { ...feats, piece: m.piece }) : '';
  const better = (soft) => {
    if (!best || best.uci === r.uci || !bestMove) return '';
    if (soft) return pk('soft', [`Но ${B} был ещё сильнее${why}.`, `Чуть точнее ${B}${why}.`, `${B} был бы ещё лучше${why}.`], [`Хотя ${B} был сильнее${why}.`]);
    return pk('better', [`Лучше было ${B}${why}.`, `Сильнее ${B}${why}.`, `Здесь просился ${B}${why}.`, `Надо было играть ${B}${why}.`],
      [`Соперник должен был играть ${B}${why}.`, `Правильно было ${B}${why}.`, `Сопернику стоило сыграть ${B}${why}.`]);
  };
  let thought = idea(m, feats, me, P);
  // "Соперник … Соперник …" → "Соперник … Он …"
  const himself = (txt) => (!me && txt.startsWith('Соперник ') ? 'Он ' + txt.slice(9) : txt);

  switch (r.legal === 1 && r.cls === 'best' ? 'forced' : r.cls) {
    case 'forced':
      out.push(pk('forced', ['Единственный ход.', 'Других ходов нет.', 'Тут без вариантов.'], ['У соперника единственный ход.', 'Сопернику больше некуда.']));
      break;
    case 'book':
      out.push(pk('book', ['Теория.', 'Книжный ход.', 'По теории.', 'Классика дебюта.'], ['Соперник играет по теории.', 'Книжный ответ соперника.', 'Теория.']));
      if (ctx.openingChanged && ctx.family) out.push(`Это ${ctx.family.charAt(0).toLowerCase() + ctx.family.slice(1)}.`);
      else if (thought && ctx.ply < 10) out.push(himself(thought));
      break;
    case 'brilliant': {
      const t = r.sacrifice.t;
      out.push(pk('bril', [`Блестяще! Ты жертвуешь ${PIECE[t].acc}!`, `Вау! Жертва ${PIECE[t].gen} — и это сильнейший ход!`, `Гениально! Отдаёшь ${PIECE[t].acc} ради атаки.`],
        [`Соперник жертвует ${PIECE[t].acc} — красиво!`, `Ого, жертва ${PIECE[t].gen} от соперника!`]));
      if (r.mateAfter > 0) out.push(Y(r.mateAfter === 1 ? 'Взятие — и мат!' : `Теперь мат в ${moves_(r.mateAfter)} неизбежен!`, 'Взять нельзя — будет мат.'));
      else if (reply && reply.captured && reply.to === r.sacrifice.sq && matPlayed.delta >= 0) out.push(Y('Если соперник возьмёт, всё вернётся с лихвой.', 'Если возьмёшь — всё вернётся сопернику с лихвой.'));
      else out.push(pk('bril2', ['Атака того стоит!', 'Инициатива дороже материала.', 'Брать опасно — это ловушка.'], ['Брать опасно — это ловушка.', 'У соперника мощная инициатива.']));
      break;
    }
    case 'great': {
      const turned = ctx.prevResult && ctx.prevResult.loss >= 0.1;
      out.push(turned
        ? pk('greatT', ['Сильно! Ты наказываешь соперника.', 'В точку — ошибка соперника наказана!', 'Отличная находка! Именно так наказывают за ошибки.'], ['Соперник находит сильный ответ.', 'Соперник не упускает шанс.'])
        : pk('great', ['Сильно! Это единственный хороший ход.', 'Отличная находка — других хороших ходов не было.', 'Только так! В точку.', 'Вот это глаз! Единственный сильный ход.'], ['Соперник находит единственный хороший ход.', 'Сильный ответ соперника — единственный в позиции.']));
      if (thought) out.push(himself(thought));
      break;
    }
    case 'best':
      out.push(pk('best', ['Лучший ход!', 'Точно!', 'В точку!', 'Именно так!', 'Супер!', 'Как движок!', 'Отличное решение!'],
        ['Соперник находит лучший ход.', 'Точный ход соперника.', 'Соперник играет сильнейшее.', 'Соперник не ошибается.']));
      if (thought) out.push(himself(thought));
      else {
        const e = r.epPlayed;
        out.push(e >= 0.6 ? pk('bestW', ['Держишь преимущество.', 'Всё под контролем.', 'Так и продолжай!'], ['Он держит перевес.'])
          : e > 0.4 ? pk('bestE', ['Позиция в равновесии.', 'Крепкий ход.', 'Ничего лишнего.'], ['Равновесие сохраняется.'])
          : pk('bestL', ['Лучший шанс в трудной позиции.', 'Сопротивляешься упорно.', 'Цепляешься за каждый шанс.'], ['Он сопротивляется упорно.']));
      }
      break;
    case 'excellent':
      out.push(pk('exc', ['Отлично!', 'Хороший выбор!', 'Очень хорошо.', 'Здорово!'], ['Хороший ход соперника.', 'Соперник играет отлично.']));
      if (thought) out.push(himself(thought));
      else out.push(r.epPlayed >= 0.6 ? pk('excW', ['Перевес на твоей стороне.', 'Уверенная игра.'], ['Он держит перевес.']) : pk('excE', ['Крепкий ход.', 'Солидно.', 'Ничего лишнего.'], ['Солидный ход.']));
      break;
    case 'good':
      out.push(pk('good', ['Неплохо.', 'Нормальный ход.', 'Годится.', 'Хороший ход.'], ['Неплохой ход соперника.', 'Соперник играет нормально.']));
      if (thought) out.push(himself(thought));
      out.push(better(true));
      break;
    default: {
      const heads = {
        inaccuracy: [['Хм, неточно.', 'Не самый точный ход.', 'Неточность.', 'Можно было лучше.'], ['Неточность соперника.', 'Соперник играет неточно.']],
        mistake: [['Ошибка.', 'Ой, ошибка.', 'Упс.', 'Так не стоило.'], ['Соперник ошибается!', 'Ошибка соперника!', 'Соперник промахнулся!']],
        blunder: [['Зевок!', 'Ай!', 'Ох, зевок…', 'Ой-ой!'], ['Соперник зевает!', 'Подарок от соперника!', 'Грубая ошибка соперника!']],
        miss: [['Упущено!', 'Эх, шанс упущен!', 'Мимо!'], ['Соперник упускает шанс!', 'Повезло — соперник не увидел!']],
      }[r.cls];
      out.push(P.pick((me ? 'y.' : 't.') + r.cls, heads[me ? 0 : 1]));
      if (r.cls === 'miss') {
        if (r.bestMate) out.push(Y(`Здесь был мат в ${moves_(r.bestMate)}: ${S(r.bestSan)}!`, `У соперника был мат в ${moves_(r.bestMate)}.`));
        else {
          out.push(Y(`После ошибки соперника можно было сыграть ${B}${why}.`, `После твоей ошибки соперник мог сыграть ${B}${why}.`));
        }
        break;
      }
      const lostBy = matBest.delta - matPlayed.delta;
      if (r.mateAfter != null && r.mateAfter < 0) {
        const n = -r.mateAfter;
        out.push(pk('allowMate', [`Теперь у соперника мат в ${moves_(n)}.`, `Это пропускает мат в ${moves_(n)}!`], [`Теперь у тебя мат в ${moves_(n)}!`, `Ищи мат в ${moves_(n)}!`]));
      } else if (lostBy >= 1.5) {
        const loss = matPlayed.firstLoss;
        const rf = d.replyFeat();
        if (loss && feats.hangs.some((x) => x.sq === loss.to)) {
          const t = loss.captured;
          out.push(pk('hang', [`${cap(yourNom(t))} остаётся без защиты.`, `Оставляешь ${PIECE[t].acc} под ударом.`, `${cap(PIECE[t].nom)} просто висит!`],
            [`${cap(PIECE[t].nom)} соперника висит — забирай!`, `Соперник оставил ${PIECE[t].acc} без защиты!`, `Бесплатн${fem(t) ? 'ая' : 'ый'} ${PIECE[t].nom} для тебя!`]));
        } else if (loss && feats.ignored.some((x) => x.sq === loss.to)) {
          const t = loss.captured;
          out.push(pk('ign', [`Угроза осталась без ответа — теряешь ${PIECE[t].acc}.`, `${cap(yourNom(t))} так и остаётся под ударом.`],
            [`Соперник не заметил угрозу — ${PIECE[t].nom} висит!`, `Соперник прозевал угрозу: забирай ${PIECE[t].acc}!`]));
        } else if (rf && rf.fork) {
          out.push(pk('fork', ['Это пропускает вилку!', 'Соперник получает вилку.'], ['Теперь у тебя есть вилка!', 'Можно поставить вилку!']));
        } else if (rf && (rf.pin || rf.skewer || rf.discovered || rf.discoveredCheck)) {
          out.push(pk('tac', ['Это пропускает тактический удар.', 'У соперника появляется тактика.'], ['Теперь у тебя есть тактический удар!']));
        } else {
          const gw = gainWords(netCaptures(playedLine, other(m.color)));
          out.push(pk('lose', [`Теряешь ${gw}.`, 'Это стоит материала.', `Соперник выигрывает ${gw}.`],
            [`Ты выигрываешь ${gw}!`, `Теперь можно выиграть ${gw}!`]));
        }
        if (!me && reply) out.push(`Отвечай ${S(reply.san)}!`);
        if (!me) break;
      } else if (feats.weakens) {
        out.push(Y('Это ослабляет твоего короля.', 'Соперник ослабляет своего короля.'));
      } else {
        const b = r.epBest, a = r.epPlayed;
        if (b >= 0.8 && a < 0.66) out.push(pk('lostWin', ['Победа ускользает.', 'Выигранная позиция уходит.'], ['Он упускает победу!', 'Выигрыш ускользает от него!']));
        else if (b >= 0.56 && a <= 0.56) out.push(pk('lostAdv', ['Преимущество тает.', 'Перевес уходит.'], ['Его перевес тает.', 'Он растерял преимущество.']));
        else if (b > 0.44 && a <= 0.36) out.push(pk('worse', ['Теперь соперник лучше.', 'Позиция становится тяжёлой.'], ['Теперь ты лучше!', 'Перевес переходит к тебе!']));
        else if (b > 0.2 && a <= 0.1) out.push(pk('lost', ['Защищаться становится очень трудно.', 'Позиция почти проиграна.'], ['Теперь у тебя почти выигранная позиция!']));
        else if (r.cls === 'blunder') out.push(pk('bad3', ['Это серьёзно ухудшает позицию.', 'Теперь всё гораздо сложнее.'], ['Это сильно на руку тебе!', 'Его позиция резко ухудшается!']));
        else if (r.cls === 'mistake') out.push(pk('bad2', ['Позиция заметно ухудшается.', 'Это отдаёт инициативу сопернику.'], ['Это на руку тебе.', 'Его позиция заметно ухудшается.']));
        else out.push(pk('meh', ['Позиция становится чуть хуже.', 'Это немного ухудшает позицию.', 'Не лучший план.'], ['Это на руку тебе.', 'Его позиция ухудшается.']));
        if (me && reply && r.cls !== 'inaccuracy') {
          const rf = d.replyFeat();
          const g = rf ? gerund({ uci: reply.from + reply.to }, [reply], { delta: 0 }, { delta: 0 }, rf) : '';
          if (g) out.push(pk('reply', [`Соперник отвечает ${S(reply.san)}${g}.`, `Сильнейший ответ — ${S(reply.san)}${g}.`], []));
        }
        if (!me && reply && r.cls !== 'inaccuracy') {
          const rf = d.replyFeat();
          const g = rf ? gerund({ uci: reply.from + reply.to }, [reply], { delta: 0 }, { delta: 0 }, rf) : '';
          const pun = [`Наказывай: ${S(reply.san)}${g}!`, `Твой ход — ${S(reply.san)}${g}!`, `Пользуйся: ${S(reply.san)}${g}!`];
          out.push(pk('punish', pun, pun));
          break;
        }
      }
      out.push(better(false));
    }
  }
  if (feats.mate) {
    out.length = 0;
    out.push(pk('mate', ['Мат! Победа!', 'Мат! Партия твоя!', 'Мат! Отличный финиш!'], ['Мат. Соперник победил.', 'Увы, мат.']));
  } else if (r.mateAfter > 0 && !BAD.has(r.cls) && r.cls !== 'brilliant') {
    out.push(Y(`Теперь у тебя мат в ${moves_(r.mateAfter)}!`, `У соперника теперь мат в ${moves_(r.mateAfter)}.`));
  } else if (r.mateAfter < 0 && !BAD.has(r.cls)) {
    out.push(Y(`Увы, у соперника мат в ${moves_(-r.mateAfter)}.`, `У тебя мат в ${moves_(-r.mateAfter)}!`));
  }
  return out.filter(Boolean).join(' ');
}

/* ------------------------- Whole-game review ------------------------ */

const fenKey = (fen) => fen.split(' ').slice(0, 3).join(' ');

export function openingAt(openings, fen) {
  return openings ? openings[fenKey(fen)] || null : null;
}

/** Opening book: sorted 32-bit hashes of positions strong players reach in the opening. */
const fnv = (str) => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; };
export function makeBook(buffer) {
  const arr = new Uint32Array(buffer);
  return {
    size: arr.length,
    has(key) {
      const h = fnv(key);
      let lo = 0, hi = arr.length - 1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (arr[mid] === h) return true; if (arr[mid] < h) lo = mid + 1; else hi = mid - 1; }
      return false;
    },
  };
}

/**
 * game: {startFen, moves:[chess.js verbose], fens:[...]}
 * pos:  analysed positions (fens.length entries)
 */
export function reviewGame(game, pos, openings, book) {
  const it = reviewSteps(game, pos, openings, book);
  let r;
  while (!(r = it.next()).done);
  return r.value;
}

function* reviewSteps(game, pos, openings, book) {
  const results = [];
  let inBook = (!!openings || !!book) && fenKey(game.startFen) === fenKey(START_FEN);
  let opening = null;
  const picker = new Picker(game.moves.length * 31 + (game.fens[game.fens.length - 1] || '').length);
  for (let i = 0; i < game.moves.length; i++) {
    const m = game.moves[i];
    const key = fenKey(game.fens[i + 1]);
    const op = inBook && openings ? openings[key] || null : null;
    const isBook = inBook && i < 30 && (!!op || !!(book && book.has(key)));
    if (inBook && !isBook) inBook = false;
    const changed = !!op && (!opening || openingFamily(opening) !== openingFamily(op));
    if (op) opening = op;
    const r = reviewMove(pos[i], pos[i + 1], m, {
      picker,
      k: ratingK(game.headers, m.color),
      openingChanged: changed,
      ply: i,
      prevMove: game.moves[i - 1] || null,
      prevResult: results[i - 1] || null,
      book: isBook,
      opening: op ? openingName(op) : null,
      family: op ? openingFamily(op) : null,
    });
    r.opening = opening ? openingName(opening) : null;
    results.push(r);
    yield i + 1;
  }
  return { results, stats: gameStats(game, pos, results), opening: opening ? openingName(opening) : null, family: opening ? openingFamily(opening) : null, eco: opening ? opening[0] : null };
}

/** Same as reviewGame but yields to the browser now and then (keeps the page responsive). */
export async function reviewGameAsync(game, pos, openings, book, onProgress) {
  const it = reviewSteps(game, pos, openings, book);
  let r, t = Date.now();
  while (!(r = it.next()).done) {
    if (Date.now() - t > 25) {
      if (onProgress) onProgress(r.value / Math.max(1, game.moves.length));
      await new Promise((res) => setTimeout(res, 0));
      t = Date.now();
    }
  }
  return r.value;
}

/* ----------------------------- Accuracy ----------------------------- */

export function moveAccuracy(loss) {
  const d = loss * 100;
  const a = 103.1668100711649 * Math.exp(-MODEL.b * d) - 3.166924740191411 + MODEL.bonus;
  return Math.max(0, Math.min(100, d <= 0 ? 100 : a));
}

function std(xs) {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

// Accuracy → typical rating of players who score it (medians from the calibration games).
const RATING_PTS = [[0, 100], [30, 300], [50, 550], [60, 750], [65, 950], [70, 1100], [75, 1250], [80, 1500], [85, 1750],
  [90, 2000], [93, 2200], [95, 2350], [97, 2550], [98.5, 2750], [100, 2900]];
export function ratingFromAccuracy(a) {
  for (let i = 1; i < RATING_PTS.length; i++) {
    const [x1, y1] = RATING_PTS[i - 1], [x2, y2] = RATING_PTS[i];
    if (a <= x2) return Math.round((y1 + (y2 - y1) * (a - x1) / (x2 - x1)) / 50) * 50;
  }
  return 3000;
}

function phaseOf(fen, ply) {
  const b = parseBoard(fen);
  let minors = 0, majors = 0, backW = 0, backB = 0;
  for (let s = 0; s < 64; s++) {
    const p = b[s];
    if (!p) continue;
    if ('nb'.includes(p.t)) minors++;
    if ('rq'.includes(p.t)) majors++;
    if (p.t !== 'p' && p.t !== 'k') { if (p.c === 'w' && s < 8) backW++; if (p.c === 'b' && s >= 56) backB++; }
  }
  if (minors + majors <= 6) return 'endgame';
  if (ply < 20 && minors + majors > 10 && (backW > 3 || backB > 3)) return 'opening';
  return 'middlegame';
}

export function gameStats(game, pos, results) {
  const n = results.length;
  const win = pos.map((p) => ep(whiteScore(p) || { cp: 0 }) * 100);
  const ws = Math.max(2, Math.min(8, Math.floor(n / 10)));
  const windows = [];
  for (let k = 0; k < Math.min(ws, win.length) - 2; k++) windows.push(win.slice(0, ws));
  for (let j = 0; j + ws <= win.length; j++) windows.push(win.slice(j, j + ws));
  const weights = results.map((_, i) => Math.max(0.5, Math.min(12, windows[i] ? std(windows[i]) : 0.5)));

  const per = { w: [], b: [] };
  results.forEach((r, i) => {
    const acc = r.legal === 1 ? 100 : moveAccuracy(r.lossAcc ?? r.loss);
    r.accuracy = acc;
    per[r.color].push({ acc, w: weights[i], i });
  });
  const accuracy = {};
  for (const c of ['w', 'b']) {
    const xs = per[c];
    if (!xs.length) { accuracy[c] = null; continue; }
    // Mean blended with the harmonic mean: a few big blunders weigh more than in a plain average.
    const mean = xs.reduce((a, x) => a + x.acc, 0) / xs.length;
    const hm = xs.length / xs.reduce((a, x) => a + 1 / Math.max(MODEL.hfloor, x.acc), 0);
    accuracy[c] = Math.round(((mean + hm) / 2) * 10) / 10;
  }
  const counts = { w: {}, b: {} };
  for (const k of CLS_ORDER) { counts.w[k] = 0; counts.b[k] = 0; }
  results.forEach((r) => counts[r.color][r.cls]++);

  // Game phases.
  const phases = { opening: { w: [], b: [] }, middlegame: { w: [], b: [] }, endgame: { w: [], b: [] } };
  let phase = 'opening';
  results.forEach((r, i) => {
    const p = phaseOf(game.fens[i], i);
    if (phase === 'opening' && p !== 'opening' && r.cls !== 'book') phase = p;
    if (phase === 'middlegame' && p === 'endgame') phase = 'endgame';
    r.phase = phase;
    phases[phase][r.color].push(r.accuracy);
  });
  const phaseAcc = {};
  for (const [k, v] of Object.entries(phases)) {
    phaseAcc[k] = {};
    for (const c of ['w', 'b']) phaseAcc[k][c] = v[c].length ? v[c].reduce((a, b) => a + b, 0) / v[c].length : null;
  }
  const rating = {};
  for (const c of ['w', 'b']) rating[c] = accuracy[c] != null && per[c].length >= 5 ? ratingFromAccuracy(accuracy[c]) : null;
  return { accuracy, counts, phaseAcc, rating };
}

export function phaseClass(a) {
  if (a == null) return null;
  if (a >= 90) return 'best';
  if (a >= 80) return 'excellent';
  if (a >= 65) return 'good';
  if (a >= 50) return 'inaccuracy';
  if (a >= 35) return 'mistake';
  return 'blunder';
}

/* --------------------------- Opening names -------------------------- */

const FAMILY = {
  'Sicilian Defense': 'Сицилианская защита', 'Ruy Lopez': 'Испанская партия', 'French Defense': 'Французская защита',
  "Queen's Gambit Declined": 'Отказанный ферзевый гамбит', "Queen's Gambit Accepted": 'Принятый ферзевый гамбит',
  "Queen's Gambit": 'Ферзевый гамбит', 'Italian Game': 'Итальянская партия', 'English Opening': 'Английское начало',
  "King's Gambit Accepted": 'Принятый королевский гамбит', "King's Gambit Declined": 'Отказанный королевский гамбит',
  "King's Gambit": 'Королевский гамбит', "King's Indian Defense": 'Староиндийская защита',
  'Caro-Kann Defense': 'Защита Каро — Канн', 'Nimzo-Indian Defense': 'Защита Нимцовича', "Queen's Pawn Game": 'Дебют ферзевой пешки',
  'Semi-Slav Defense': 'Полуславянская защита', 'Slav Defense': 'Славянская защита', 'Dutch Defense': 'Голландская защита',
  'Benoni Defense': 'Защита Бенони', 'Grünfeld Defense': 'Защита Грюнфельда', 'Neo-Grünfeld Defense': 'Защита Нео-Грюнфельда',
  "Queen's Indian Defense": 'Новоиндийская защита', 'Alekhine Defense': 'Защита Алёхина', 'Scotch Game': 'Шотландская партия',
  'Indian Defense': 'Индийская защита', "Petrov's Defense": 'Русская партия', 'Four Knights Game': 'Партия четырёх коней',
  'Three Knights Opening': 'Партия трёх коней', 'Zukertort Opening': 'Начало Цукерторта', 'Scandinavian Defense': 'Скандинавская защита',
  'Philidor Defense': 'Защита Филидора', 'Réti Opening': 'Дебют Рети', 'Nimzowitsch Defense': 'Защита Нимцовича',
  'Vienna Game': 'Венская партия', "Bishop's Opening": 'Дебют слона', 'Modern Defense': 'Современная защита',
  "King's Pawn Game": 'Дебют королевской пешки', "King's Pawn Opening": 'Дебют королевской пешки', 'Catalan Opening': 'Каталонское начало',
  'Pirc Defense': 'Защита Пирца', 'Bird Opening': 'Дебют Берда', 'Tarrasch Defense': 'Защита Тарраша', 'Polish Opening': 'Польское начало',
  'Bogo-Indian Defense': 'Защита Боголюбова', "King's Indian Attack": 'Староиндийское начало', 'Hungarian Opening': 'Венгерское начало',
  'Center Game': 'Центральный дебют', 'Latvian Gambit': 'Латышский гамбит', 'Ponziani Opening': 'Дебют Понциани',
  'Old Indian Defense': 'Староиндийская защита (старая)', 'Trompowsky Attack': 'Атака Тромповского', 'Benko Gambit': 'Волжский гамбит',
  'Benko Gambit Accepted': 'Принятый волжский гамбит', 'Benko Gambit Declined': 'Отказанный волжский гамбит',
  'Englund Gambit': 'Гамбит Энглунда', 'Owen Defense': 'Защита Оуэна', 'Torre Attack': 'Атака Торре', 'London System': 'Лондонская система',
  'Colle System': 'Система Колле', 'Danish Gambit': 'Датский гамбит', 'Danish Gambit Accepted': 'Принятый датский гамбит',
  'Elephant Gambit': 'Гамбит слона', 'Blackmar-Diemer Gambit': 'Гамбит Блэкмара — Димера', 'Grob Opening': 'Дебют Гроба',
  'Nimzo-Larsen Attack': 'Начало Ларсена', 'Rapport-Jobava System': 'Система Рапорта — Джобавы', 'Van Geet Opening': 'Дебют Ван Гета',
  "King's Knight Opening": 'Дебют королевского коня', 'Richter-Veresov Attack': 'Атака Рихтера — Вересова', 'Budapest Defense': 'Будапештский гамбит',
  'Czech Defense': 'Чешская защита', 'Hippopotamus Defense': 'Защита «Гиппопотам»', 'Rat Defense': 'Защита «Крыса»',
  'Mieses Opening': 'Дебют Мизеса', 'Saragossa Opening': 'Сарагосское начало', 'Bongcloud Attack': 'Атака «Бонгклауд»',
  'Englund Gambit Declined': 'Отказанный гамбит Энглунда', 'Semi-Slav Defense Accepted': 'Принятая полуславянская защита',
  'Center Game Accepted': 'Принятый центральный дебют', 'Danish Gambit Declined': 'Отказанный датский гамбит',
  'Blackmar-Diemer Gambit Accepted': 'Принятый гамбит Блэкмара — Димера', 'Latvian Gambit Accepted': 'Принятый латышский гамбит',
  'Vienna Gambit, with Max Lange Defense': 'Венский гамбит', "Queen's Indian Defense, with e3": 'Новоиндийская защита',
  'Mexican Defense': 'Мексиканская защита', 'Polish Defense': 'Польская защита', 'English Defense': 'Английская защита',
  'Pseudo Queen\'s Indian Defense': 'Новоиндийская защита', 'Rubinstein Opening': 'Дебют Рубинштейна', 'Kádas Opening': 'Дебют Кадаша',
  'Ware Opening': 'Дебют Уэра', 'Amar Opening': 'Дебют Амара', 'Clemenz Opening': 'Дебют Клеменца', 'Anderssen\'s Opening': 'Дебют Андерсена',
  'Lion Defense': 'Защита «Лев»', 'Borg Defense': 'Защита Борга', 'Van\'t Kruijs Opening': 'Дебют Ван-т-Крюйса', 'Elephant Gambit': 'Гамбит слона',
  'Kangaroo Defense': 'Защита «Кенгуру»', 'St. George Defense': 'Защита Святого Георгия', 'Mikenas Defense': 'Защита Микенаса',
};

/** Russian family name of an opening ("Сицилианская защита"), or null if we have no translation. */
export function openingFamily(op) {
  const name = op[1];
  const i = name.indexOf(':');
  return FAMILY[i < 0 ? name : name.slice(0, i)] || null;
}

export function openingName(op) {
  const name = op[1];
  const i = name.indexOf(':');
  const fam = i < 0 ? name : name.slice(0, i);
  const rest = i < 0 ? '' : name.slice(i + 1).trim();
  const famRu = FAMILY[fam] || fam;
  return rest ? `${famRu}: ${rest}` : famRu;
}

/* ------------------------------ Summary ----------------------------- */

export function summaryText(game, review, me = 'w') {
  const { stats, results } = review;
  const { accuracy } = stats;
  const op = me === 'w' ? 'b' : 'w';
  const seed = results.length;
  const parts = [];
  if (accuracy.w != null && accuracy.b != null) {
    const a = accuracy[me], o = accuracy[op];
    if (Math.abs(a - o) < 3) parts.push(`Точность почти равная: у тебя ${fmtAcc(a)}, у соперника ${fmtAcc(o)}. Упорная борьба!`);
    else if (a > o) parts.push([`Сегодня точность на твоей стороне: ${fmtAcc(a)} против ${fmtAcc(o)}.`, `Хорошая работа! Твоя точность — ${fmtAcc(a)}, у соперника — ${fmtAcc(o)}.`][seed % 2]);
    else parts.push(`Соперник был точнее: ${fmtAcc(o)} против твоих ${fmtAcc(a)}. Давай посмотрим, где можно было сыграть лучше.`);
  }
  // Turning point: the biggest swing.
  let worst = null;
  for (const r of results) if (BAD.has(r.cls) && (!worst || r.loss > worst.loss)) worst = r;
  if (worst) {
    const no = Math.floor(worst.ply / 2) + 1;
    const label = `${no}${worst.color === 'w' ? '.' : '…'} ${S(worst.san)}`;
    const kind = CLS[worst.cls].label.toLowerCase();
    if (worst.color === me) parts.push(`Главный момент партии — твой ход ${label} (${kind}). Разберём его подробно.`);
    else parts.push(`Переломный момент — ход соперника ${label} (${kind}).`);
  } else parts.push('Серьёзных ошибок не было — отличная партия!');
  const mine = results.filter((r) => r.cls === 'brilliant' && r.color === me).length;
  const theirs = results.filter((r) => r.cls === 'brilliant' && r.color === op).length;
  if (mine) parts.push(mine === 1 ? 'А ещё у тебя есть блестящий ход!' : `А ещё у тебя ${mine} ${plural(mine, 'блестящий ход', 'блестящих хода', 'блестящих ходов')}!`);
  if (theirs) parts.push(theirs === 1 ? 'Соперник тоже отметился блестящим ходом.' : `У соперника ${theirs} ${plural(theirs, 'блестящий ход', 'блестящих хода', 'блестящих ходов')}.`);
  if (review.family || review.opening) parts.push(`Дебют: <i>${review.family || review.opening}</i>.`);
  return parts.join(' ');
}
const fmtAcc = (a) => `${a.toFixed(1).replace('.', ',')}%`;
