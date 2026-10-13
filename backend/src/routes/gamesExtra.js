import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import { notifyUser, userName } from '../models/notify.js';
import { loadSeed } from '../lib/seedData.js';
import { replay, makeMove, gameStatus, inCheck } from '../lib/chess.js';

const router = asyncRouter();

router.use(requireAuth, requirePair);

// ---------------------------------------------------------------------------
// Who's More Likely: both partners point at "me" or "you"; the round reveals
// once both have voted. Agreeing is a match.
// ---------------------------------------------------------------------------
router.get('/wml', async (req, res) => {
  const questions = loadSeed('wml_questions.json');
  const { rows } = await query('SELECT user_id, question_key, vote_for FROM wml_votes WHERE pair_id = $1', [req.pair.id]);
  let matches = 0;
  let answered = 0;
  const payload = questions.map((q) => {
    const mine = rows.find((r) => r.question_key === q.key && r.user_id === req.userId);
    const theirs = rows.find((r) => r.question_key === q.key && r.user_id === req.partnerId);
    const both = Boolean(mine && theirs);
    const match = both && mine.vote_for === theirs.vote_for;
    if (both) answered += 1;
    if (match) matches += 1;
    return {
      key: q.key,
      text: q.text,
      myVote: mine ? mine.vote_for : null,
      partnerVoted: Boolean(theirs),
      partnerVote: both ? theirs.vote_for : null,
      revealed: both,
      match,
    };
  });
  res.json({ questions: payload, score: { answered, matches }, myId: req.userId, partnerId: req.partnerId });
});

router.post('/wml/:key/vote', async (req, res) => {
  const { voteFor } = req.body || {};
  const target = voteFor === 'me' ? req.userId : voteFor === 'partner' ? req.partnerId : null;
  if (!target) return res.status(400).json({ error: "voteFor must be 'me' or 'partner'" });
  const q = loadSeed('wml_questions.json').find((x) => x.key === req.params.key);
  if (!q) return res.status(404).json({ error: 'Question not found' });

  await query(
    `INSERT INTO wml_votes (pair_id, user_id, question_key, vote_for) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, pair_id, question_key) DO UPDATE SET vote_for = EXCLUDED.vote_for`,
    [req.pair.id, req.userId, q.key, target]
  );
  const { rows } = await query('SELECT vote_for FROM wml_votes WHERE pair_id = $1 AND user_id = $2 AND question_key = $3', [
    req.pair.id, req.partnerId, q.key,
  ]);
  const revealed = Boolean(rows[0]);
  req.app.get('io').to(`pair:${req.pair.id}`).emit('wml:vote', { key: q.key, fromUserId: req.userId });
  res.json({
    key: q.key,
    myVote: target,
    revealed,
    partnerVote: revealed ? rows[0].vote_for : null,
    match: revealed && rows[0].vote_for === target,
  });
});

// ---------------------------------------------------------------------------
// Chess: the server replays the move list with the shared rules engine, so an
// illegal or out-of-turn move is rejected here, not just hidden in the UI.
// ---------------------------------------------------------------------------
function chessView(game, userId) {
  const state = replay(game.moves);
  const myColor = game.white_id === userId ? 'w' : 'b';
  return {
    id: game.id,
    whiteId: game.white_id,
    blackId: game.black_id,
    myColor,
    moves: game.moves,
    turn: state.turn,
    myTurn: game.status === 'active' && state.turn === myColor,
    inCheck: inCheck(state),
    status: game.status,
    winnerId: game.winner_id,
    board: state.board,
    lastMove: state.lastMove || null,
    updatedAt: game.updated_at,
  };
}

router.get('/chess', async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM chess_games WHERE pair_id = $1 ORDER BY (status = 'active') DESC, updated_at DESC LIMIT 1`,
    [req.pair.id]
  );
  const { rows: record } = await query(
    `SELECT winner_id, COUNT(*)::int AS n FROM chess_games WHERE pair_id = $1 AND status <> 'active' GROUP BY winner_id`,
    [req.pair.id]
  );
  const tally = { me: 0, partner: 0, draws: 0 };
  for (const r of record) {
    if (r.winner_id === req.userId) tally.me += r.n;
    else if (r.winner_id === req.partnerId) tally.partner += r.n;
    else tally.draws += r.n;
  }
  res.json({ game: rows[0] ? chessView(rows[0], req.userId) : null, record: tally });
});

router.post('/chess/new', async (req, res) => {
  const { rows: active } = await query(`SELECT id FROM chess_games WHERE pair_id = $1 AND status = 'active'`, [req.pair.id]);
  if (active[0] && !req.body?.abandonCurrent) {
    return res.status(409).json({ error: 'A game is already in progress', gameId: active[0].id });
  }
  if (active[0]) {
    await query(`UPDATE chess_games SET status = 'resigned', winner_id = $1, updated_at = now() WHERE id = $2`, [req.partnerId, active[0].id]);
  }
  const color = req.body?.color;
  const iAmWhite = color === 'w' ? true : color === 'b' ? false : Math.random() < 0.5;
  const { rows } = await query(
    'INSERT INTO chess_games (pair_id, white_id, black_id) VALUES ($1, $2, $3) RETURNING *',
    [req.pair.id, iAmWhite ? req.userId : req.partnerId, iAmWhite ? req.partnerId : req.userId]
  );
  req.app.get('io').to(`pair:${req.pair.id}`).emit('chess:update', { gameId: rows[0].id });
  const name = await userName(req.userId);
  notifyUser(req.partnerId, 'games', { title: `${name} challenged you to chess ♟️`, body: iAmWhite ? 'They play white.' : "You're white — your move!" }, { screen: 'Chess' });
  res.status(201).json({ game: chessView(rows[0], req.userId) });
});

router.post('/chess/:id/move', async (req, res) => {
  const { from, to, promotion, index } = req.body || {};
  const { rows } = await query('SELECT * FROM chess_games WHERE id = $1 AND pair_id = $2', [req.params.id, req.pair.id]);
  const game = rows[0];
  if (!game) return res.status(404).json({ error: 'Game not found' });
  if (game.status !== 'active') return res.status(409).json({ error: 'That game is over' });
  // Optimistic ordering: a client acting on a stale board is told to reload.
  if (index !== undefined && index !== game.moves.length) {
    return res.status(409).json({ error: 'The board changed — reload', game: chessView(game, req.userId) });
  }

  const state = replay(game.moves);
  const myColor = game.white_id === req.userId ? 'w' : 'b';
  if (state.turn !== myColor) return res.status(409).json({ error: "It's not your turn" });

  const next = makeMove(state, { from, to, promotion });
  if (!next) return res.status(400).json({ error: 'Illegal move' });

  const status = gameStatus(next);
  const winner = status === 'checkmate' ? req.userId : null;
  const moves = [...game.moves, next.lastMove];
  const { rows: updated } = await query(
    `UPDATE chess_games SET moves = $1::jsonb, status = $2, winner_id = $3, updated_at = now()
     WHERE id = $4 AND jsonb_array_length(moves) = $5 RETURNING *`,
    [JSON.stringify(moves), status, winner, game.id, game.moves.length]
  );
  if (!updated[0]) return res.status(409).json({ error: 'The board changed — reload' });

  req.app.get('io').to(`pair:${req.pair.id}`).emit('chess:update', { gameId: game.id });
  const name = await userName(req.userId);
  notifyUser(req.partnerId, 'games', {
    title: status === 'checkmate' ? `Checkmate! ${name} wins ♟️` : status !== 'active' ? `Chess: ${status}` : `${name} moved ${from}→${to}`,
    body: status === 'active' ? 'Your move ♟️' : 'Rematch?',
  }, { screen: 'Chess' });
  res.json({ game: chessView(updated[0], req.userId) });
});

router.post('/chess/:id/resign', async (req, res) => {
  const { rows } = await query(
    `UPDATE chess_games SET status = 'resigned', winner_id = $1, updated_at = now()
     WHERE id = $2 AND pair_id = $3 AND status = 'active' RETURNING *`,
    [req.partnerId, req.params.id, req.pair.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'No active game with that id' });
  req.app.get('io').to(`pair:${req.pair.id}`).emit('chess:update', { gameId: rows[0].id });
  res.json({ game: chessView(rows[0], req.userId) });
});

export default router;
