// Block Blitz — competitive block dropping, two boards, one piece queue.
//
// Every other game here is turn-based; this one is not, and forcing it to be
// would ruin it. Instead both players get the SAME deterministic piece
// sequence and their own board, and race. You place your piece whenever you
// like; you are never waiting on your partner. The engine advertises this
// with `freeplay`, and the match layer skips its turn check for it.
//
// That design is what makes it server-authoritative without frame sync: a
// move is "place piece N at column C with rotation R", which is a discrete,
// checkable fact, not a stream of gravity ticks.
//
// The match ends when both players have topped out, or when both have used
// the whole queue. Highest score wins.
import { IllegalMove, clone } from './shared.js';

const COLS = 10;
const ROWS = 16;
const QUEUE_LENGTH = 40;

// The seven tetrominoes, as filled cells per rotation. Written out rather
// than rotated at runtime so a rotation can never drift off by a cell.
const SHAPES = {
  I: [[[0, 0], [0, 1], [0, 2], [0, 3]], [[0, 0], [1, 0], [2, 0], [3, 0]]],
  O: [[[0, 0], [0, 1], [1, 0], [1, 1]]],
  T: [
    [[0, 1], [1, 0], [1, 1], [1, 2]],
    [[0, 0], [1, 0], [1, 1], [2, 0]],
    [[0, 0], [0, 1], [0, 2], [1, 1]],
    [[0, 1], [1, 0], [1, 1], [2, 1]],
  ],
  S: [[[0, 1], [0, 2], [1, 0], [1, 1]], [[0, 0], [1, 0], [1, 1], [2, 1]]],
  Z: [[[0, 0], [0, 1], [1, 1], [1, 2]], [[0, 1], [1, 0], [1, 1], [2, 0]]],
  J: [
    [[0, 0], [1, 0], [1, 1], [1, 2]],
    [[0, 0], [0, 1], [1, 0], [2, 0]],
    [[0, 0], [0, 1], [0, 2], [1, 2]],
    [[0, 1], [1, 1], [2, 0], [2, 1]],
  ],
  L: [
    [[0, 2], [1, 0], [1, 1], [1, 2]],
    [[0, 0], [1, 0], [2, 0], [2, 1]],
    [[0, 0], [0, 1], [0, 2], [1, 0]],
    [[0, 0], [0, 1], [1, 1], [2, 1]],
  ],
};
const PIECES = Object.keys(SHAPES);
// Line-clear scoring, 1-4 lines. Four at once is worth far more than four
// ones, which is the whole risk/reward of the game.
const LINE_SCORES = [0, 100, 300, 600, 1000];

const emptyBoard = () => Array.from({ length: ROWS }, () => Array(COLS).fill(null));

function makeQueue(seed) {
  let s = seed >>> 0 || 1;
  const next = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  return Array.from({ length: QUEUE_LENGTH }, () => PIECES[Math.floor(next() * PIECES.length)]);
}

const cellsFor = (piece, rotation) => {
  const rotations = SHAPES[piece];
  return rotations[((rotation % rotations.length) + rotations.length) % rotations.length];
};

/** Drops the piece down column `col` and returns the resting cells, or null. */
function resolveDrop(board, piece, rotation, col) {
  const cells = cellsFor(piece, rotation);
  const width = Math.max(...cells.map(([, c]) => c)) + 1;
  if (col < 0 || col + width > COLS) return null;

  let row = -Math.max(...cells.map(([r]) => r)) - 1;
  const fits = (atRow) => cells.every(([r, c]) => {
    const rr = atRow + r;
    const cc = col + c;
    if (cc < 0 || cc >= COLS) return false;
    if (rr >= ROWS) return false;
    return rr < 0 || board[rr][cc] === null;
  });

  // Fall until the next row down would collide.
  while (fits(row + 1)) row += 1;
  const resting = cells.map(([r, c]) => [row + r, col + c]);
  // Any cell still above the board means it topped out.
  if (resting.some(([r]) => r < 0)) return null;
  return resting;
}

function clearLines(board) {
  const kept = board.filter((row) => row.some((cell) => cell === null));
  const cleared = ROWS - kept.length;
  while (kept.length < ROWS) kept.unshift(Array(COLS).fill(null));
  return { board: kept, cleared };
}

export default {
  title: 'Block Blitz',
  // Either player may move at any time; there is no turn to wait for.
  freeplay: true,

  create({ seed = Date.now() } = {}) {
    return {
      queue: makeQueue(seed),
      boards: { 1: emptyBoard(), 2: emptyBoard() },
      index: { 1: 0, 2: 0 },
      scores: { 1: 0, 2: 0 },
      lines: { 1: 0, 2: 0 },
      alive: { 1: true, 2: true },
    };
  },

  apply(state, move, seat) {
    if (!state.alive[seat]) throw new IllegalMove('you have already topped out');

    const index = state.index[seat];
    if (index >= state.queue.length) throw new IllegalMove('you have used the whole queue');

    const col = Number(move?.column);
    const rotation = Number(move?.rotation ?? 0);
    if (!Number.isInteger(col)) throw new IllegalMove('column must be a whole number');
    if (!Number.isInteger(rotation)) throw new IllegalMove('rotation must be a whole number');

    const piece = state.queue[index];
    const next = clone(state);
    const resting = resolveDrop(next.boards[seat], piece, rotation, col);

    if (resting === null) {
      // Off the side is a bad request; topping out is a legal, losing move.
      const cells = cellsFor(piece, rotation);
      const width = Math.max(...cells.map(([, c]) => c)) + 1;
      if (col < 0 || col + width > COLS) {
        throw new IllegalMove(`that piece does not fit in column ${col}`);
      }
      next.alive[seat] = false;
      next.index[seat] = index + 1;
    } else {
      for (const [r, c] of resting) next.boards[seat][r][c] = piece;
      const { board, cleared } = clearLines(next.boards[seat]);
      next.boards[seat] = board;
      next.scores[seat] += LINE_SCORES[cleared] + 10; // 10 for placing at all
      next.lines[seat] += cleared;
      next.index[seat] = index + 1;
      if (next.index[seat] >= next.queue.length) next.alive[seat] = false;
    }

    const bothDone = !next.alive[1] && !next.alive[2];
    if (bothDone) {
      const [a, b] = [next.scores[1], next.scores[2]];
      return {
        state: next,
        result: a === b ? 'draw' : a > b ? 'player1' : 'player2',
        nextSeat: null,
      };
    }

    // Freeplay: nobody is handed the turn, both keep going.
    return { state: next, result: null, nextSeat: 'free' };
  },

  /**
   * The upcoming pieces are shared and public, but a player only needs the
   * next few — sending all forty every move is wasted bytes. The opponent's
   * board is visible on purpose: watching them build is half the fun.
   */
  redactFor(state, seat) {
    const opponent = seat === 1 ? 2 : 1;
    return {
      board: state.boards[seat],
      opponentBoard: state.boards[opponent],
      current: state.queue[state.index[seat]] || null,
      upNext: state.queue.slice(state.index[seat] + 1, state.index[seat] + 4),
      piecesLeft: state.queue.length - state.index[seat],
      score: state.scores[seat],
      opponentScore: state.scores[opponent],
      lines: state.lines[seat],
      opponentLines: state.lines[opponent],
      alive: state.alive[seat],
      opponentAlive: state.alive[opponent],
    };
  },
};
