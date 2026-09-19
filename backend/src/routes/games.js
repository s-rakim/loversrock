import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import { getEngine, listGames, IllegalMove } from '../models/games/index.js';
import { getIo } from '../sockets/index.js';

const router = asyncRouter();

router.get('/', requireAuth, async (req, res) => {
  const { rows } = await query('SELECT * FROM games_catalog ORDER BY sort_order');
  res.json({ games: rows, multiplayer: listGames() });
});

/** Which seat this user holds in a match. Never taken from the request. */
const seatOf = (match, userId) => (match.player1_id === userId ? 1 : match.player2_id === userId ? 2 : null);

/**
 * The single shape every match endpoint returns.
 *
 * The raw `state` column is never in here. It goes through the engine's
 * redactFor() first, so a hidden-information game cannot leak through a
 * route that forgot — there is exactly one place that builds this payload.
 */
function viewOf(match, engine, userId) {
  const seat = seatOf(match, userId);
  return {
    id: match.id,
    game: match.game,
    seat,
    yourTurn: match.status === 'active'
      && (engine.freeplay ? true : match.turn_user_id === userId),
    freeplay: Boolean(engine.freeplay),
    turnUserId: match.turn_user_id,
    status: match.status,
    // 'you' | 'them' | 'draw' | null, so the client never has to work out
    // which seat it was sitting in to know whether it won.
    outcome: match.result === null || match.status !== 'finished'
      ? null
      : match.result === 'draw'
        ? 'draw'
        : (match.result === 'player1' ? 1 : 2) === seat ? 'you' : 'them',
    moveCount: match.move_count,
    state: engine.redactFor(match.state, seat),
    updatedAt: match.updated_at,
  };
}

async function loadActive(pairId, game) {
  const { rows } = await query(
    `SELECT * FROM game_matches WHERE pair_id = $1 AND game = $2 AND status = 'active'`,
    [pairId, game]
  );
  return rows[0] || null;
}

router.use(requireAuth, requirePair);

/** The hub: one row per game, with the live match and the running tally. */
router.get('/matches', async (req, res) => {
  const { rows: matches } = await query(
    `SELECT * FROM game_matches WHERE pair_id = $1 AND status = 'active'`,
    [req.pair.id]
  );
  const { rows: scores } = await query(
    'SELECT * FROM game_scores WHERE pair_id = $1 AND user_id = $2',
    [req.pair.id, req.userId]
  );

  const byGame = Object.fromEntries(matches.map((m) => [m.game, m]));
  const scoreByGame = Object.fromEntries(scores.map((s) => [s.game, s]));

  res.json({
    games: listGames().map((game) => {
      const engine = getEngine(game);
      const match = byGame[game];
      const tally = scoreByGame[game];
      return {
        game,
        title: engine.title,
        freeplay: Boolean(engine.freeplay),
        active: match ? viewOf(match, engine, req.userId) : null,
        record: {
          wins: tally?.wins || 0,
          draws: tally?.draws || 0,
          losses: tally?.losses || 0,
        },
      };
    }),
  });
});

/**
 * Start a match, or join the one already running.
 *
 * Idempotent on purpose: both phones tapping "play" at the same moment must
 * end up in the same match, not two. The partial unique index on
 * (pair_id, game) WHERE status = 'active' makes the database enforce that
 * even if both inserts race, and the 23505 below turns the loser of the race
 * into a join rather than an error.
 */
router.post('/:game/start', async (req, res) => {
  const engine = getEngine(req.params.game);
  if (!engine) return res.status(404).json({ error: 'No such game' });

  const existing = await loadActive(req.pair.id, req.params.game);
  if (existing) return res.json({ match: viewOf(existing, engine, req.userId), joined: true });

  // Whoever starts takes seat 1 and moves first.
  const state = engine.create({ seed: Date.now() });
  try {
    const { rows } = await query(
      `INSERT INTO game_matches (pair_id, game, player1_id, player2_id, turn_user_id, state)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        req.pair.id, req.params.game, req.userId, req.partnerId,
        engine.freeplay ? null : req.userId, JSON.stringify(state),
      ]
    );
    const match = rows[0];
    const io = getIo();
    if (io) {
      // Push the partner THEIR view, not ours — redaction is per seat.
      io.to(`pair:${req.pair.id}`).emit('game:started', {
        game: req.params.game, matchId: match.id,
      });
    }
    res.status(201).json({ match: viewOf(match, engine, req.userId), joined: false });
  } catch (err) {
    if (err.code === '23505') {
      const raced = await loadActive(req.pair.id, req.params.game);
      return res.json({ match: viewOf(raced, engine, req.userId), joined: true });
    }
    throw err;
  }
});

router.get('/:game/match', async (req, res) => {
  const engine = getEngine(req.params.game);
  if (!engine) return res.status(404).json({ error: 'No such game' });

  const match = await loadActive(req.pair.id, req.params.game);
  if (!match) return res.json({ match: null });
  res.json({ match: viewOf(match, engine, req.userId) });
});

/**
 * Make a move.
 *
 * The client sends what it wants to do; the server decides whether it may.
 * Three gates, in order: you are in this match, it is your turn, the engine
 * says the move is legal. None of them can be skipped by a crafted request,
 * because none of them reads anything the client supplied about identity,
 * seat, or whose turn it is.
 */
router.post('/:game/move', async (req, res) => {
  const engine = getEngine(req.params.game);
  if (!engine) return res.status(404).json({ error: 'No such game' });

  const match = await loadActive(req.pair.id, req.params.game);
  if (!match) return res.status(404).json({ error: 'No match in progress' });

  const seat = seatOf(match, req.userId);
  if (!seat) return res.status(403).json({ error: 'You are not in this match' });
  if (!engine.freeplay && match.turn_user_id !== req.userId) {
    return res.status(409).json({ error: "It is not your turn" });
  }

  // Optimistic concurrency: a client that was looking at an older board is
  // told to refresh rather than having its stale move applied.
  if (req.body?.expectedMoveCount !== undefined
    && Number(req.body.expectedMoveCount) !== match.move_count) {
    return res.status(409).json({
      error: 'The board moved on',
      match: viewOf(match, engine, req.userId),
    });
  }

  let outcome;
  try {
    outcome = engine.apply(match.state, req.body?.move ?? req.body, seat);
  } catch (err) {
    if (err instanceof IllegalMove) return res.status(400).json({ error: err.message });
    throw err;
  }

  const { state, result, nextSeat } = outcome;
  const nextTurnUserId = result || nextSeat === 'free' || nextSeat === null
    ? null
    : nextSeat === 1 ? match.player1_id : match.player2_id;

  const { rows } = await query(
    `UPDATE game_matches
     SET state = $1, turn_user_id = $2, move_count = move_count + 1,
         status = $3, result = $4, updated_at = now()
     WHERE id = $5 RETURNING *`,
    [
      JSON.stringify(state), nextTurnUserId,
      result ? 'finished' : 'active', result || null, match.id,
    ]
  );
  const updated = rows[0];

  await query(
    `INSERT INTO game_moves (match_id, user_id, ply, move) VALUES ($1, $2, $3, $4)
     ON CONFLICT (match_id, ply) DO NOTHING`,
    [match.id, req.userId, updated.move_count, JSON.stringify(req.body?.move ?? req.body)]
  );

  if (result) await recordResult(req.pair.id, req.params.game, updated, result);

  const io = getIo();
  if (io) {
    // Only a nudge goes over the wire. Each phone then GETs its own redacted
    // view, so the socket can never become the thing that leaks a hand.
    io.to(`pair:${req.pair.id}`).emit('game:moved', {
      game: req.params.game,
      matchId: updated.id,
      moveCount: updated.move_count,
      status: updated.status,
    });
  }

  res.json({ match: viewOf(updated, engine, req.userId) });
});

/** Give up. Counts as a loss, so it cannot be used to dodge one. */
router.post('/:game/resign', async (req, res) => {
  const engine = getEngine(req.params.game);
  if (!engine) return res.status(404).json({ error: 'No such game' });

  const match = await loadActive(req.pair.id, req.params.game);
  if (!match) return res.status(404).json({ error: 'No match in progress' });
  const seat = seatOf(match, req.userId);
  if (!seat) return res.status(403).json({ error: 'You are not in this match' });

  const result = seat === 1 ? 'player2' : 'player1';
  const { rows } = await query(
    `UPDATE game_matches SET status = 'finished', result = $1, turn_user_id = NULL,
       updated_at = now() WHERE id = $2 RETURNING *`,
    [result, match.id]
  );
  await recordResult(req.pair.id, req.params.game, rows[0], result);

  const io = getIo();
  if (io) io.to(`pair:${req.pair.id}`).emit('game:moved', {
    game: req.params.game, matchId: match.id, status: 'finished',
  });

  res.json({ match: viewOf(rows[0], engine, req.userId) });
});

/** The running tally, one row per player per game. */
async function recordResult(pairId, game, match, result) {
  const winner = result === 'player1' ? match.player1_id : result === 'player2' ? match.player2_id : null;
  for (const userId of [match.player1_id, match.player2_id]) {
    const column = result === 'draw' ? 'draws' : userId === winner ? 'wins' : 'losses';
    await query(
      `INSERT INTO game_scores (pair_id, game, user_id, ${column})
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (pair_id, game, user_id)
       DO UPDATE SET ${column} = game_scores.${column} + 1, updated_at = now()`,
      [pairId, game, userId]
    );
  }
}

export default router;
