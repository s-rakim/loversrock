// Tic Tac Toe. The smallest complete ruleset in the app, and the one the
// match layer was proved against end to end.
import { IllegalMove, clone, other } from './shared.js';

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],   // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8],   // columns
  [0, 4, 8], [2, 4, 6],              // diagonals
];

function winnerOf(board) {
  for (const [a, b, c] of LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { seat: board[a], line: [a, b, c] };
    }
  }
  return null;
}

export default {
  title: 'Tic Tac Toe',

  create() {
    return { board: Array(9).fill(null), winningLine: null };
  },

  apply(state, move, seat) {
    const cell = Number(move?.cell);
    if (!Number.isInteger(cell) || cell < 0 || cell > 8) {
      throw new IllegalMove('cell must be 0-8');
    }
    if (state.board[cell] !== null) {
      throw new IllegalMove('that square is already taken');
    }

    const next = clone(state);
    next.board[cell] = seat;

    const win = winnerOf(next.board);
    if (win) {
      next.winningLine = win.line;
      return { state: next, result: win.seat === 1 ? 'player1' : 'player2', nextSeat: null };
    }
    if (next.board.every((c) => c !== null)) {
      return { state: next, result: 'draw', nextSeat: null };
    }
    return { state: next, result: null, nextSeat: other(seat) };
  },

  // Nothing is hidden — both players look at the same board.
  redactFor(state) {
    return state;
  },
};
