// Chess, with the full ruleset.
//
// "Legal" here means legal, not pseudo-legal: every candidate move is played
// on a scratch board and discarded if it leaves the mover's own king attacked.
// That single filter is what gives pins, check evasion, checkmate and
// stalemate for free, instead of each being special-cased.
//
// Also implemented, because a chess board that gets these wrong is not a
// chess board: castling (both sides, with the empty/safe-square conditions),
// en passant (including the one-move window), promotion, the fifty-move rule
// and threefold repetition.
//
// Seat 1 is white and moves first, on rows 6-7. Seat 2 is black, rows 0-1.
import { IllegalMove, clone, other } from './shared.js';

const SIZE = 8;
const inBounds = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;

const KNIGHT_STEPS = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING_STEPS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const ROOK_RAYS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const BISHOP_RAYS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

const BACK_RANK = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];

function startingBoard() {
  const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  for (let c = 0; c < SIZE; c += 1) {
    board[0][c] = { seat: 2, type: BACK_RANK[c] };
    board[1][c] = { seat: 2, type: 'p' };
    board[6][c] = { seat: 1, type: 'p' };
    board[7][c] = { seat: 1, type: BACK_RANK[c] };
  }
  return board;
}

/** Pawns move up the board for seat 1, down for seat 2. */
const forward = (seat) => (seat === 1 ? -1 : 1);
const homeRank = (seat) => (seat === 1 ? 6 : 1);
const promotionRank = (seat) => (seat === 1 ? 0 : 7);

function findKing(board, seat) {
  for (let r = 0; r < SIZE; r += 1) {
    for (let c = 0; c < SIZE; c += 1) {
      const piece = board[r][c];
      if (piece && piece.seat === seat && piece.type === 'k') return [r, c];
    }
  }
  return null;
}

/**
 * Is (r,c) attacked by `bySeat`?
 *
 * Deliberately does NOT go through move generation — that would recurse,
 * since castling legality asks about attacked squares. It reads outwards
 * from the target square instead, which is also markedly faster.
 */
export function isAttacked(board, r, c, bySeat) {
  // Pawns attack diagonally forward, so look backwards from the target.
  const pawnRow = r - forward(bySeat);
  for (const dc of [-1, 1]) {
    const piece = board[pawnRow]?.[c + dc];
    if (piece && piece.seat === bySeat && piece.type === 'p') return true;
  }

  for (const [dr, dc] of KNIGHT_STEPS) {
    const piece = board[r + dr]?.[c + dc];
    if (piece && piece.seat === bySeat && piece.type === 'n') return true;
  }

  for (const [dr, dc] of KING_STEPS) {
    const piece = board[r + dr]?.[c + dc];
    if (piece && piece.seat === bySeat && piece.type === 'k') return true;
  }

  const slide = (rays, types) => {
    for (const [dr, dc] of rays) {
      let rr = r + dr;
      let cc = c + dc;
      while (inBounds(rr, cc)) {
        const piece = board[rr][cc];
        if (piece) {
          if (piece.seat === bySeat && types.includes(piece.type)) return true;
          break; // anything else blocks the ray
        }
        rr += dr;
        cc += dc;
      }
    }
    return false;
  };

  return slide(ROOK_RAYS, ['r', 'q']) || slide(BISHOP_RAYS, ['b', 'q']);
}

export function inCheck(board, seat) {
  const king = findKing(board, seat);
  return king ? isAttacked(board, king[0], king[1], other(seat)) : false;
}

/** Moves ignoring whether they expose the mover's own king. */
function pseudoMoves(state, seat) {
  const { board, castling, enPassant } = state;
  const moves = [];
  const push = (from, to, extra = {}) => moves.push({ from, to, ...extra });

  for (let r = 0; r < SIZE; r += 1) {
    for (let c = 0; c < SIZE; c += 1) {
      const piece = board[r][c];
      if (!piece || piece.seat !== seat) continue;

      if (piece.type === 'p') {
        const dr = forward(seat);
        const oneR = r + dr;
        if (inBounds(oneR, c) && !board[oneR][c]) {
          if (oneR === promotionRank(seat)) {
            for (const promo of ['q', 'r', 'b', 'n']) push([r, c], [oneR, c], { promotion: promo });
          } else {
            push([r, c], [oneR, c]);
            // The two-square jump is only from the home rank, and only if
            // both squares are clear.
            const twoR = r + dr * 2;
            if (r === homeRank(seat) && !board[twoR][c]) {
              push([r, c], [twoR, c], { doubleStep: true });
            }
          }
        }
        for (const dc of [-1, 1]) {
          const cc = c + dc;
          if (!inBounds(oneR, cc)) continue;
          const target = board[oneR][cc];
          if (target && target.seat !== seat) {
            if (oneR === promotionRank(seat)) {
              for (const promo of ['q', 'r', 'b', 'n']) push([r, c], [oneR, cc], { promotion: promo });
            } else {
              push([r, c], [oneR, cc]);
            }
          } else if (!target && enPassant && enPassant[0] === oneR && enPassant[1] === cc) {
            push([r, c], [oneR, cc], { enPassant: true });
          }
        }
        continue;
      }

      if (piece.type === 'n' || piece.type === 'k') {
        const steps = piece.type === 'n' ? KNIGHT_STEPS : KING_STEPS;
        for (const [dr, dc] of steps) {
          const rr = r + dr;
          const cc = c + dc;
          if (!inBounds(rr, cc)) continue;
          const target = board[rr][cc];
          if (!target || target.seat !== seat) push([r, c], [rr, cc]);
        }

        if (piece.type === 'k') {
          const rights = castling[seat] || { king: false, queen: false };
          const rank = seat === 1 ? 7 : 0;
          // Castling is illegal out of, through, or into check — and the
          // king must not have moved, which `rights` tracks.
          if (rights.king
            && !board[rank][5] && !board[rank][6]
            && !isAttacked(board, rank, 4, other(seat))
            && !isAttacked(board, rank, 5, other(seat))
            && !isAttacked(board, rank, 6, other(seat))) {
            push([r, c], [rank, 6], { castle: 'king' });
          }
          if (rights.queen
            && !board[rank][1] && !board[rank][2] && !board[rank][3]
            && !isAttacked(board, rank, 4, other(seat))
            && !isAttacked(board, rank, 3, other(seat))
            && !isAttacked(board, rank, 2, other(seat))) {
            push([r, c], [rank, 2], { castle: 'queen' });
          }
        }
        continue;
      }

      const rays = piece.type === 'r' ? ROOK_RAYS
        : piece.type === 'b' ? BISHOP_RAYS
          : [...ROOK_RAYS, ...BISHOP_RAYS]; // queen
      for (const [dr, dc] of rays) {
        let rr = r + dr;
        let cc = c + dc;
        while (inBounds(rr, cc)) {
          const target = board[rr][cc];
          if (!target) {
            push([r, c], [rr, cc]);
          } else {
            if (target.seat !== seat) push([r, c], [rr, cc]);
            break;
          }
          rr += dr;
          cc += dc;
        }
      }
    }
  }
  return moves;
}

/** Plays `move` on a copy and returns the new state. No legality checking. */
function makeMove(state, move, seat) {
  const next = clone(state);
  const [fr, fc] = move.from;
  const [tr, tc] = move.to;
  const piece = next.board[fr][fc];

  const captured = next.board[tr][tc];
  next.board[fr][fc] = null;
  next.board[tr][tc] = move.promotion ? { seat, type: move.promotion } : piece;

  if (move.enPassant) {
    // The captured pawn is beside the destination, not on it.
    next.board[tr - forward(seat)][tc] = null;
  }

  if (move.castle) {
    const rank = seat === 1 ? 7 : 0;
    const [rookFrom, rookTo] = move.castle === 'king' ? [7, 5] : [0, 3];
    next.board[rank][rookTo] = next.board[rank][rookFrom];
    next.board[rank][rookFrom] = null;
  }

  // Castling rights die when the king or a rook leaves its square — and when
  // a rook is captured on its home square, which is the case most
  // implementations forget.
  next.castling = clone(state.castling);
  if (piece.type === 'k') next.castling[seat] = { king: false, queen: false };
  if (piece.type === 'r') {
    const rank = seat === 1 ? 7 : 0;
    if (fr === rank && fc === 0) next.castling[seat].queen = false;
    if (fr === rank && fc === 7) next.castling[seat].king = false;
  }
  const oppRank = seat === 1 ? 0 : 7;
  if (captured && captured.type === 'r' && tr === oppRank) {
    if (tc === 0) next.castling[other(seat)].queen = false;
    if (tc === 7) next.castling[other(seat)].king = false;
  }

  // En passant is available for exactly one ply.
  next.enPassant = move.doubleStep ? [fr + forward(seat), fc] : null;

  // Fifty-move rule counts halfmoves since the last capture or pawn move.
  next.halfmoveClock = (piece.type === 'p' || captured || move.enPassant)
    ? 0
    : (state.halfmoveClock || 0) + 1;

  next.lastMove = { from: move.from, to: move.to };
  return next;
}

/** Fully legal moves: pseudo-legal, minus anything that leaves you in check. */
export function legalMoves(state, seat) {
  return pseudoMoves(state, seat).filter((move) => !inCheck(makeMove(state, move, seat).board, seat));
}

/** Position key for repetition detection — board, side to move, rights, ep. */
function positionKey(state, seat) {
  const board = state.board
    .map((row) => row.map((p) => (p ? `${p.seat}${p.type}` : '.')).join(''))
    .join('/');
  const rights = [1, 2]
    .map((s) => `${state.castling[s].king ? 'k' : ''}${state.castling[s].queen ? 'q' : ''}`)
    .join('|');
  return `${board} ${seat} ${rights} ${state.enPassant ? state.enPassant.join(',') : '-'}`;
}

/** Neither side has enough material to force mate — a draw, not a stalemate. */
function insufficientMaterial(board) {
  const pieces = board.flat().filter(Boolean);
  if (pieces.some((p) => ['p', 'r', 'q'].includes(p.type))) return false;
  const minors = pieces.filter((p) => p.type === 'b' || p.type === 'n');
  return minors.length <= 1;
}

export default {
  title: 'Chess',

  create() {
    return {
      board: startingBoard(),
      castling: { 1: { king: true, queen: true }, 2: { king: true, queen: true } },
      enPassant: null,
      halfmoveClock: 0,
      lastMove: null,
      check: false,
      // Keyed by position, counting occurrences, for threefold repetition.
      repetition: {},
    };
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
    const matches = legal.filter(
      (m) => m.from[0] === from[0] && m.from[1] === from[1]
        && m.to[0] === to[0] && m.to[1] === to[1]
    );
    if (matches.length === 0) {
      throw new IllegalMove(
        inCheck(state.board, seat) ? 'you must get out of check' : 'that move is not legal'
      );
    }
    // A pawn reaching the back rank produces four candidates, one per piece.
    const chosen = matches.length === 1
      ? matches[0]
      : matches.find((m) => m.promotion === (move.promotion || 'q'));
    if (!chosen) throw new IllegalMove('promotion must be one of q, r, b, n');

    const next = makeMove(state, chosen, seat);
    const opponent = other(seat);

    const key = positionKey(next, opponent);
    next.repetition = { ...state.repetition, [key]: (state.repetition?.[key] || 0) + 1 };

    const opponentInCheck = inCheck(next.board, opponent);
    next.check = opponentInCheck;

    if (legalMoves(next, opponent).length === 0) {
      // No legal reply: checkmate if in check, stalemate if not.
      return {
        state: next,
        result: opponentInCheck ? (seat === 1 ? 'player1' : 'player2') : 'draw',
        nextSeat: null,
      };
    }
    if (next.halfmoveClock >= 100) return { state: next, result: 'draw', nextSeat: null };
    if (next.repetition[key] >= 3) return { state: next, result: 'draw', nextSeat: null };
    if (insufficientMaterial(next.board)) return { state: next, result: 'draw', nextSeat: null };

    return { state: next, result: null, nextSeat: opponent };
  },

  /**
   * The legal moves for one seat, so the board can highlight destinations
   * without a second chess engine on the phone. Two implementations of the
   * rules would eventually disagree, and the one on the phone would be the
   * one nobody could fix without a new build.
   */
  legalMovesFor(state, seat) {
    return legalMoves(state, seat);
  },

  redactFor(state) {
    return state;
  },
};
