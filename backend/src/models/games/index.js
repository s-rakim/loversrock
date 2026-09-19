// The game engine registry.
//
// Every two-player game in the app is one of these. The contract is small on
// purpose, because the routes and the socket layer are written once against
// it and never need to know which game they are moving:
//
//   create()                -> the opening state
//   apply(state, move, seat) -> { state, result, nextSeat } or throws IllegalMove
//   redactFor(state, seat)   -> what THIS player is allowed to see
//
// `seat` is 1 or 2, never a user id — an engine has no idea who is playing,
// which keeps the rules honest and makes every engine testable on its own.
//
// apply() must be pure and total: given the same state and move it returns
// the same thing, and it either returns a new state or throws. It must never
// mutate the state it was handed, because the caller still needs the old one
// if the move turns out to be illegal.
//
// redactFor() exists for hidden-information games. Uno's state holds both
// hands; the API must never hand player 1 player 2's cards. Games with no
// hidden state return it unchanged. It is applied on the way out of *every*
// endpoint and every socket push — there is no path that skips it.

import ticTacToe from './ticTacToe.js';
import connectFour from './connectFour.js';
import checkers from './checkers.js';
import chess from './chess.js';
import unoReverse from './unoReverse.js';
import blockBlitz from './blockBlitz.js';

const ENGINES = {
  'tic-tac-toe': ticTacToe,
  'four-in-a-row': connectFour,
  checkers,
  chess,
  'uno-reverse': unoReverse,
  'block-blitz': blockBlitz,
};

export function getEngine(game) {
  return ENGINES[game] || null;
}

export function listGames() {
  return Object.keys(ENGINES);
}

// Re-exported so callers have one import site, while the engines themselves
// import from shared.js directly to avoid a cycle back through this file.
export { IllegalMove, other, clone } from './shared.js';
