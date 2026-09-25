import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';

const router = asyncRouter();

router.use(requireAuth, requirePair);

// Global curated ideas (pair_id IS NULL), filterable.
router.get('/', async (req, res) => {
  const { category, costTier } = req.query;
  const conditions = ['pair_id IS NULL'];
  const params = [];

  if (category) {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  }
  if (costTier) {
    params.push(costTier);
    conditions.push(`cost_tier = $${params.length}`);
  }

  const { rows } = await query(
    `SELECT * FROM date_ideas WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
    params
  );
  res.json({ ideas: rows });
});

router.get('/saved', async (req, res) => {
  const { rows } = await query('SELECT * FROM date_ideas WHERE pair_id = $1 ORDER BY created_at DESC', [
    req.pair.id,
  ]);
  res.json({ ideas: rows });
});

// The presence of pair_id IS the "saved" state — copies the global row into
// a new pair-scoped row rather than tracking a separate boolean.
router.post('/:id/save', async (req, res) => {
  const { rows: source } = await query('SELECT * FROM date_ideas WHERE id = $1 AND pair_id IS NULL', [
    req.params.id,
  ]);
  const idea = source[0];
  if (!idea) return res.status(404).json({ error: 'Date idea not found' });

  const { rows } = await query(
    `INSERT INTO date_ideas (pair_id, title, description, category, cost_tier)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [req.pair.id, idea.title, idea.description, idea.category, idea.cost_tier]
  );

  res.status(201).json({ idea: rows[0] });
});

// taken_at semantics reused from memories: completion date is when it's
// marked done, not the idea's original creation date.
router.post('/:id/complete', async (req, res) => {
  const { rows } = await query(
    `UPDATE date_ideas SET is_completed = TRUE WHERE id = $1 AND pair_id = $2 RETURNING *`,
    [req.params.id, req.pair.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Saved date idea not found' });
  res.json({ idea: rows[0] });
});

// --------------------------------------------------------------- matching
//
// Both of you vote independently; a MATCH is both voting yes. Neither sees
// the other's vote until they have cast their own — the same rule the daily
// prompt uses, for the same reason: knowing what they picked changes what you
// pick, and then a match means nothing.

router.put('/:id/vote', async (req, res) => {
  const liked = Boolean(req.body?.liked);

  const { rows: exists } = await query(
    'SELECT id FROM date_ideas WHERE id = $1 AND (pair_id = $2 OR pair_id IS NULL)',
    [req.params.id, req.pair.id]
  );
  if (!exists[0]) return res.status(404).json({ error: 'Date idea not found' });

  await query(
    `INSERT INTO date_idea_votes (pair_id, date_idea_id, user_id, liked)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (date_idea_id, user_id) DO UPDATE SET liked = EXCLUDED.liked, created_at = now()`,
    [req.pair.id, req.params.id, req.userId, liked]
  );

  const { rows: votes } = await query(
    'SELECT user_id, liked FROM date_idea_votes WHERE date_idea_id = $1 AND pair_id = $2',
    [req.params.id, req.pair.id]
  );
  const theirs = votes.find((v) => v.user_id === req.partnerId);
  const matched = liked && theirs?.liked === true;

  if (matched) {
    // A match is worth telling both phones about the moment it happens.
    req.app.get('io')?.to(`pair:${req.pair.id}`)
      .emit('date:matched', { dateIdeaId: req.params.id });
  }

  res.json({
    liked,
    // Only revealed once you have voted, which you just did.
    partnerVoted: Boolean(theirs),
    matched,
  });
});

/**
 * The swipe deck: what THIS person has not voted on yet.
 *
 * Deliberately not "what neither of you has voted on". The two of you swipe
 * at different times, and a deck that emptied as soon as your partner got
 * through it would mean whoever opens the app second never gets to vote — and
 * a match needs both votes, so the whole feature would quietly stop working
 * for one of you.
 *
 * Seeded ideas (pair_id IS NULL) are in the deck alongside your own, which is
 * what stops a new couple opening it to an empty stack.
 */
router.get('/swipe', async (req, res) => {
  const { rows } = await query(
    `SELECT d.* FROM date_ideas d
      WHERE (d.pair_id = $1 OR d.pair_id IS NULL)
        AND d.is_completed = FALSE
        AND d.status = 'idea'
        AND NOT EXISTS (
          SELECT 1 FROM date_idea_votes v
           WHERE v.date_idea_id = d.id AND v.user_id = $2 AND v.pair_id = $1
        )
      -- Shuffled, and seeded with the pair id so both of you get the SAME
      -- order. Swiping through the deck together on one sofa is most of how
      -- this gets used, and two different orders makes that impossible.
      ORDER BY md5(d.id::text || $1::text)
      LIMIT 40`,
    [req.pair.id, req.userId]
  );

  const { rows: counts } = await query(
    `SELECT count(*)::int AS voted FROM date_idea_votes WHERE pair_id = $1 AND user_id = $2`,
    [req.pair.id, req.userId]
  );

  res.json({ deck: rows, votedSoFar: counts[0].voted });
});

/** Everything you have both said yes to. */
router.get('/matches', async (req, res) => {
  const { rows } = await query(
    `SELECT d.*,
            (SELECT count(*)::int FROM date_idea_votes v
              WHERE v.date_idea_id = d.id AND v.liked = TRUE AND v.pair_id = $1) AS yes_votes
       FROM date_ideas d
      WHERE (d.pair_id = $1 OR d.pair_id IS NULL)
        AND (SELECT count(*)::int FROM date_idea_votes v
              WHERE v.date_idea_id = d.id AND v.liked = TRUE AND v.pair_id = $1) = 2
      ORDER BY d.scheduled_for NULLS LAST, d.created_at DESC`,
    [req.pair.id]
  );
  res.json({ matches: rows });
});

// -------------------------------------------------------------- scheduling

const STATUSES = ['idea', 'scheduled', 'done', 'skipped'];

router.patch('/:id/schedule', async (req, res) => {
  const { scheduledFor, status } = req.body || {};

  if (status && !STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${STATUSES.join(', ')}` });
  }
  if (scheduledFor && Number.isNaN(new Date(scheduledFor).getTime())) {
    return res.status(400).json({ error: 'scheduledFor must be a date' });
  }

  // Setting a date implies scheduling it, so the caller does not have to send
  // both and cannot send a contradiction.
  const nextStatus = status || (scheduledFor ? 'scheduled' : undefined);

  // A shared idea (pair_id NULL) is copied to this pair before scheduling —
  // otherwise one couple's plans would land on every couple's seeded row.
  let id = req.params.id;
  const { rows: found } = await query('SELECT * FROM date_ideas WHERE id = $1', [id]);
  if (!found[0]) return res.status(404).json({ error: 'Date idea not found' });

  if (found[0].pair_id === null) {
    const { rows: copy } = await query(
      `INSERT INTO date_ideas (pair_id, title, description, category, cost_tier, image_url)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.pair.id, found[0].title, found[0].description, found[0].category,
        found[0].cost_tier, found[0].image_url]
    );
    id = copy[0].id;
  } else if (found[0].pair_id !== req.pair.id) {
    return res.status(403).json({ error: 'Not your date idea' });
  }

  const { rows } = await query(
    `UPDATE date_ideas
        SET scheduled_for = COALESCE($1, scheduled_for),
            status = COALESCE($2, status),
            is_completed = ($2 = 'done') OR is_completed
      WHERE id = $3 RETURNING *`,
    [scheduledFor || null, nextStatus || null, id]
  );

  req.app.get('io')?.to(`pair:${req.pair.id}`).emit('date:scheduled', { dateIdea: rows[0] });
  res.json({ dateIdea: rows[0] });
});

/** What is coming up, soonest first. */
router.get('/upcoming', async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM date_ideas
      WHERE pair_id = $1 AND status = 'scheduled' AND scheduled_for IS NOT NULL
        AND scheduled_for > now() - interval '12 hours'
      ORDER BY scheduled_for ASC LIMIT 20`,
    [req.pair.id]
  );
  res.json({ upcoming: rows });
});

export default router;
