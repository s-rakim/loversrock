// Exercises the multiplayer match layer against a live stack, with two real
// accounts playing each other — the only way to prove the things that matter
// here: that a phone cannot move out of turn, cannot move in a match it is
// not in, and cannot see the other player's Uno hand.
const API = 'http://localhost:4000';
const stamp = Date.now();
let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${JSON.stringify(d)}`); } };

async function req(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${API}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const signup = async (name) => {
  const u = { email: `game-${name}${stamp}@t.dev`, password: 'pw123456', name };
  const r = await req('/auth/signup', { method: 'POST', body: u });
  return { ...u, token: r.data.accessToken, id: r.data.user.id };
};

const A = await signup('Ana');
const B = await signup('Ben');
const C = await signup('Cal');          // a third party, never in the pair
const invite = await req('/auth/invite', { method: 'POST', token: A.token, body: { deviceTimezone: 'UTC' } });
await req('/auth/invite/accept', { method: 'POST', token: B.token, body: { inviteCode: invite.data.inviteCode, deviceTimezone: 'UTC' } });

const start = (game, token) => req(`/games/${game}/start`, { method: 'POST', token });
const move = (game, token, m, expectedMoveCount) =>
  req(`/games/${game}/move`, { method: 'POST', token, body: { move: m, expectedMoveCount } });

console.log('=== THE HUB LISTS EVERY GAME ===');
const hub = await req('/games/matches', { token: A.token });
check('hub responds', hub.status === 200, hub.data);
const slugs = (hub.data.games || []).map((g) => g.game);
for (const game of ['tic-tac-toe', 'four-in-a-row', 'checkers', 'chess', 'uno-reverse', 'block-blitz',
  'anagrams', 'what-you-saying', 'perfect-pair', 'love-letters', 'love-golf']) {
  check(`${game} is listed`, slugs.includes(game), slugs);
}
check('every game carries a win/draw/loss record',
  hub.data.games.every((g) => g.record && typeof g.record.wins === 'number'), hub.data.games[0]);
check('no match is running yet', hub.data.games.every((g) => g.active === null));

console.log('\n=== STARTING IS IDEMPOTENT, NOT DUPLICATING ===');
const s1 = await start('tic-tac-toe', A.token);
check('the starter creates the match', s1.status === 201 && s1.data.joined === false, s1.data);
check('the starter takes seat 1', s1.data.match.seat === 1, s1.data.match);
check('and moves first', s1.data.match.yourTurn === true, s1.data.match);

const s2 = await start('tic-tac-toe', B.token);
check('the partner joins the same match', s2.data.joined === true && s2.data.match.id === s1.data.match.id, s2.data);
check('the partner takes seat 2', s2.data.match.seat === 2, s2.data.match);
check('and is not on move', s2.data.match.yourTurn === false, s2.data.match);

const s3 = await start('tic-tac-toe', A.token);
check('starting again returns the same match, not a second one',
  s3.data.match.id === s1.data.match.id, s3.data);

console.log('\n=== TURN ORDER IS THE SERVER’S, NOT THE CLIENT’S ===');
const outOfTurn = await move('tic-tac-toe', B.token, { cell: 0 });
check('the player not on move is refused', outOfTurn.status === 409, outOfTurn);
check('and told why', /not your turn/i.test(outOfTurn.data.error || ''), outOfTurn.data);

const outsider = await move('tic-tac-toe', C.token, { cell: 0 });
check('someone outside the pair cannot move at all', outsider.status === 403, outsider);

const m1 = await move('tic-tac-toe', A.token, { cell: 4 });
check('the player on move succeeds', m1.status === 200, m1.data);
check('the turn passes', m1.data.match.yourTurn === false, m1.data.match);
check('move count advances', m1.data.match.moveCount === 1, m1.data.match);

const taken = await move('tic-tac-toe', B.token, { cell: 4 });
check('an occupied square is rejected', taken.status === 400, taken);
check('with the engine’s own message', /already taken/i.test(taken.data.error || ''), taken.data);
check('and a rejected move changes nothing',
  (await req('/games/tic-tac-toe/match', { token: A.token })).data.match.moveCount === 1);

const stale = await move('tic-tac-toe', B.token, { cell: 0 }, 0);
check('a move from a stale board is refused', stale.status === 409, stale);
check('and hands back the current board', stale.data.match?.moveCount === 1, stale.data);

console.log('\n=== A GAME PLAYS TO A REAL RESULT ===');
// A took 4. Play out to a win for A: 4, 0, 8 vs B on 1, 2.
await move('tic-tac-toe', B.token, { cell: 1 });
await move('tic-tac-toe', A.token, { cell: 0 });
await move('tic-tac-toe', B.token, { cell: 2 });
const win = await move('tic-tac-toe', A.token, { cell: 8 });
check('the winner is told they won', win.data.match.outcome === 'you', win.data.match);
check('the match is finished', win.data.match.status === 'finished', win.data.match);
check('nobody is on move any more', win.data.match.yourTurn === false, win.data.match);

const loserView = await req('/games/tic-tac-toe/match', { token: B.token });
check('a finished match is no longer the active one', loserView.data.match === null, loserView.data);

const tally = await req('/games/matches', { token: A.token });
const ttt = tally.data.games.find((g) => g.game === 'tic-tac-toe');
check('the winner’s record shows the win', ttt.record.wins === 1, ttt.record);
const tallyB = await req('/games/matches', { token: B.token });
check('the loser’s record shows the loss',
  tallyB.data.games.find((g) => g.game === 'tic-tac-toe').record.losses === 1);

console.log('\n=== A REMATCH IS A NEW MATCH ===');
const rematch = await start('tic-tac-toe', B.token);
check('a finished match does not block a rematch', rematch.status === 201, rematch.data);
check('the rematch is a different match', rematch.data.match.id !== s1.data.match.id);
check('and whoever started it moves first', rematch.data.match.seat === 1 && rematch.data.match.yourTurn === true);
await req('/games/tic-tac-toe/resign', { method: 'POST', token: B.token });

console.log('\n=== CHESS ENFORCES CHESS ===');
await start('chess', A.token);
await start('chess', B.token);
const pawnTooFar = await move('chess', A.token, { from: [6, 4], to: [3, 4] });
check('a pawn cannot move three squares', pawnTooFar.status === 400, pawnTooFar.data);
const e4 = await move('chess', A.token, { from: [6, 4], to: [4, 4] });
check('but two from the home rank is fine', e4.status === 200, e4.data);
const wrongPiece = await move('chess', B.token, { from: [6, 0], to: [5, 0] });
check('you cannot move your opponent’s piece', wrongPiece.status === 400, wrongPiece.data);
check('and are told so', /not your piece/i.test(wrongPiece.data.error || ''), wrongPiece.data);
await req('/games/chess/resign', { method: 'POST', token: A.token });
const resigned = await req('/games/matches', { token: B.token });
check('resigning counts as a loss for the resigner',
  resigned.data.games.find((g) => g.game === 'chess').record.wins === 1,
  resigned.data.games.find((g) => g.game === 'chess').record);

console.log('\n=== CHECKERS FORCES THE CAPTURE ===');
await start('checkers', A.token);
await start('checkers', B.token);
let ck = await move('checkers', A.token, { from: [5, 0], to: [4, 1] });
check('an opening move is legal', ck.status === 200, ck.data);
ck = await move('checkers', B.token, { from: [2, 3], to: [3, 2] });
check('and so is the reply', ck.status === 200, ck.data);
// A capture is now on the board for A; a quiet move must be refused.
const quiet = await move('checkers', A.token, { from: [5, 2], to: [4, 3] });
check('a quiet move is refused while a capture exists', quiet.status === 400, quiet.data);
check('with the reason spelled out',
  /must take the capture/i.test(quiet.data.error || ''), quiet.data);
const capture = await move('checkers', A.token, { from: [4, 1], to: [2, 3] });
check('the capture itself is legal', capture.status === 200, capture.data);
await req('/games/checkers/resign', { method: 'POST', token: A.token });

console.log('\n=== UNO NEVER SHOWS YOU THE OTHER HAND ===');
const uno = await start('uno-reverse', A.token);
await start('uno-reverse', B.token);
const aView = uno.data.match.state;
check('you get seven cards', aView.hand.length === 7, aView.hand?.length);
check('you are told how many they hold, not which', aView.opponentCardCount === 7, aView);
check('their hand is not in the payload', !('hands' in aView) && !('opponentHand' in aView), Object.keys(aView));
check('the deck order is not in the payload', !('deck' in aView), Object.keys(aView));
check('only a deck count', typeof aView.deckCount === 'number', aView.deckCount);

const bView = (await req('/games/uno-reverse/match', { token: B.token })).data.match.state;
const aCardIds = new Set(aView.hand.map((c) => c.id));
check('no card of theirs appears in your view',
  !bView.hand.some((c) => aCardIds.has(c.id)), { a: [...aCardIds], b: bView.hand.map((c) => c.id) });
check('the two views are genuinely different hands',
  JSON.stringify(aView.hand) !== JSON.stringify(bView.hand));
// The strongest form: not one of B's card ids appears as an id anywhere in
// A's state. Matched as a quoted token, not a substring - a bare
// includes('c9') also matches 'c92', which is legitimately A's own card, and
// reports a leak that is not there.
const aState = JSON.stringify(uno.data.match.state);
const leaked = bView.hand.filter((c) => aState.includes(`"${c.id}"`));
check('not one of their card ids appears anywhere in your state',
  leaked.length === 0, leaked.map((c) => c.id));
check('and the check is sharp enough to be worth making',
  aView.hand.every((c) => aState.includes(`"${c.id}"`)),
  'own cards should be present, or the assertion above proves nothing');

const notYours = await move('uno-reverse', A.token, { cardId: bView.hand[0].id });
check('you cannot play a card you do not hold', notYours.status === 400, notYours.data);
check('and the error does not confirm it exists',
  /do not hold/i.test(notYours.data.error || ''), notYours.data);
await req('/games/uno-reverse/resign', { method: 'POST', token: A.token });

console.log('\n=== BLOCK BLITZ NEEDS NO TURN ===');
const bb = await start('block-blitz', A.token);
await start('block-blitz', B.token);
check('it is flagged as freeplay', bb.data.match.freeplay === true, bb.data.match);
check('both players are always "on move"', bb.data.match.yourTurn === true, bb.data.match);
const bbB = await req('/games/block-blitz/match', { token: B.token });
check('including the one who joined', bbB.data.match.yourTurn === true, bbB.data.match);

const dropA = await move('block-blitz', A.token, { column: 0, rotation: 0 });
check('either player can drop without waiting', dropA.status === 200, dropA.data);
const dropB = await move('block-blitz', B.token, { column: 0, rotation: 0 });
check('and so can the other, immediately after', dropB.status === 200, dropB.data);
check('each has their own board',
  JSON.stringify(dropA.data.match.state.board) !== JSON.stringify(dropA.data.match.state.opponentBoard)
  || dropA.data.match.state.score !== dropA.data.match.state.opponentScore,
  { mine: dropA.data.match.state.score, theirs: dropA.data.match.state.opponentScore });
check('you can watch their score', typeof dropA.data.match.state.opponentScore === 'number');
const offBoard = await move('block-blitz', A.token, { column: 99, rotation: 0 });
check('a piece off the edge is refused', offBoard.status === 400, offBoard.data);
await req('/games/block-blitz/resign', { method: 'POST', token: A.token });

console.log('\n=== FOUR IN A ROW IS NETWORKED NOW ===');
await start('four-in-a-row', A.token);
await start('four-in-a-row', B.token);
let fr;
for (const [token, col] of [[A.token, 0], [B.token, 1], [A.token, 0], [B.token, 1], [A.token, 0], [B.token, 1]]) {
  fr = await move('four-in-a-row', token, { column: col });
}
fr = await move('four-in-a-row', A.token, { column: 0 });
check('four in a column wins', fr.data.match.outcome === 'you', fr.data.match);
check('and the winning line is returned', Array.isArray(fr.data.match.state.winningLine), fr.data.match.state);

console.log('\n=== LEGAL MOVES COME FROM THE SERVER, FOR THE MOVER ONLY ===');
// The boards highlight destinations from this rather than running a second
// copy of the rules on the phone, so it has to be present, correct, and not
// handed to the player who is not on move.
await req('/games/chess/start', { method: 'POST', token: A.token });
await req('/games/chess/start', { method: 'POST', token: B.token });
const moverView = await req('/games/chess/match', { token: A.token });
const waiterView = await req('/games/chess/match', { token: B.token });
check('the player on move gets legal moves',
  Array.isArray(moverView.data.match.legalMoves), moverView.data.match.legalMoves);
check('and there are twenty of them at the start',
  moverView.data.match.legalMoves.length === 20, moverView.data.match.legalMoves?.length);
check('the player waiting gets none',
  waiterView.data.match.legalMoves === null, waiterView.data.match.legalMoves);

await req('/games/checkers/start', { method: 'POST', token: A.token });
const ckView = await req('/games/checkers/match', { token: A.token });
check('checkers offers its seven openings',
  ckView.data.match.legalMoves.length === 7, ckView.data.match.legalMoves?.length);
check('and none of them is a capture yet',
  ckView.data.match.legalMoves.every((mv) => mv.captured === null));
// Once a capture exists, the compulsory rule must show up HERE, because the
// board only offers what this list contains.
await req('/games/checkers/move', { method: 'POST', token: A.token, body: { move: { from: [5, 0], to: [4, 1] } } });
await req('/games/checkers/move', { method: 'POST', token: B.token, body: { move: { from: [2, 3], to: [3, 2] } } });
const forced = await req('/games/checkers/match', { token: A.token });
check('with a capture on the board only captures are offered',
  forced.data.match.legalMoves.every((mv) => mv.captured !== null),
  forced.data.match.legalMoves);
await req('/games/checkers/resign', { method: 'POST', token: A.token });
await req('/games/chess/resign', { method: 'POST', token: A.token });

check('a freeplay game offers no move list it cannot compute',
  (await req('/games/block-blitz/start', { method: 'POST', token: A.token })).data.match.legalMoves === null);
await req('/games/block-blitz/resign', { method: 'POST', token: A.token });

console.log('\n=== NOTHING IN THE ARCADE IS SOLO ANY MORE ===');
// The five that used to be single-player are races now. What has to hold
// for each: both players get identical content, neither waits for a turn,
// and one finishing does not end it for the other.
for (const game of ['anagrams', 'what-you-saying', 'perfect-pair', 'love-letters', 'love-golf']) {
  const mine = await start(game, A.token);
  const theirs = await start(game, B.token);
  check(`${game}: both join one match`,
    mine.data.match.id === theirs.data.match.id, { a: mine.data.match.id, b: theirs.data.match.id });
  check(`${game}: neither is made to wait for a turn`,
    mine.data.match.yourTurn === true && theirs.data.match.yourTurn === true,
    { a: mine.data.match.yourTurn, b: theirs.data.match.yourTurn });
  check(`${game}: it is flagged freeplay`, mine.data.match.freeplay === true);
  check(`${game}: each side sees its own score and theirs`,
    'score' in mine.data.match.state || 'total' in mine.data.match.state,
    Object.keys(mine.data.match.state));
}

const anA = (await req('/games/anagrams/match', { token: A.token })).data.match;
const anB = (await req('/games/anagrams/match', { token: B.token })).data.match;
check('anagrams: the same scramble on both phones',
  anA.state.scrambled === anB.state.scrambled, { a: anA.state.scrambled, b: anB.state.scrambled });
check('anagrams: the word list is not in the payload',
  !('words' in anA.state) && !('scrambles' in anA.state), Object.keys(anA.state));
const anaWrong = await move('anagrams', A.token, { guess: 'DEFINITELYWRONG' });
check('anagrams: a wrong guess is accepted but does not advance',
  anaWrong.status === 200 && anaWrong.data.match.state.round === 1, anaWrong.data.match?.state);
const anaSkip = await move('anagrams', A.token, { action: 'skip' });
check('anagrams: skipping advances you alone',
  anaSkip.data.match.state.round === 2 && anaSkip.data.match.state.opponentRound === 1,
  anaSkip.data.match.state);
check('anagrams: their score is visible, their answers are not',
  typeof anaSkip.data.match.state.opponentScore === 'number');
await req('/games/anagrams/resign', { method: 'POST', token: A.token });

const ll = (await req('/games/love-letters/match', { token: A.token })).data.match;
const llB = (await req('/games/love-letters/match', { token: B.token })).data.match;
check('love-letters: identical rack',
  JSON.stringify(ll.state.rack) === JSON.stringify(llB.state.rack), { a: ll.state.rack, b: llB.state.rack });
check('love-letters: their words are hidden mid-match', ll.state.opponentWords === null);
check('love-letters: an unspellable word is refused',
  (await move('love-letters', A.token, { word: 'QQQQQQ' })).status === 400);
const good = await move('love-letters', A.token, { word: ll.state.rack.slice(0, 2).join('') });
check('love-letters: a spellable one scores', good.data.match.state.score > 0, good.data.match?.state);
await req('/games/love-letters/resign', { method: 'POST', token: A.token });

const golf = (await req('/games/love-golf/match', { token: A.token })).data.match;
const golfB = (await req('/games/love-golf/match', { token: B.token })).data.match;
check('love-golf: the same hole layout for both',
  JSON.stringify(golf.state.hole) === JSON.stringify(golfB.state.hole));
check('love-golf: an absurd stroke count is refused',
  (await move('love-golf', A.token, { hole: 0, strokes: 500 })).status === 400);
check('love-golf: reporting a hole you are not on is refused',
  (await move('love-golf', A.token, { hole: 4, strokes: 2 })).status === 400);
const putted = await move('love-golf', A.token, { hole: 0, strokes: 3 });
check('love-golf: a plausible score is recorded',
  putted.data.match.state.total === 3 && putted.data.match.state.holeNumber === 2,
  putted.data.match?.state);
await req('/games/love-golf/resign', { method: 'POST', token: A.token });

const pp = (await req('/games/perfect-pair/match', { token: A.token })).data.match;
const ppB = (await req('/games/perfect-pair/match', { token: B.token })).data.match;
check('perfect-pair: the same word to solve', pp.state.word === ppB.state.word);
check('perfect-pair: options shuffled differently per phone',
  JSON.stringify(pp.state.options) !== JSON.stringify(ppB.state.options),
  { a: pp.state.options, b: ppB.state.options });
check('perfect-pair: the correct answer is not labelled',
  !JSON.stringify(pp.state).includes('correct'), Object.keys(pp.state));
await req('/games/perfect-pair/resign', { method: 'POST', token: A.token });

const wys = (await req('/games/what-you-saying/match', { token: A.token })).data.match;
check('what-you-saying: you get a mask, not the word',
  wys.state.mask.includes('_') && !('word' in wys.state) && !('words' in wys.state), wys.state);
const revealed = await move('what-you-saying', A.token, { action: 'reveal' });
check('what-you-saying: revealing costs you but shows more',
  revealed.data.match.state.revealed === 2, revealed.data.match?.state);
await req('/games/what-you-saying/resign', { method: 'POST', token: A.token });

console.log('\n=== AN UNKNOWN GAME IS A 404, NOT A CRASH ===');
check('starting one', (await start('battleship', A.token)).status === 404);
check('moving in one', (await move('battleship', A.token, {})).status === 404);
check('moving with no match in progress',
  (await move('checkers', A.token, { from: [5, 0], to: [4, 1] })).status === 404);

console.log(`\nGAMES RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
process.exit(0);
