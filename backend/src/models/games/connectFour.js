// Four in a Row, as a real two-device game.
//
// The original screen kept the board in useState and flipped between P1 and
// P2 on one phone. The rules were already right; they just had nowhere to
// live. This is that win-checker moved server-side, where the board is the
// server's and a phone cannot claim a turn that is not its own.
import { IllegalMove, clone, other } from './shared.js';

const ROWS = 6;
const COLS = 7;
const DIRECTIONS = [[0, 1], [1, 0], [1, 1], [1, -1]];

function emptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

/** The four-in-a-row through (r,c), or null. */
function winningLineAt(board, r, c) {
  const seat = board[r][c];
  if (!seat) return null;

  for (const [dr, dc] of DIRECTIONS) {
    const line = [[r, c]];
    // Walk both ways from the landing square, so a disc dropped into the
    // middle of a run still counts.
    for (const sign of [1, -1]) {
      let rr = r + dr * sign;
      let cc = c + dc * sign;
      while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && board[rr][cc] === seat) {
        line.push([rr, cc]);
        rr += dr * sign;
        cc += dc * sign;
      }
    }
    if (line.length >= 4) return line;
  }
  return null;
}

export default {
  title: 'Four in a Row',

  create() {
    return { board: emptyBoard(), winningLine: null, lastDrop: null };
  },

  apply(state, move, seat) {
    const col = Number(move?.column);
    if (!Number.isInteger(col) || col < 0 || col >= COLS) {
      throw new IllegalMove(`column must be 0-${COLS - 1}`);
    }

    const next = clone(state);
    // Gravity: find the lowest empty cell in the column.
    let landed = -1;
    for (let r = ROWS - 1; r >= 0; r -= 1) {
      if (next.board[r][col] === null) { landed = r; break; }
    }
    if (landed === -1) throw new IllegalMove('that column is full');

    next.board[landed][col] = seat;
    next.lastDrop = [landed, col];

    const line = winningLineAt(next.board, landed, col);
    if (line) {
      next.winningLine = line;
      return { state: next, result: seat === 1 ? 'player1' : 'player2', nextSeat: null };
    }
    if (next.board[0].every((c) => c !== null)) {
      return { state: next, result: 'draw', nextSeat: null };
    }
    return { state: next, result: null, nextSeat: other(seat) };
  },

  redactFor(state) {
    return state;
  },
};
