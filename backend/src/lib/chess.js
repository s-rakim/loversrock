// Minimal, dependency-free chess rules engine. The SAME file ships in
// backend/src/lib/chess.js (authoritative move validation) and
// mobile/lib/chess.js (board UI, legal-move hints) — test/chess.mjs fails if
// they ever drift apart. Edit one, copy it over the other.
//
// Board: 64-element array, index = rank * 8 + file, a1 = 0, h8 = 63.
// Pieces are FEN letters: uppercase white (PNBRQK), lowercase black.

const FILES = 'abcdefgh';

export function squareIndex(sq) {
  if (typeof sq !== 'string' || sq.length !== 2) return -1;
  const f = FILES.indexOf(sq[0]);
  const r = Number(sq[1]) - 1;
  if (f < 0 || !(r >= 0 && r < 8)) return -1;
  return r * 8 + f;
}

export function squareName(i) {
  return FILES[i % 8] + String(Math.floor(i / 8) + 1);
}

const isWhite = (p) => p && p === p.toUpperCase();
const colorOf = (p) => (p ? (isWhite(p) ? 'w' : 'b') : null);

export function createGame() {
  const back = 'RNBQKBNR';
  const board = new Array(64).fill(null);
  for (let f = 0; f < 8; f += 1) {
    board[f] = back[f];
    board[8 + f] = 'P';
    board[48 + f] = 'p';
    board[56 + f] = back[f].toLowerCase();
  }
  const state = {
    board,
    turn: 'w',
    castling: { K: true, Q: true, k: true, q: true },
    ep: null, // en-passant target square index
    halfmove: 0,
    fullmove: 1,
    positions: {},
  };
  state.positions[positionKey(state)] = 1;
  return state;
}

function positionKey(s) {
  return `${s.board.map((p) => p || '.').join('')}|${s.turn}|${Object.entries(s.castling).filter(([, v]) => v).map(([k]) => k).join('')}|${s.ep ?? '-'}`;
}

function clone(s) {
  return { ...s, board: [...s.board], castling: { ...s.castling }, positions: { ...s.positions } };
}

const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ROOK = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

function onBoard(f, r) {
  return f >= 0 && f < 8 && r >= 0 && r < 8;
}

/** Is square `idx` attacked by any piece of colour `by`? */
export function isAttacked(board, idx, by) {
  const f = idx % 8;
  const r = Math.floor(idx / 8);
  const own = (p, letter) => p && colorOf(p) === by && p.toLowerCase() === letter;

  const pawnDir = by === 'w' ? -1 : 1; // attacking pawn sits one rank "behind"
  for (const df of [-1, 1]) {
    const pf = f + df;
    const pr = r + pawnDir;
    if (onBoard(pf, pr) && own(board[pr * 8 + pf], 'p')) return true;
  }
  for (const [df, dr] of KNIGHT) {
    if (onBoard(f + df, r + dr) && own(board[(r + dr) * 8 + f + df], 'n')) return true;
  }
  for (const [df, dr] of KING) {
    if (onBoard(f + df, r + dr) && own(board[(r + dr) * 8 + f + df], 'k')) return true;
  }
  const slide = (dirs, letters) => {
    for (const [df, dr] of dirs) {
      let cf = f + df;
      let cr = r + dr;
      while (onBoard(cf, cr)) {
        const p = board[cr * 8 + cf];
        if (p) {
          if (colorOf(p) === by && letters.includes(p.toLowerCase())) return true;
          break;
        }
        cf += df;
        cr += dr;
      }
    }
    return false;
  };
  return slide(ROOK, 'rq') || slide(BISHOP, 'bq');
}

export function inCheck(state, color = state.turn) {
  const king = state.board.findIndex((p) => p === (color === 'w' ? 'K' : 'k'));
  return king >= 0 && isAttacked(state.board, king, color === 'w' ? 'b' : 'w');
}

function pseudoMoves(state) {
  const { board, turn } = state;
  const moves = [];
  const enemy = turn === 'w' ? 'b' : 'w';

  for (let i = 0; i < 64; i += 1) {
    const p = board[i];
    if (!p || colorOf(p) !== turn) continue;
    const f = i % 8;
    const r = Math.floor(i / 8);
    const type = p.toLowerCase();
    const add = (to, extra = {}) => moves.push({ from: i, to, ...extra });

    if (type === 'p') {
      const dir = turn === 'w' ? 1 : -1;
      const startRank = turn === 'w' ? 1 : 6;
      const lastRank = turn === 'w' ? 7 : 0;
      const pushPawn = (to, extra = {}) => {
        if (Math.floor(to / 8) === lastRank) {
          for (const promo of ['q', 'r', 'b', 'n']) add(to, { ...extra, promotion: promo });
        } else add(to, extra);
      };
      const one = (r + dir) * 8 + f;
      if (onBoard(f, r + dir) && !board[one]) {
        pushPawn(one);
        const two = (r + 2 * dir) * 8 + f;
        if (r === startRank && !board[two]) add(two, { double: true });
      }
      for (const df of [-1, 1]) {
        if (!onBoard(f + df, r + dir)) continue;
        const to = (r + dir) * 8 + f + df;
        if (board[to] && colorOf(board[to]) === enemy) pushPawn(to, { capture: true });
        else if (state.ep === to) add(to, { capture: true, enPassant: true });
      }
    } else if (type === 'n' || type === 'k') {
      for (const [df, dr] of type === 'n' ? KNIGHT : KING) {
        if (!onBoard(f + df, r + dr)) continue;
        const to = (r + dr) * 8 + f + df;
        if (!board[to]) add(to);
        else if (colorOf(board[to]) === enemy) add(to, { capture: true });
      }
      if (type === 'k') {
        const home = turn === 'w' ? 4 : 60;
        const [kSide, qSide] = turn === 'w' ? ['K', 'Q'] : ['k', 'q'];
        if (i === home && !isAttacked(board, home, enemy)) {
          if (state.castling[kSide] && !board[home + 1] && !board[home + 2] &&
              board[home + 3] === (turn === 'w' ? 'R' : 'r') &&
              !isAttacked(board, home + 1, enemy) && !isAttacked(board, home + 2, enemy)) {
            add(home + 2, { castle: 'k' });
          }
          if (state.castling[qSide] && !board[home - 1] && !board[home - 2] && !board[home - 3] &&
              board[home - 4] === (turn === 'w' ? 'R' : 'r') &&
              !isAttacked(board, home - 1, enemy) && !isAttacked(board, home - 2, enemy)) {
            add(home - 2, { castle: 'q' });
          }
        }
      }
    } else {
      const dirs = type === 'r' ? ROOK : type === 'b' ? BISHOP : [...ROOK, ...BISHOP];
      for (const [df, dr] of dirs) {
        let cf = f + df;
        let cr = r + dr;
        while (onBoard(cf, cr)) {
          const to = cr * 8 + cf;
          if (!board[to]) add(to);
          else {
            if (colorOf(board[to]) === enemy) add(to, { capture: true });
            break;
          }
          cf += df;
          cr += dr;
        }
      }
    }
  }
  return moves;
}

/** Applies a move without legality checks. Returns a new state. */
function applyRaw(state, m) {
  const s = clone(state);
  const b = s.board;
  const piece = b[m.from];
  const type = piece.toLowerCase();

  b[m.to] = m.promotion ? (s.turn === 'w' ? m.promotion.toUpperCase() : m.promotion.toLowerCase()) : piece;
  b[m.from] = null;
  if (m.enPassant) b[m.to + (s.turn === 'w' ? -8 : 8)] = null;
  if (m.castle === 'k') {
    b[m.to - 1] = b[m.to + 1];
    b[m.to + 1] = null;
  } else if (m.castle === 'q') {
    b[m.to + 1] = b[m.to - 2];
    b[m.to - 2] = null;
  }

  // Castling rights: lost when the king or a rook moves, or a rook is captured.
  if (type === 'k') {
    if (s.turn === 'w') { s.castling.K = false; s.castling.Q = false; } else { s.castling.k = false; s.castling.q = false; }
  }
  for (const [sq, right] of [[0, 'Q'], [7, 'K'], [56, 'q'], [63, 'k']]) {
    if (m.from === sq || m.to === sq) s.castling[right] = false;
  }

  s.ep = m.double ? (m.from + m.to) / 2 : null;
  s.halfmove = type === 'p' || m.capture ? 0 : s.halfmove + 1;
  if (s.turn === 'b') s.fullmove += 1;
  s.turn = s.turn === 'w' ? 'b' : 'w';
  return s;
}

export function legalMoves(state, fromSquare) {
  const from = fromSquare === undefined ? null : typeof fromSquare === 'number' ? fromSquare : squareIndex(fromSquare);
  return pseudoMoves(state)
    .filter((m) => from === null || m.from === from)
    .filter((m) => !inCheck(applyRaw(state, m), state.turn));
}

/**
 * Plays { from, to, promotion? } (squares as 'e2' or indices). Returns the new
 * state, or null if the move is illegal. Promotion defaults to a queen.
 */
export function makeMove(state, move) {
  const from = typeof move.from === 'number' ? move.from : squareIndex(move.from);
  const to = typeof move.to === 'number' ? move.to : squareIndex(move.to);
  const candidates = legalMoves(state, from).filter((m) => m.to === to);
  if (candidates.length === 0) return null;
  const chosen = candidates.find((m) => !m.promotion || m.promotion === (move.promotion || 'q').toLowerCase());
  if (!chosen) return null;

  const next = applyRaw(state, chosen);
  const key = positionKey(next);
  next.positions[key] = (next.positions[key] || 0) + 1;
  next.lastMove = { from: squareName(chosen.from), to: squareName(chosen.to), promotion: chosen.promotion || null };
  return next;
}

function insufficientMaterial(board) {
  const pieces = board.filter(Boolean).map((p) => p.toLowerCase()).filter((p) => p !== 'k');
  if (pieces.length === 0) return true;
  return pieces.length === 1 && (pieces[0] === 'b' || pieces[0] === 'n');
}

/** 'active' | 'checkmate' | 'stalemate' | 'draw' for the side to move. */
export function gameStatus(state) {
  const moves = legalMoves(state);
  if (moves.length === 0) return inCheck(state) ? 'checkmate' : 'stalemate';
  if (state.halfmove >= 100 || insufficientMaterial(state.board)) return 'draw';
  if (Object.values(state.positions).some((n) => n >= 3)) return 'draw';
  return 'active';
}

/** Replays a list of { from, to, promotion? } moves. Throws on an illegal one. */
export function replay(moves) {
  let state = createGame();
  moves.forEach((m, i) => {
    const next = makeMove(state, m);
    if (!next) throw new Error(`Illegal move #${i + 1}: ${m.from}-${m.to}`);
    state = next;
  });
  return state;
}
