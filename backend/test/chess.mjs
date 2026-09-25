// Rules-engine checks, plus a guard that the mobile copy is byte-identical to
// the server copy (the server is authoritative; the app uses it for hints).
import { readFileSync } from 'node:fs';
import { createGame, legalMoves, makeMove, replay, gameStatus } from '../src/lib/chess.js';

let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${JSON.stringify(d)}`); } };

function perft(state, depth) {
  if (depth === 0) return 1;
  let n = 0;
  for (const m of legalMoves(state)) n += perft(makeMove(state, { from: m.from, to: m.to, promotion: m.promotion }), depth - 1);
  return n;
}

check('20 opening moves', legalMoves(createGame()).length === 20);
check('perft(3) = 8902', perft(createGame(), 3) === 8902);
check('perft(4) = 197281', perft(createGame(), 4) === 197281);
const mv = (s) => s.split(' ').map((x) => ({ from: x.slice(0, 2), to: x.slice(2, 4), promotion: x[4] }));
check("fool's mate", gameStatus(replay(mv('f2f3 e7e5 g2g4 d8h4'))) === 'checkmate');
const ep = replay(mv('e2e4 a7a6 e4e5 d7d5 e5d6'));
check('en passant removes the pawn', ep.board[35] === null && ep.board[43] === 'P');
const castle = replay(mv('e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 e1g1'));
check('king-side castling moves the rook', castle.board[6] === 'K' && castle.board[5] === 'R');
check('cannot castle through check', makeMove(replay(mv('e2e4 e7e5 g1f3 d8h4 f1c4 h4f2')), { from: 'e1', to: 'g1' }) === null);
const promo = replay(mv('a2a4 b7b5 a4b5 a7a6 b5a6 c8b7 a6b7 h7h6 b7a8n'));
check('under-promotion to knight', promo.board[56] === 'N');
check('threefold repetition is a draw', gameStatus(replay(mv('g1f3 g8f6 f3g1 f6g8 g1f3 g8f6 f3g1 f6g8'))) === 'draw');
check('illegal replay throws', (() => { try { replay(mv('e2e5')); return false; } catch { return true; } })());

const server = readFileSync(new URL('../src/lib/chess.js', import.meta.url), 'utf8');
const mobile = readFileSync(new URL('../../mobile/lib/chess.js', import.meta.url), 'utf8');
check('mobile/lib/chess.js is identical to the server engine', server === mobile);

console.log(`\nCHESS RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
process.exit(fails.length ? 1 : 0);
