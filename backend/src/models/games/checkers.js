// Checkers (English draughts) on an 8x8 board.
//
// The two rules that make checkers checkers, and that a naive implementation
// gets wrong, are both enforced here:
//
//   1. Captures are COMPULSORY. If any capture is available anywhere on the
//      board, a quiet move is illegal.
//   2. A multi-jump is one turn. After a capture, if the same piece can jump
//      again it must, and the turn does not pass until it cannot.
//
// A player with no legal move loses — that is a real checkers loss, not a
// stalemate, and it is how most games actually end when a side is stripped.
import { IllegalMove, clone, other } from './shared.js';

const SIZE = 8;
const MAN_DIRECTIONS = { 1: [[-1, -1], [-1, 1]], 2: [[1, -1], [1, 1]] };
const KING_DIRECTIONS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

const inBounds = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;
const isDark = (r, c) => (r + c) % 2 === 1;

/** Seat 2 starts at the top (rows 0-2), seat 1 at the bottom (rows 5-7). */
function startingBoard() {
  const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  for (let r = 0; r < SIZE; r += 1) {
    for (let c = 0; c < SIZE; c += 1) {
      if (!isDark(r, c)) continue;
      if (r < 3) board[r][c] = { seat: 2, king: false };
      else if (r > 4) board[r][c] = { seat: 1, king: false };
    }
  }
  return board;
}

const directionsFor = (piece) => (piece.king ? KING_DIRECTIONS : MAN_DIRECTIONS[piece.seat]);

/** Every jump this one piece can make from where it stands. */
function jumpsFrom(board, r, c) {
  const piece = board[r][c];
  if (!piece) return [];
  const moves = [];
  for (const [dr, dc] of directionsFor(piece)) {
    const midR = r + dr;
    const midC = c + dc;
    const toR = r + dr * 2;
    const toC = c + dc * 2;
    if (!inBounds(toR, toC)) continue;
    const victim = board[midR]?.[midC];
    if (!victim || victim.seat === piece.seat) continue;
    if (board[toR][toC] !== null) continue;
    moves.push({ from: [r, c], to: [toR, toC], captured: [midR, midC] });
  }
  return moves;
}

function quietMovesFrom(board, r, c) {
  const piece = board[r][c];
  if (!piece) return [];
  const moves = [];
  for (const [dr, dc] of directionsFor(piece)) {
    const toR = r + dr;
    const toC = c + dc;
    if (inBounds(toR, toC) && board[toR][toC] === null) {
      moves.push({ from: [r, c], to: [toR, toC], captured: null });
    }
  }
  return moves;
}

/**
 * Every legal move for `seat`, captures first. When a capture exists anywhere
 * the quiet moves are not returned at all — that is rule 1, enforced in the
 * one place that generates moves rather than checked after the fact.
 */
export function legalMoves(state, seat) {
  const { board, mustContinueFrom } = state;

  // Mid multi-jump: only the jumping piece may move, and only by jumping.
  if (mustContinueFrom) {
    const [r, c] = mustContinueFrom;
    return jumpsFrom(board, r, c);
  }

  const jumps = [];
  const quiet = [];
  for (let r = 0; r < SIZE; r += 1) {
    for (let c = 0; c < SIZE; c += 1) {
      const piece = board[r][c];
      if (!piece || piece.seat !== seat) continue;
      jumps.push(...jumpsFrom(board, r, c));
      quiet.push(...quietMovesFrom(board, r, c));
    }
  }
  return jumps.length > 0 ? jumps : quiet;
}

const sameSquare = (a, b) => a[0] === b[0] && a[1] === b[1];

export default {
  title: 'Checkers',

  create() {
    return { board: startingBoard(), mustContinueFrom: null, lastMove: null };
  },

  apply(state, move, seat) {
    const from = move?.from;
    const to = move?.to;
    if (!Array.isArray(from) || !Array.isArray(to) || from.length !== 2 || to.length !== 2) {
      throw new IllegalMove('move needs from:[r,c] and to:[r,c]');
    }

    const piece = state.board[from[0]]?.[from[1]];
    if (!piece) throw new IllegalMove('no piece there');
    if (piece.seat !== seat) throw new IllegalMove('that is not your piece');

    const legal = legalMoves(state, seat);
    const chosen = legal.find((m) => sameSquare(m.from, from) && sameSquare(m.to, to));
    if (!chosen) {
      // Say *why*, because "illegal move" on a compulsory capture is the most
      // confusing message in checkers.
      const captureAvailable = legal.some((m) => m.captured);
      throw new IllegalMove(
        captureAvailable ? 'you must take the capture that is available' : 'that move is not legal'
      );
    }

    const next = clone(state);
    next.board[from[0]][from[1]] = null;
    if (chosen.captured) next.board[chosen.captured[0]][chosen.captured[1]] = null;

    const moved = { ...piece };
    // Crowning ends the turn even mid-jump — standard English draughts.
    const crownRow = seat === 1 ? 0 : SIZE - 1;
    const crownedNow = !moved.king && to[0] === crownRow;
    if (crownedNow) moved.king = true;
    next.board[to[0]][to[1]] = moved;
    next.lastMove = { from, to, captured: chosen.captured };

    // Rule 2: same piece, more jumps available, same turn.
    if (chosen.captured && !crownedNow) {
      const more = jumpsFrom(next.board, to[0], to[1]);
      if (more.length > 0) {
        next.mustContinueFrom = to;
        return { state: next, result: null, nextSeat: seat };
      }
    }
    next.mustContinueFrom = null;

    const opponent = other(seat);
    const opponentPieces = next.board.flat().filter((p) => p && p.seat === opponent).length;
    const opponentMoves = legalMoves(next, opponent);
    if (opponentPieces === 0 || opponentMoves.length === 0) {
      return { state: next, result: seat === 1 ? 'player1' : 'player2', nextSeat: null };
    }

    return { state: next, result: null, nextSeat: opponent };
  },

  redactFor(state) {
    return state;
  },
};
