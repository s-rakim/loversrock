import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import { pairLocalDateString } from '../models/pairs.js';
import { earnSparks, SPARK_REWARDS } from '../models/sparks.js';
import { notifyUser, userName } from '../models/notify.js';
import { loadSeed, stableHash } from '../lib/seedData.js';

const router = asyncRouter();

router.use(requireAuth, requirePair);

const MAX_REROLLS = 3;

async function todaysPick(pair) {
  const day = pairLocalDateString(pair);
  const challenges = loadSeed('challenges.json');
  const { rows } = await query('SELECT count FROM challenge_rerolls WHERE pair_id = $1 AND day = $2', [pair.id, day]);
  const rerolls = rows[0]?.count || 0;
  const challenge = challenges[stableHash(`${pair.id}:${day}:${rerolls}`) % challenges.length];
  const { rows: done } = await query(
    'SELECT completed_by, created_at FROM challenge_completions WHERE pair_id = $1 AND challenge_key = $2 AND day = $3',
    [pair.id, challenge.key, day]
  );
  return {
    day,
    challenge,
    rerollsLeft: Math.max(0, MAX_REROLLS - rerolls),
    completed: Boolean(done[0]),
    completedBy: done[0]?.completed_by || null,
    reward: SPARK_REWARDS.challenge,
  };
}

// Today's random challenge — the same for both partners all day.
router.get('/today', async (req, res) => {
  res.json(await todaysPick(req.pair));
});

router.post('/today/reroll', async (req, res) => {
  const current = await todaysPick(req.pair);
  if (current.completed) return res.status(409).json({ error: "Today's challenge is already done" });
  if (current.rerollsLeft <= 0) return res.status(429).json({ error: 'No rerolls left today' });
  await query(
    `INSERT INTO challenge_rerolls (pair_id, day, count) VALUES ($1, $2, 1)
     ON CONFLICT (pair_id, day) DO UPDATE SET count = challenge_rerolls.count + 1`,
    [req.pair.id, current.day]
  );
  const next = await todaysPick(req.pair);
  req.app.get('io').to(`pair:${req.pair.id}`).emit('challenge:update', next);
  res.json(next);
});

router.post('/today/complete', async (req, res) => {
  const current = await todaysPick(req.pair);
  const { rowCount } = await query(
    `INSERT INTO challenge_completions (pair_id, challenge_key, day, completed_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [req.pair.id, current.challenge.key, current.day, req.userId]
  );
  if (rowCount > 0) {
    for (const uid of [req.userId, req.partnerId]) {
      await earnSparks({ pairId: req.pair.id, userId: uid, amount: SPARK_REWARDS.challenge, reason: 'challenge', ref: `${current.challenge.key}:${current.day}` });
    }
    const name = await userName(req.userId);
    notifyUser(req.partnerId, 'games', { title: 'Challenge complete 🎉', body: `${name} marked "${current.challenge.title}" done. +${SPARK_REWARDS.challenge} Sparks each!` });
  }
  const next = await todaysPick(req.pair);
  req.app.get('io').to(`pair:${req.pair.id}`).emit('challenge:update', next);
  res.json(next);
});

router.get('/history', async (req, res) => {
  const byKey = Object.fromEntries(loadSeed('challenges.json').map((c) => [c.key, c]));
  const { rows } = await query(
    'SELECT challenge_key, day, completed_by, created_at FROM challenge_completions WHERE pair_id = $1 ORDER BY day DESC',
    [req.pair.id]
  );
  res.json({ history: rows.map((r) => ({ ...r, challenge: byKey[r.challenge_key] || null })) });
});

// "Can't decide? Let Candle pick" — a random activity from anywhere in the
// app: a challenge, a date idea, a game, or a question deck.
router.get('/random', async (req, res) => {
  const kinds = ['challenge', 'date', 'game', 'deck'];
  const kind = kinds.includes(req.query.kind) ? req.query.kind : kinds[Math.floor(Math.random() * kinds.length)];

  if (kind === 'challenge') {
    const all = loadSeed('challenges.json');
    const c = all[Math.floor(Math.random() * all.length)];
    return res.json({ kind, title: c.title, description: c.description, icon: c.icon, target: { screen: 'Challenge' } });
  }
  if (kind === 'date') {
    const { rows } = await query('SELECT * FROM date_ideas WHERE pair_id IS NULL AND is_premium = FALSE ORDER BY random() LIMIT 1');
    const d = rows[0];
    return res.json({ kind, title: d?.title, description: d?.description, icon: 'heart', target: { screen: 'DateDiscover' } });
  }
  if (kind === 'game') {
    const { rows } = await query('SELECT * FROM games_catalog WHERE is_implemented ORDER BY random() LIMIT 1');
    const g = rows[0];
    return res.json({ kind, title: g?.title, description: g?.subtitle, icon: g?.emoji, target: { screen: 'Games', slug: g?.slug } });
  }
  const { rows } = await query(
    `SELECT * FROM question_decks WHERE spark_cost IS NULL AND season_start IS NULL ORDER BY random() LIMIT 1`
  );
  const d = rows[0];
  return res.json({ kind, title: d?.title, description: d?.category, icon: d?.emoji, target: { screen: 'DeckDetail', slug: d?.slug } });
});

export default router;
