// Badges, and repairing a broken streak.
//
// Awarding is a read operation with a side effect, which is unusual enough to
// explain: the stats that decide a badge are scattered across a dozen tables,
// and keeping a running tally in each of those places would mean every
// feature in the app knowing about achievements. Instead the counts are
// gathered when the screen asks, and anything newly satisfied is inserted
// then. The unique index makes that idempotent, so two phones opening the
// screen at once cannot award the same badge twice.
import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import { earnedFrom, present, BY_SLUG } from '../models/achievements.js';

const router = asyncRouter();
router.use(requireAuth, requirePair);

/** Everything the catalogue's rules can ask about, in one round trip. */
async function statsFor(pair) {
  const one = (sql, params = [pair.id]) => query(sql, params).then((r) => Number(r.rows[0]?.n || 0));

  const [
    messages, doodles, widgetPhotos, memories, promptsAnswered,
    gamesFinished, bucketDone, datesScheduled, sealedNotes, perfectQuizzes,
  ] = await Promise.all([
    one('SELECT count(*)::int AS n FROM messages WHERE pair_id = $1'),
    one("SELECT count(*)::int AS n FROM messages WHERE pair_id = $1 AND type = 'doodle'"),
    one('SELECT count(*)::int AS n FROM widget_photos WHERE pair_id = $1'),
    one('SELECT count(*)::int AS n FROM memories WHERE pair_id = $1'),
    one('SELECT count(*)::int AS n FROM prompt_responses WHERE pair_id = $1'),
    one("SELECT count(*)::int AS n FROM game_matches WHERE pair_id = $1 AND status = 'finished'"),
    one('SELECT count(*)::int AS n FROM bucket_list_items WHERE pair_id = $1 AND is_completed = TRUE'),
    one('SELECT count(*)::int AS n FROM date_ideas WHERE pair_id = $1 AND scheduled_for IS NOT NULL'),
    one('SELECT count(*)::int AS n FROM notes WHERE pair_id = $1 AND sealed = TRUE'),
    // A perfect quiz: a day where every question both answered matched.
    query(
      `SELECT count(*)::int AS n FROM (
         SELECT q.scheduled_date
           FROM quiz_attempts a
           JOIN quiz_questions q ON q.id = a.quiz_question_id
          WHERE a.pair_id = $1
          GROUP BY q.scheduled_date
         HAVING count(DISTINCT a.user_id) = 2
            AND count(DISTINCT lower(btrim(a.answer))) = count(*) / 2
       ) AS perfect_days`,
      [pair.id]
    ).then((r) => Number(r.rows[0]?.n || 0)),
  ]);

  const daysTogether = pair.together_since
    ? Math.max(0, Math.floor((Date.now() - new Date(pair.together_since).getTime()) / 86400000))
    : 0;

  return {
    paired: true,
    messages, doodles, widgetPhotos, memories, promptsAnswered,
    gamesFinished, bucketDone, datesScheduled, sealedNotes, perfectQuizzes,
    daysTogether,
    streak: pair.streak_count || 0,
    longestStreak: Math.max(pair.longest_streak || 0, pair.streak_count || 0),
  };
}

router.get('/', async (req, res) => {
  const stats = await statsFor(req.pair);
  const qualifying = earnedFrom(stats);

  // Insert anything newly satisfied. ON CONFLICT DO NOTHING is what makes
  // this safe to run on every load and from both phones at once.
  const fresh = [];
  for (const slug of qualifying) {
    const { rows } = await query(
      `INSERT INTO pair_achievements (pair_id, slug) VALUES ($1, $2)
       ON CONFLICT (pair_id, slug) DO NOTHING RETURNING slug`,
      [req.pair.id, slug]
    );
    if (rows[0]) fresh.push(slug);
  }

  const { rows: held } = await query(
    'SELECT slug, earned_at FROM pair_achievements WHERE pair_id = $1',
    [req.pair.id]
  );
  const earnedAt = Object.fromEntries(held.map((r) => [r.slug, r.earned_at]));

  res.json({
    achievements: present(held.map((r) => r.slug)).map((a) => ({ ...a, earnedAt: earnedAt[a.slug] || null })),
    // What to celebrate on screen: the ones that became true just now.
    newlyEarned: fresh.map((slug) => ({ ...BY_SLUG[slug], slug })),
    earnedCount: held.length,
    stats,
  });
});

// ---------------------------------------------------------------- streak

const REPAIR_GRACE_DAYS = 2;   // how recently it must have broken
const REPAIRS_PER_MONTH = 1;

router.get('/streak', async (req, res) => {
  const p = req.pair;
  const repairable = Boolean(p.broken_streak) && p.broken_streak > 1;
  const lastRepair = p.last_repair_at ? new Date(p.last_repair_at) : null;
  const monthlyUsed = lastRepair && (Date.now() - lastRepair.getTime()) < 30 * 86400000;

  res.json({
    streak: p.streak_count || 0,
    longest: Math.max(p.longest_streak || 0, p.streak_count || 0),
    brokenStreak: p.broken_streak || null,
    brokenAt: p.broken_streak_at || null,
    canRepair: repairable && !monthlyUsed,
    repairsUsed: p.streak_repairs_used || 0,
    // Said plainly rather than left for the client to work out, because "why
    // can't I repair it" is the only question this endpoint gets asked.
    reason: !repairable
      ? 'Nothing to repair.'
      : monthlyUsed
        ? 'Already repaired a streak in the last 30 days.'
        : null,
  });
});

/**
 * Puts a broken streak back.
 *
 * Bounded on purpose: once a month, and only within a couple of days of the
 * break. A repair you can use whenever means the streak counts nothing, and
 * a number that counts nothing is not worth showing.
 */
router.post('/streak/repair', async (req, res) => {
  const p = req.pair;

  if (!p.broken_streak || p.broken_streak <= 1) {
    return res.status(400).json({ error: 'Nothing to repair' });
  }
  if (p.broken_streak_at
      && (Date.now() - new Date(p.broken_streak_at).getTime()) > REPAIR_GRACE_DAYS * 86400000) {
    return res.status(400).json({ error: 'That streak broke too long ago to pick back up' });
  }
  if (p.last_repair_at && (Date.now() - new Date(p.last_repair_at).getTime()) < 30 * 86400000) {
    return res.status(429).json({ error: 'You have already repaired a streak this month' });
  }

  const { rows } = await query(
    `UPDATE pairs
        SET streak_count = $1,
            longest_streak = GREATEST(longest_streak, $1),
            streak_repairs_used = streak_repairs_used + 1,
            last_repair_at = now(),
            broken_streak = NULL,
            broken_streak_at = NULL
      WHERE id = $2
      RETURNING streak_count, longest_streak, streak_repairs_used`,
    [p.broken_streak, p.id]
  );

  req.app.get('io')?.to(`pair:${p.id}`).emit('streak:repaired', { streak: rows[0].streak_count });
  res.json({ streak: rows[0].streak_count, longest: rows[0].longest_streak, repairsUsed: rows[0].streak_repairs_used });
});

export default router;
