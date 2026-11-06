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
  p: { nom: 'пешка', acc: 'пешку', gen: 'пешки', ins: 'пешкой', g: 'f', pl: 'пешек' },
  n: { nom: 'конь', acc: 'коня', gen: 'коня', ins: 'конём', g: 'm', pl: 'коней' },
  b: { nom: 'слон', acc: 'слона', gen: 'слона', ins: 'слоном', g: 'm', pl: 'слонов' },
  r: { nom: 'ладья', acc: 'ладью', gen: 'ладьи', ins: 'ладьёй', g: 'f', pl: 'ладей' },
  q: { nom: 'ферзь', acc: 'ферзя', gen: 'ферзя', ins: 'ферзём', g: 'm', pl: 'ферзей' },
  k: { nom: 'король', acc: 'короля', gen: 'короля', ins: 'королём', g: 'm', pl: 'королей' },
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
const moves_ = (n) => `${n} ${plural(n, 'ход', 'хода', 'ходов')}`;
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
/** Expected points (0..1) for the side the score belongs to. */
export function ep(s) {
  if (!s) return 0.5;
  if (s.res != null) return s.res;
  if (s.mate != null) return s.mate > 0 ? 1 : 0;
  return 1 / (1 + Math.exp(-0.00368208 * s.cp));
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
  }
  return f;
}

/* ------------------------------ Voice ------------------------------- */
// The coach talks to the player ("ты") about their own moves and about
// "соперник" for the other side. Past tense is avoided for "ты" (gender).

const pick = (arr, seed) => arr[Math.abs(seed) % arr.length];
function poss(t, c) {
  const f = PIECE[t].g === 'f';
  if (c === 'nom') return f ? 'твоя' : 'твой';
  if (c === 'acc') return f ? 'твою' : 'твоего';
  return f ? 'твоей' : 'твоего';
}
/** "твой конь" / "конь соперника" — `me`: the piece belongs to the player. */
const ownPiece = (me, t, c = 'nom') => (me ? `${poss(t, c)} ${PIECE[t][c]}` : `${PIECE[t][c]} соперника`);

/** Sentence describing what a move does (used for retries and explorations). */
export function purposeText(fenBefore, m, prevMove, ply, mode = 'you') {
  try { return purpose(m, moveFeatures(fenBefore, m, prevMove, ply), { mode }); } catch { return ''; }
}

/**
 * What a (good) move does, in the coach's voice.
 * mode 'you'  — "Забираешь пешку и занимаешь центр."
 *      'they' — "Соперник забирает пешку…" (subject configurable)
 *      'move' — "забирает пешку" (a phrase about the move itself)
 */
function purpose(m, f, { mode = 'move', maxItems = 2, lower = false, subj = 'Соперник' } = {}) {
  const you = mode === 'you';
  const v = (ty, on) => (you ? ty : on);
  const out = [];
  let solo = '';
  const movedT = m.promotion || m.piece;
  if (f.mate) out.push(v('ставишь мат', 'ставит мат'));
  if (f.check && !f.mate && !f.fork) out.push(v('даёшь шах', 'даёт шах'));
  if (f.promotion) {
    out.push(f.promotion === 'q' ? v('проводишь пешку в ферзи', 'проводит пешку в ферзи')
      : v(`превращаешь пешку в ${PIECE[f.promotion].acc}`, `превращает пешку в ${PIECE[f.promotion].acc}`));
  }
  if (f.fork) {
    const hasK = f.fork.some((t) => t.t === 'k');
    const rest = listAnd(f.fork.filter((t) => t.t !== 'k').map((t) => PIECE[t.t].acc));
    if (mode === 'move') return hasK ? `шах с вилкой — заодно нападение на ${rest}` : `вилка: нападение сразу на ${rest}`;
    if (you) solo = hasK ? `Шах — и заодно вилка: нападаешь на ${rest}!` : `Вилка! ${cap(ownPiece(true, movedT))} нападает сразу на ${rest}.`;
    else solo = hasK ? `Шах с вилкой: ${subj === 'Соперник' ? 'соперник' : subj.toLowerCase()} заодно нападает на ${rest}.` : `Вилка! ${cap(PIECE[movedT].nom)} соперника нападает сразу на ${rest}.`;
  }
  if (f.capture && !f.fork) {
    const mp = m.piece, cp = f.capture;
    if (f.recapture) out.push(v(`отыгрываешь ${PIECE[cp].acc}`, `отыгрывает ${PIECE[cp].acc}`));
    else if (f.trade && mp === cp && cp !== 'p') out.push(v(`идёшь на размен ${PIECE[cp].pl}`, `идёт на размен ${PIECE[cp].pl}`));
    else if (f.trade && 'nb'.includes(mp) && 'nb'.includes(cp)) out.push(v(`меняешь ${PIECE[mp].acc} на ${PIECE[cp].acc}`, `меняет ${PIECE[mp].acc} на ${PIECE[cp].acc}`));
    else out.push(v(`забираешь ${PIECE[cp].acc}`, `забирает ${PIECE[cp].acc}`));
  }
  if (f.saves && out.length < maxItems) {
    out.push(f.saves.how === 'move'
      ? v(`уводишь ${PIECE[f.saves.t].acc} из-под удара`, `уводит ${PIECE[f.saves.t].acc} из-под удара`)
      : v(`защищаешь ${PIECE[f.saves.t].acc} на ${f.saves.sq}`, `защищает ${PIECE[f.saves.t].acc} на ${f.saves.sq}`));
  }
  if (f.castle) out.push(v('прячешь короля и вводишь ладью в игру', 'прячет короля и вводит ладью в игру'));
  if (!f.fork && f.attacks && f.attacks.length && !f.mate) {
    const t = f.attacks[0];
    out.push(v(`нападаешь на ${PIECE[t.t].acc} на ${t.sq}`, `нападает на ${PIECE[t.t].acc} на ${t.sq}`));
  }
  if (f.develop) out.push(v(`выводишь ${PIECE[movedT].acc} в игру`, `выводит ${PIECE[movedT].acc} в игру`));
  if (f.center) out.push(v('занимаешь центр', 'занимает центр'));
  if (f.passed) out.push(v('двигаешь вперёд проходную пешку', 'двигает вперёд проходную пешку'));
  if (f.openFile) out.push(v('ставишь ладью на открытую вертикаль', 'ставит ладью на открытую вертикаль'));
  const items = out.slice(0, solo ? maxItems - 1 : maxItems);
  if (mode === 'move') {
    if (!items.length) return '';
    const s = listAnd(items);
    return lower ? s : cap(s) + '.';
  }
  let sentence = '';
  if (items.length) sentence = you ? cap(listAnd(items)) + '.' : `${subj} ${listAnd(items)}.`;
  return [solo, sentence].filter(Boolean).join(' ');
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
  // The position after the move was searched on its own, which is more
  // reliable than its MultiPV line here: trust it when the two disagree.
  let lines = (prev.lines || []).map((l) => ({ ...l }));
  const idx0 = lines.findIndex((l) => l.uci === uci);
  if (idx0 >= 0 && next.score) {
    const corr = trustedScore(scoreOf(lines[idx0]), neg(next.score));
    if (Math.abs(ep(corr) - ep(scoreOf(lines[idx0]))) > 0.05) {
      const l = lines[idx0];
      delete l.cp; delete l.mate; delete l.res;
      Object.assign(l, corr);
      lines = lines.map((x, i) => [x, i]).sort((a, b) => ep(scoreOf(b[0])) - ep(scoreOf(a[0])) || a[1] - b[1]).map((x) => x[0]);
    }
  }
  const best = lines[0];
  const epBest = best ? ep(scoreOf(best)) : ep(prev.score);
  const nextMover = neg(next.score);           // position after the move, from mover's POV
  const inLines = lines.findIndex((l) => l.uci === uci);
  let epPlayed;
  if (inLines === 0) epPlayed = epBest;
  else if (inLines > 0) epPlayed = ep(scoreOf(lines[inLines]));
  else epPlayed = ep(nextMover);
  if (next.score && next.score.res != null) epPlayed = ep(nextMover);
  const loss = Math.max(0, epBest - epPlayed);

  const r = {
    ply: ctx.ply, color, san: m.san, uci, from: m.from, to: m.to,
    loss, epBest, epPlayed, rank: inLines,
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

  if (legal === 1) cls = 'forced';
  else if (ctx.book) cls = 'book';
  else if (loss <= 0.01 && (inLines === 0 || loss <= 0.005 || inLines < 0)) {
    // Brilliant: a sound piece sacrifice in a position that isn't already trivially won.
    const leadsToMate = mateAfter != null && mateAfter > 0;
    if (sacrifice && epPlayed >= 0.45 && (epBest < 0.97 || leadsToMate) && !feats.mate) cls = 'brilliant';
    else if (inLines === 0 && lines[1] && legal > 3) {
      const ep2 = ep(scoreOf(lines[1]));
      const band = (e) => (e >= 0.75 ? 2 : e > 0.3 ? 1 : 0);
      const trivial = feats.recapture || feats.saves?.how === 'move' ||
        (m.captured && see(parseBoard(prev.fen), sqIndex(m.to), color, sqIndex(m.from)) >= 2);
      if (epBest - ep2 >= 0.15 && band(epBest) > band(ep2) && epBest >= 0.35 && !trivial && !feats.mate) cls = 'great';
    }
    if (!cls) cls = inLines === 0 || loss === 0 ? 'best' : 'excellent';
  } else if (loss < 0.02) cls = 'excellent';
  else if (loss < 0.05) cls = 'good';
  else if (loss < 0.1) cls = 'inaccuracy';
  else if (loss < 0.2) cls = 'mistake';
  else cls = 'blunder';

  // Allowing a forced mate that wasn't there before is never just an inaccuracy.
  const wasMated = best && best.mate != null && best.mate < 0;
  if (mateAfter != null && mateAfter < 0 && !wasMated && !['forced', 'book'].includes(cls)) {
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
  const d = { m, prev, next, best, lines, playedLine, bestLine, matPlayed, matBest, feats, ctx };
  r.texts = { me: explain(r, d, true), opp: explain(r, d, false) };
  r.text = r.texts.me;
  r.bestLine = best && best.uci !== uci ? numbered(prev.fen, lineSan(prev.fen, best.pv || [best.uci], 10)) : '';
  r.bestLineUci = best ? (best.pv || [best.uci]).slice(0, 12) : [];
  return r;
}

/* ------------------------------ Coach ------------------------------- */

/** Why the engine's move was better — a phrase whose subject is the move. */
function bestReason(best, bestLine, matBest, matPlayed, bestFeat, tense = 'pres') {
  const past = tense === 'past';
  if (best.mate != null && best.mate > 0) {
    if (best.mate === 1) return past ? 'ставил мат сразу' : 'сразу ставит мат';
    return past ? `вёл к мату в ${moves_(best.mate)}` : `ведёт к мату в ${moves_(best.mate)}`;
  }
  const diff = matBest.delta - matPlayed.delta;
  if (diff >= 1.5 && matBest.delta >= 1) {
    const w = gainWords(netCaptures(bestLine, bestLine[0].color));
    return `${past ? 'выигрывал' : 'выигрывает'} ${w}`;
  }
  if (diff >= 1.5) return past ? 'сохранял материал' : 'сохраняет материал';
  if (past) return '';
  return bestFeat ? purpose(bestLine[0], bestFeat, { mode: 'move', maxItems: 1, lower: true }) : '';
}

/**
 * The coach's words about a move. `me` — the move was made by the player
 * the review is for (the side at the bottom of the board).
 */
function explain(r, d, me) {
  const { m, prev, best, playedLine, bestLine, matPlayed, matBest, feats, ctx } = d;
  const seed = (ctx.ply || 0) * 7 + CLS_ORDER.indexOf(r.cls) + (me ? 0 : 3);
  const P = (arr) => pick(arr, seed);
  const Y = (mine, theirs) => (me ? mine : theirs);
  const out = [];
  const reply = playedLine[1];
  const bestMove = bestLine[0];
  let bestFeat = null;
  if (best && best.uci !== r.uci && bestMove) {
    try { bestFeat = moveFeatures(prev.fen, bestMove, ctx.prevMove, ctx.ply); } catch { bestFeat = null; }
  }
  const bestSan = bestMove ? S(bestMove.san) : '';
  const why = (tense) => (bestMove ? bestReason(best, bestLine, matBest, matPlayed, bestFeat, tense) : '');
  const what = purpose(m, feats, { mode: me ? 'you' : 'they', subj: 'Он' });
  const better = (soft) => {
    if (!best || best.uci === r.uci || !bestMove) return '';
    const w = why('pres');
    const tail = w ? ` — ${w}` : '';
    if (soft) return Y(P([`Но ${bestSan} был ещё сильнее${tail}.`, `Чуть точнее ${bestSan}${tail}.`]),
      `Хотя ${bestSan} был сильнее${tail}.`);
    return Y(P([`Лучше было ${bestSan}${tail}.`, `Сильнее ${bestSan}${tail}.`, `Надо было играть ${bestSan}${tail}.`]),
      P([`Соперник должен был играть ${bestSan}${tail}.`, `Правильно было ${bestSan}${tail}.`, `У соперника был ход получше: ${bestSan}${tail}.`]));
  };
  const outcome = r.epBest >= 0.75 ? 'сохраняет выигрыш' : r.epBest >= 0.56 ? 'сохраняет преимущество' : 'спасает позицию';

  switch (r.cls) {
    case 'forced':
      out.push(Y(P(['Здесь без вариантов — это единственный ход.', 'Других ходов просто нет.']),
        P(['У соперника не было выбора — единственный ход.', 'Вынужденно: других ходов у соперника нет.'])));
      break;
    case 'book': {
      const op = ctx.opening ? `<i>${ctx.opening}</i>` : '';
      out.push(Y(P([`Теория${op ? ': ' + op : ''}. Играешь по книге!`, `Всё по теории${op ? ' — ' + op : ''}.`, `Книжный ход${op ? ' (' + op + ')' : ''}. Так играют мастера.`]),
        P([`Соперник тоже знает теорию${op ? ': ' + op : ''}.`, `Книжный ответ${op ? ' — ' + op : ''}.`, `Соперник играет по теории${op ? ': ' + op : ''}.`])));
      if (ctx.ply < 8 && what) out.push(what);
      break;
    }
    case 'brilliant': {
      const t = r.sacrifice.t;
      out.push(Y(P([`Блестяще!! Ты жертвуешь ${PIECE[t].acc}!`, `Вот это ход! Ты отдаёшь ${PIECE[t].acc} — и это сильнейшее продолжение!`, `Браво! Жертва ${PIECE[t].gen} — как у гроссмейстеров!`]),
        P([`Ого! Соперник жертвует ${PIECE[t].acc} — блестящий ход!`, `Красиво! Соперник отдаёт ${PIECE[t].acc}, и это очень сильно.`])));
      if (r.mateAfter > 0) {
        out.push(r.mateAfter === 1 ? Y('Если соперник возьмёт — следует мат!', 'Если взять — следует мат.')
          : Y(`Теперь у тебя форсированный мат в ${moves_(r.mateAfter)}!`, `Теперь у соперника форсированный мат в ${moves_(r.mateAfter)}.`));
      } else if (reply && reply.captured && reply.to === r.sacrifice.sq) {
        out.push(matPlayed.delta >= 0
          ? Y('Если соперник примет жертву, ты вернёшь всё с лихвой.', 'Примешь жертву — соперник вернёт всё с лихвой. Осторожно!')
          : Y('Взамен — мощная атака на короля.', 'Взамен у соперника мощная инициатива.'));
      } else {
        out.push(Y(`Брать ${PIECE[t].acc} сопернику опасно — это ловушка.`, `Брать ${PIECE[t].acc} тебе невыгодно — это ловушка.`));
      }
      break;
    }
    case 'great': {
      out.push(Y(P([`Отличная находка! Это единственный ход, который ${outcome}.`, `Сильно! Только этот ход ${outcome} — в точку!`, `Вот это глаз! Единственный ход, который ${outcome}.`]),
        P([`Соперник находит единственный ход, который ${outcome}.`, `Сильный ответ соперника — только этот ход ${outcome}.`])));
      if (what) out.push(what);
      const l2 = d.lines[1];
      if (l2) {
        const m2 = lineSan(prev.fen, [l2.uci], 1)[0];
        const e2 = ep(scoreOf(l2));
        if (m2) {
          const bad = Y(e2 < 0.3 ? 'вёл к тяжёлой позиции' : 'упускал перевес', e2 < 0.3 ? 'отдавал тебе перевес' : 'давал тебе отыграться');
          out.push(`Любой другой ход, например ${S(m2.san)}, ${bad} (${fmtPov(scoreOf(l2), r.color)}).`);
        }
      }
      break;
    }
    case 'best': {
      out.push(Y(P(['Лучший ход!', 'Точно!', 'Именно так!', 'Сильнейший ход.', 'Так сыграл бы и Stockfish.']),
        P(['Соперник находит лучший ход.', 'Точный ход соперника.', 'Соперник играет сильнейшее.'])));
      if (what) out.push(what);
      else {
        const e = r.epPlayed;
        out.push(Y(e >= 0.56 ? P(['Держишь преимущество.', 'Преимущество под контролем.']) : e > 0.44 ? P(['Позиция в равновесии.', 'Всё под контролем.']) : P(['Лучший шанс в трудной позиции.', 'Сопротивляешься как можно упорнее.']),
          e >= 0.56 ? 'Он держит преимущество.' : e > 0.44 ? 'Равновесие сохраняется.' : 'Он цепляется за лучший шанс.'));
      }
      break;
    }
    case 'excellent':
      out.push(Y(P(['Отличный ход!', 'Очень хорошо!', 'Отлично сыграно.']), P(['Хороший ход соперника.', 'Соперник играет отлично.'])));
      if (what) out.push(what);
      if (r.bestSan) out.push(Y(P([`Stockfish чуть больше любит ${S(r.bestSan)}, но разница копеечная.`, `${S(r.bestSan)} был чуточку точнее, но это мелочи.`]),
        `Движок предпочёл бы ${S(r.bestSan)}, но разница минимальна.`));
      break;
    case 'good':
      out.push(Y(P(['Неплохо.', 'Нормальный ход.', 'Годится.']), P(['Неплохой ход соперника.', 'Соперник играет нормально.'])));
      if (what) out.push(what);
      out.push(better(true));
      break;
    default: {
      // inaccuracy / mistake / blunder / miss
      const heads = {
        inaccuracy: [['Хм, неточность.', 'Не самый точный ход.', 'Можно было лучше.'], ['Неточность соперника.', 'Соперник играет неточно.']],
        mistake: [['Ошибка.', 'Ой, это ошибка.', 'Вот тут ошибка.'], ['Соперник ошибается!', 'Ошибка соперника!']],
        blunder: [['Зевок!', 'Ох… это зевок.', 'Ай! Грубая ошибка.'], ['Соперник зевает!', 'Грубая ошибка соперника!', 'Подарок от соперника!']],
        miss: [['Упущенный шанс!', 'Эх, шанс упущен!'], ['Соперник упускает шанс!', 'Повезло — соперник не увидел шанс!']],
      }[r.cls];
      out.push(P(heads[me ? 0 : 1]));
      if (r.cls === 'miss') {
        if (r.bestMate) {
          out.push(Y(`Здесь был мат в ${moves_(r.bestMate)}: ${S(r.bestSan)}!`, `У соперника был мат в ${moves_(r.bestMate)}: ${S(r.bestSan)}.`));
        } else {
          const prevSan = ctx.prevMove ? S(ctx.prevMove.san) : '';
          const w = why('past');
          if (me) {
            out.push(`Соперник ошибся${prevSan ? ` (${prevSan})` : ''}, и ${S(r.bestSan)} ${w || 'давал большой перевес'}.`);
            out.push(P(['Теперь момент ушёл.', 'Шанс ушёл — в следующий раз смотри внимательнее!']));
          } else {
            out.push(`После твоей ошибки${prevSan ? ` (${prevSan})` : ''} соперник мог сыграть ${S(r.bestSan)}${w ? ` — этот ход ${w}` : ' с большим перевесом'}. Но он его не увидел.`);
          }
        }
        break;
      }
      const lostBy = matBest.delta - matPlayed.delta;
      if (r.mateAfter != null && r.mateAfter < 0) {
        const n = -r.mateAfter;
        const line = playedLine.slice(1, 1 + 2 * n);
        const tail = line.length ? ': ' + numbered(m.after, line) : '';
        out.push(Y(`Теперь у соперника ${mateIn(n)}${tail}.`, `Теперь у тебя ${mateIn(n)}${tail}!`));
      } else if (lostBy >= 1.5) {
        const loss = matPlayed.firstLoss;
        if (loss && feats.hangs.some((x) => x.sq === loss.to)) {
          const t = loss.captured;
          out.push(Y(`${cap(ownPiece(true, t))} на ${loss.to} остаётся без защиты — соперник просто забирает ${him(t)}: ${S(loss.san)}.`,
            `${cap(ownPiece(false, t))} на ${loss.to} висит — забирай: ${S(loss.san)}!`));
        } else if (loss && feats.ignored.some((x) => x.sq === loss.to)) {
          const t = loss.captured;
          out.push(Y(`Осторожно, угроза! ${cap(ownPiece(true, t))} на ${loss.to} так и висит, и соперник забирает ${him(t)} — ${S(loss.san)}.`,
            `Соперник не заметил угрозу — ${PIECE[t].acc} на ${loss.to} можно забрать: ${S(loss.san)}!`));
        } else if (reply) {
          let rf = null;
          try { rf = moveFeatures(m.after, reply, m, ctx.ply + 1); } catch { rf = null; }
          if (rf && rf.fork) {
            const names = listAnd(rf.fork.map((t) => PIECE[t.t].acc));
            out.push(Y(`Это пропускает вилку ${S(reply.san)}: под ударом ${names}.`, `Это даёт тебе вилку ${S(reply.san)} — под ударом ${names}!`));
          } else {
            const gw = gainWords(netCaptures(playedLine, other(m.color)));
            out.push(Y(`После ${S(reply.san)} ты теряешь ${gw}.`, `Отвечай ${S(reply.san)} — и ты выигрываешь ${gw}!`));
          }
        }
      } else if (feats.ignored.length && r.cls !== 'inaccuracy' && reply && reply.captured) {
        const x = feats.ignored[0];
        const left = PIECE[x.t].g === 'f' ? 'осталась' : 'остался';
        out.push(Y(`${cap(ownPiece(true, x.t))} на ${x.sq} ${left} под ударом.`, `${cap(ownPiece(false, x.t))} на ${x.sq} ${left} под ударом — пользуйся!`));
      } else {
        const b = r.epBest, a = r.epPlayed;
        if (b >= 0.8 && a < 0.66) out.push(Y('Выигранная позиция ускользает.', 'Соперник выпускает почти выигранную позицию.'));
        else if (b >= 0.56 && a <= 0.56) out.push(Y('Преимущество уходит.', 'Соперник растерял своё преимущество.'));
        else if (b > 0.44 && a <= 0.34) out.push(Y('Позиция становится тяжёлой.', 'Теперь перевес на твоей стороне!'));
        else if (b > 0.2 && a <= 0.1) out.push(Y('После этого защищаться очень трудно.', 'Теперь у тебя почти выигранная позиция!'));
        else out.push(Y(`Оценка смещается в пользу соперника: ${fmtPov(r.scoreBest, r.color)} → ${fmtPov(r.scoreAfter, r.color)}.`,
          `Оценка смещается в твою пользу: ${fmtPov(r.scoreBest, r.color)} → ${fmtPov(r.scoreAfter, r.color)}.`));
        if (reply) {
          let rf = null;
          try { rf = moveFeatures(m.after, reply, m, ctx.ply + 1); } catch { rf = null; }
          const p = rf ? purpose(reply, rf, { mode: 'move', maxItems: 1, lower: true }) : '';
          if (p && !rf.develop && !rf.center && !rf.recapture) {
            out.push(Y(`Соперник может ответить ${S(reply.san)} — ${p}.`, `Наказывай: ${S(reply.san)} — ${p}!`));
          }
        }
      }
      out.push(better(false));
    }
  }
  if (feats.mate) {
    out.length = 0;
    out.push(Y(P(['Мат! Победа твоя!', 'Мат! Красивый финал!']), 'Мат. Соперник довёл дело до конца.'));
  } else if (r.mateAfter > 0 && !BAD.has(r.cls) && r.cls !== 'brilliant') {
    out.push(Y(`Теперь у тебя ${mateIn(r.mateAfter)}!`, `Теперь у соперника ${mateIn(r.mateAfter)}.`));
  } else if (r.mateAfter < 0 && !BAD.has(r.cls)) {
    out.push(Y(`Позиция и так проиграна: у соперника ${mateIn(-r.mateAfter)}.`, `У тебя ${mateIn(-r.mateAfter)}!`));
  }
  return out.filter(Boolean).join(' ');
}

/* ------------------------- Whole-game review ------------------------ */

const fenKey = (fen) => fen.split(' ').slice(0, 3).join(' ');

export function openingAt(openings, fen) {
  return openings ? openings[fenKey(fen)] || null : null;
}

/**
 * game: {startFen, moves:[chess.js verbose], fens:[...]}
 * pos:  analysed positions (fens.length entries)
 */
export function reviewGame(game, pos, openings) {
  const results = [];
  let inBook = !!openings && fenKey(game.startFen) === fenKey(START_FEN);
  let opening = null;
  game.moves.forEach((m, i) => {
    const key = fenKey(game.fens[i + 1]);
    const op = inBook && openings ? openings[key] : null;
    if (inBook && !op) inBook = false;
    if (op) opening = op;
    const r = reviewMove(pos[i], pos[i + 1], m, {
      ply: i,
      prevMove: game.moves[i - 1] || null,
      prevResult: results[i - 1] || null,
      book: !!op && i < 40,
      opening: op ? openingName(op) : null,
    });
    r.opening = opening ? openingName(opening) : null;
    results.push(r);
  });
  return { results, stats: gameStats(game, pos, results), opening: opening ? openingName(opening) : null, eco: opening ? opening[0] : null };
}

/* ----------------------------- Accuracy ----------------------------- */

export function moveAccuracy(loss) {
  const d = loss * 100;
  const a = 103.1668100711649 * Math.exp(-0.04354415386753951 * d) - 3.166924740191411 + 1;
  return Math.max(0, Math.min(100, d <= 0 ? 100 : a));
}

function std(xs) {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

const RATING_PTS = [[0, 100], [30, 300], [50, 600], [60, 850], [70, 1150], [75, 1350], [80, 1550], [85, 1800],
  [88, 1950], [90, 2100], [93, 2300], [95, 2450], [97, 2650], [98.5, 2800], [100, 3000]];
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
    const acc = r.cls === 'book' || r.cls === 'forced' ? 100 : moveAccuracy(r.loss);
    r.accuracy = acc;
    per[r.color].push({ acc, w: weights[i], i });
  });
  const accuracy = {};
  for (const c of ['w', 'b']) {
    const xs = per[c];
    if (!xs.length) { accuracy[c] = null; continue; }
    const wm = xs.reduce((a, x) => a + x.acc * x.w, 0) / xs.reduce((a, x) => a + x.w, 0);
    const hm = xs.length / xs.reduce((a, x) => a + 1 / Math.max(5, x.acc), 0);
    accuracy[c] = Math.round(((wm + hm) / 2) * 10) / 10;
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
};

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
    else if (a > o) parts.push(pick([`Сегодня точность на твоей стороне: ${fmtAcc(a)} против ${fmtAcc(o)}.`, `Хорошая работа! Твоя точность — ${fmtAcc(a)}, у соперника — ${fmtAcc(o)}.`], seed));
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
  if (review.opening) parts.push(`Дебют: <i>${review.opening}</i>.`);
  return parts.join(' ');
}
const fmtAcc = (a) => `${a.toFixed(1).replace('.', ',')}%`;
