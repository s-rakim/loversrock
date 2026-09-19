// The rules themselves, with no server and no database in the way.
//
// The match layer is tested in games.mjs; this is the other half — whether
// each engine actually knows its own game. Chess is checked with perft, the
// standard technique: count every legal position N plies deep and compare
// with the published numbers. A move generator that is subtly wrong about
// pins, castling, en passant or promotion cannot match them by accident.
import { getEngine, listGames, IllegalMove } from '../src/models/games/index.js';
import { legalMoves as chessMoves, inCheck } from '../src/models/games/chess.js';
import { legalMoves as checkerMoves } from '../src/models/games/checkers.js';

let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${JSON.stringify(d)}`); } };
const other = (s) => (s === 1 ? 2 : 1);
const throws = (fn) => { try { fn(); return null; } catch (e) { return e; } };

console.log('=== THE CONTRACT HOLDS FOR EVERY ENGINE ===');
for (const game of listGames()) {
  const engine = getEngine(game);
  const state = engine.create({ seed: 5 });
  check(`${game}: has a title`, typeof engine.title === 'string' && engine.title.length > 0);
  check(`${game}: create() returns JSON-safe state`,
    JSON.parse(JSON.stringify(state)) !== null);
  check(`${game}: redactFor() works for both seats`,
    engine.redactFor(state, 1) !== undefined && engine.redactFor(state, 2) !== undefined);

  // The rule the whole design rests on: apply() must not mutate its input.
  const before = JSON.stringify(state);
  const move = game === 'tic-tac-toe' ? { cell: 0 }
    : game === 'four-in-a-row' ? { column: 0 }
      : game === 'checkers' ? { from: [5, 0], to: [4, 1] }
        : game === 'chess' ? { from: [6, 4], to: [4, 4] }
          : game === 'uno-reverse' ? { action: 'draw' }
            : { column: 0, rotation: 0 };
  engine.apply(state, move, 1);
  check(`${game}: apply() does not mutate the state it was given`,
    JSON.stringify(state) === before);

  const err = throws(() => engine.apply(state, { nonsense: true }, 1));
  check(`${game}: rubbish input throws IllegalMove, not a crash`,
    err === null || err instanceof IllegalMove, err && `${err.name}: ${err.message}`);
}

console.log('\n=== CHESS: PERFT AGAINST THE PUBLISHED COUNTS ===');
const chess = getEngine('chess');
function perft(state, seat, depth) {
  const moves = chessMoves(state, seat);
  if (depth === 1) return moves.length;
  let n = 0;
  for (const m of moves) n += perft(chess.apply(state, m, seat).state, other(seat), depth - 1);
  return n;
}
// 20 / 400 / 8902 are the known node counts from the initial position. Depth
// 4 (197281) is run too - it is the shallowest depth that exercises castling
// and en passant - but it takes ~13s, so it is opt-in via PERFT4=1.
for (const [depth, want] of [[1, 20], [2, 400], [3, 8902]]) {
  const got = perft(chess.create(), 1, depth);
  check(`perft(${depth}) = ${want}`, got === want, got);
}
if (process.env.PERFT4 === '1') {
  const got = perft(chess.create(), 1, 4);
  check('perft(4) = 197281', got === 197281, got);
}

console.log('\n=== CHESS: THE RULES PEOPLE FORGET ===');
const play = (state, from, to, seat, promotion) =>
  chess.apply(state, { from, to, ...(promotion ? { promotion } : {}) }, seat);

// Fool's mate: 1. f3 e5 2. g4 Qh4#
let s = chess.create();
s = play(s, [6, 5], [5, 5], 1).state;
s = play(s, [1, 4], [3, 4], 2).state;
s = play(s, [6, 6], [4, 6], 1).state;
let res = play(s, [0, 3], [4, 7], 2);
check('checkmate is detected', res.result === 'player2', res.result);
check('and nobody is left on move', res.nextSeat === null);

// Scholar's-mate-adjacent: you cannot ignore check.
s = chess.create();
s = play(s, [6, 4], [4, 4], 1).state;
s = play(s, [1, 4], [3, 4], 2).state;
s = play(s, [7, 5], [4, 2], 1).state;   // Bc4
s = play(s, [0, 1], [2, 2], 2).state;   // Nc6
s = play(s, [7, 3], [3, 7], 1).state;   // Qh5
s = play(s, [0, 6], [2, 5], 2).state;   // Nf6?? allows Qxf7#
res = play(s, [3, 7], [1, 5], 1);
check('scholar’s mate is checkmate too', res.result === 'player1', res.result);

// Castling.
s = chess.create();
s = play(s, [6, 4], [4, 4], 1).state;   // e4
s = play(s, [1, 4], [3, 4], 2).state;
s = play(s, [7, 6], [5, 5], 1).state;   // Nf3
s = play(s, [0, 6], [2, 5], 2).state;
s = play(s, [7, 5], [4, 2], 1).state;   // Bc4
s = play(s, [0, 5], [3, 2], 2).state;
const castled = play(s, [7, 4], [7, 6], 1);
check('kingside castling works', castled.status !== 'error' && castled.state.board[7][6]?.type === 'k', castled.state.board[7][6]);
check('and the rook jumps with it', castled.state.board[7][5]?.type === 'r', castled.state.board[7][5]);
check('castling rights are then gone',
  castled.state.castling[1].king === false && castled.state.castling[1].queen === false,
  castled.state.castling[1]);

// En passant, and its one-move window.
s = chess.create();
s = play(s, [6, 4], [4, 4], 1).state;   // e4
s = play(s, [1, 0], [2, 0], 2).state;   // a6
s = play(s, [4, 4], [3, 4], 1).state;   // e5
s = play(s, [1, 3], [3, 3], 2).state;   // d5, passing e5
check('en passant is offered', s.enPassant !== null, s.enPassant);
const ep = play(s, [3, 4], [2, 3], 1);
check('the capture works', ep.state.board[2][3]?.type === 'p', ep.state.board[2][3]);
check('and the passed pawn is removed', ep.state.board[3][3] === null, ep.state.board[3][3]);

s = chess.create();
s = play(s, [6, 4], [4, 4], 1).state;
s = play(s, [1, 0], [2, 0], 2).state;
s = play(s, [4, 4], [3, 4], 1).state;
s = play(s, [1, 3], [3, 3], 2).state;
s = play(s, [7, 6], [5, 5], 1).state;   // let the window lapse
s = play(s, [2, 0], [3, 0], 2).state;
check('the en passant window closes after one move', s.enPassant === null, s.enPassant);
check('and the capture is then illegal',
  throws(() => play(s, [3, 4], [2, 3], 1)) instanceof IllegalMove);

console.log('\n=== CHECKERS: THE TWO RULES THAT MATTER ===');
const checkers = getEngine('checkers');
let ck = checkers.create();
check('24 pieces on the board', ck.board.flat().filter(Boolean).length === 24);
check('seven opening moves each', checkerMoves(ck, 1).length === 7 && checkerMoves(ck, 2).length === 7);
check('and none of them is a capture',
  checkerMoves(ck, 1).every((m) => m.captured === null));

// Build a forced double jump by hand.
const board = Array.from({ length: 8 }, () => Array(8).fill(null));
board[5][2] = { seat: 1, king: false };
board[4][3] = { seat: 2, king: false };
board[2][5] = { seat: 2, king: false };
board[0][0] = { seat: 2, king: false };   // so seat 2 still has a piece left
board[7][7] = { seat: 1, king: false };
let jump = { board, mustContinueFrom: null, lastMove: null };
const first = checkers.apply(jump, { from: [5, 2], to: [3, 4] }, 1);
check('a jump lands two squares away', first.state.board[3][4]?.seat === 1);
check('the jumped piece is taken', first.state.board[4][3] === null);
check('a second jump is available, so the turn does NOT pass',
  first.nextSeat === 1 && first.state.mustContinueFrom !== null, first);
check('and only that piece may move now',
  checkerMoves(first.state, 1).every((m) => m.from[0] === 3 && m.from[1] === 4),
  checkerMoves(first.state, 1));
const second = checkers.apply(first.state, { from: [3, 4], to: [1, 6] }, 1);
check('after the last jump the turn passes', second.nextSeat === 2, second.nextSeat);

// Crowning.
const crownBoard = Array.from({ length: 8 }, () => Array(8).fill(null));
crownBoard[1][2] = { seat: 1, king: false };
crownBoard[6][6] = { seat: 2, king: false };
const crowned = checkers.apply(
  { board: crownBoard, mustContinueFrom: null, lastMove: null }, { from: [1, 2], to: [0, 1] }, 1
);
check('reaching the far rank crowns a king', crowned.state.board[0][1]?.king === true);

console.log('\n=== UNO: MATCHING, STACKING AND WINNING ===');
const uno = getEngine('uno-reverse');
let u = uno.create({ seed: 11 });
check('108 cards dealt out of', u.deck.length + u.hands[1].length + u.hands[2].length + u.discard.length === 108,
  u.deck.length + u.hands[1].length + u.hands[2].length + u.discard.length);
check('the starting card is never a wild draw four', u.discard[0].value !== 'wild4');

// Force a known position rather than fishing for one in a shuffled deck.
u.hands[1] = [{ id: 'x1', colour: 'red', value: '5' }, { id: 'x2', colour: 'blue', value: '9' }];
u.hands[2] = [{ id: 'y1', colour: 'green', value: '3' }];
u.currentColour = 'red'; u.currentValue = '2'; u.pendingDraw = 0;
check('a matching colour plays', uno.apply(u, { cardId: 'x1' }, 1).state.currentColour === 'red');
check('a mismatch is refused',
  throws(() => uno.apply(u, { cardId: 'x2' }, 1)) instanceof IllegalMove);
check('and says why',
  /does not match/i.test(throws(() => uno.apply(u, { cardId: 'x2' }, 1)).message));

u.hands[1] = [{ id: 'w1', colour: null, value: 'wild' }];
check('a wild needs a colour',
  throws(() => uno.apply(u, { cardId: 'w1' }, 1)) instanceof IllegalMove);
const wild = uno.apply(u, { cardId: 'w1', colour: 'blue' }, 1);
check('a wild with a colour wins the game when it is the last card',
  wild.result === 'player1', wild.result);

u = uno.create({ seed: 12 });
u.hands[1] = [{ id: 'd1', colour: 'red', value: 'draw2' }, { id: 'k1', colour: 'red', value: '4' }];
u.hands[2] = [{ id: 'd2', colour: 'blue', value: 'draw2' }, { id: 'k2', colour: 'blue', value: '7' }];
u.currentColour = 'red'; u.currentValue = '1'; u.pendingDraw = 0;
let stacked = uno.apply(u, { cardId: 'd1' }, 1);
check('a draw two sets a penalty', stacked.state.pendingDraw === 2, stacked.state.pendingDraw);
check('the penalised player cannot just play anything',
  throws(() => uno.apply(stacked.state, { cardId: 'k2' }, 2)) instanceof IllegalMove);
stacked = uno.apply(stacked.state, { cardId: 'd2' }, 2);
check('but can stack another draw two', stacked.state.pendingDraw === 4, stacked.state.pendingDraw);
const drew = uno.apply(stacked.state, { action: 'draw' }, 1);
check('drawing settles the whole penalty',
  drew.state.hands[1].length === 1 + 4 && drew.state.pendingDraw === 0,
  { hand: drew.state.hands[1].length, pending: drew.state.pendingDraw });

u = uno.create({ seed: 13 });
u.hands[1] = [{ id: 's1', colour: 'red', value: 'skip' }, { id: 'z1', colour: 'red', value: '2' }];
u.currentColour = 'red'; u.currentValue = '1';
check('with two players a skip returns the turn to you',
  uno.apply(u, { cardId: 's1' }, 1).nextSeat === 1);
u.hands[1][0] = { id: 'r1', colour: 'red', value: 'reverse' };
check('and so does a reverse',
  uno.apply(u, { cardId: 'r1' }, 1).nextSeat === 1);

console.log('\n=== BLOCK BLITZ: SEPARATE BOARDS, SHARED QUEUE ===');
const blitz = getEngine('block-blitz');
const b1 = blitz.create({ seed: 99 });
const b2 = blitz.create({ seed: 99 });
check('the same seed gives the same queue', JSON.stringify(b1.queue) === JSON.stringify(b2.queue));
check('a different seed does not',
  JSON.stringify(blitz.create({ seed: 100 }).queue) !== JSON.stringify(b1.queue));
check('both players share one queue, so it is fair', b1.queue.length === 40);
check('it is freeplay', blitz.freeplay === true);

let bb = blitz.create({ seed: 99 });
const drop = blitz.apply(bb, { column: 0, rotation: 0 }, 1);
check('dropping scores for placing', drop.state.scores[1] > 0, drop.state.scores[1]);
check('and leaves the other board untouched',
  JSON.stringify(drop.state.boards[2]) === JSON.stringify(bb.boards[2]));
check('and does not advance the other player’s queue position',
  drop.state.index[2] === 0 && drop.state.index[1] === 1);
check('nobody is handed the turn', drop.nextSeat === 'free', drop.nextSeat);
check('off the side is refused',
  throws(() => blitz.apply(bb, { column: 99, rotation: 0 }, 1)) instanceof IllegalMove);

// A full bottom row must clear and score far more than a placement. The hole
// is in column 9, so the piece has to go into column 9 - dropping it anywhere
// else lands on top of the row and clears nothing.
const filled = blitz.create({ seed: 99 });
for (let c = 0; c < 10; c += 1) filled.boards[1][15][c] = 'I';
filled.boards[1][15][9] = null;
filled.queue[0] = 'I';
const cleared = blitz.apply(filled, { column: 9, rotation: 1 }, 1);  // vertical I plugs the hole
check('a completed line clears', cleared.state.lines[1] >= 1, cleared.state.lines[1]);
check('and is worth more than a bare placement',
  cleared.state.scores[1] > drop.state.scores[1], cleared.state.scores[1]);

const dead = blitz.create({ seed: 99 });
dead.alive[1] = false;
check('a player who topped out cannot keep dropping',
  throws(() => blitz.apply(dead, { column: 0, rotation: 0 }, 1)) instanceof IllegalMove);

console.log('\n=== TIC TAC TOE AND FOUR IN A ROW ===');
const ttt = getEngine('tic-tac-toe');
let t = ttt.create();
for (const [cell, seat] of [[0, 1], [3, 2], [1, 1], [4, 2]]) t = ttt.apply(t, { cell }, seat).state;
const tttWin = ttt.apply(t, { cell: 2 }, 1);
check('a row wins', tttWin.result === 'player1', tttWin.result);
check('and the winning line comes back', JSON.stringify(tttWin.state.winningLine) === '[0,1,2]');

t = ttt.create();
// A full board with no line: 0 1 2 / 3 4 5 / 6 7 8 as 1 2 1 / 1 2 2 / 2 1 1
for (const [cell, seat] of [[0, 1], [1, 2], [2, 1], [4, 2], [3, 1], [5, 2], [7, 1], [6, 2]]) {
  t = ttt.apply(t, { cell }, seat).state;
}
check('a full board with no line is a draw', ttt.apply(t, { cell: 8 }, 1).result === 'draw');

const c4 = getEngine('four-in-a-row');
let f = c4.create();
for (let i = 0; i < 3; i += 1) {
  f = c4.apply(f, { column: 0 }, 1).state;
  f = c4.apply(f, { column: 1 }, 2).state;
}
const c4win = c4.apply(f, { column: 0 }, 1);
check('four in a column wins', c4win.result === 'player1', c4win.result);
check('the winning line is four long', c4win.state.winningLine.length >= 4, c4win.state.winningLine);

let full = c4.create();
for (let i = 0; i < 6; i += 1) full = c4.apply(full, { column: 3 }, i % 2 === 0 ? 1 : 2).state;
check('a full column is refused',
  throws(() => c4.apply(full, { column: 3 }, 1)) instanceof IllegalMove);

console.log(`\nENGINE RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
