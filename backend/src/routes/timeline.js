import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import { pairLocalDateString } from '../models/pairs.js';
import { ACHIEVEMENTS } from '../models/achievements.js';
import { loadSeed } from '../lib/seedData.js';

const router = asyncRouter();

router.use(requireAuth, requirePair);

// The relationship calendar: every shared moment of a month, grouped by
// pair-local day — photos, snaps, posts, dates, bucket-list wins, check-ins,
// challenges, drawings and achievements in one place.
router.get('/', async (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : pairLocalDateString(req.pair).slice(0, 7);
  const tz = req.pair.timezone;
  const p = req.pair.id;
  const inMonth = (col) => `to_char(${col} AT TIME ZONE $2, 'YYYY-MM') = $3`;
  const day = (col) => `to_char(${col} AT TIME ZONE $2, 'YYYY-MM-DD')`;
  const args = [p, tz, month];

  const sources = await Promise.all([
    query(`SELECT id, ${day('taken_at')} AS day, taken_at AS at, caption AS title, image_url, source FROM memories
           WHERE pair_id = $1 AND deleted_at IS NULL AND source = 'manual' AND ${inMonth('taken_at')}`, args),
    query(`SELECT id, ${day('created_at')} AS day, created_at AS at, caption AS title, image_url, sender_id FROM widget_photos
           WHERE pair_id = $1 AND ${inMonth('created_at')}`, args),
    query(`SELECT id, ${day('created_at')} AS day, created_at AS at, body AS title, image_url, author_id FROM feed_posts
           WHERE pair_id = $1 AND deleted_at IS NULL AND ${inMonth('created_at')}`, args),
    query(`SELECT id, ${day('COALESCE(completed_at, scheduled_for)')} AS day, COALESCE(completed_at, scheduled_for) AS at, title, status FROM date_plans
           WHERE pair_id = $1 AND status <> 'cancelled' AND COALESCE(completed_at, scheduled_for) IS NOT NULL
             AND ${inMonth('COALESCE(completed_at, scheduled_for)')}`, args),
    query(`SELECT id, ${day('completed_at')} AS day, completed_at AS at, title FROM bucket_list_items
           WHERE pair_id = $1 AND is_completed AND completed_at IS NOT NULL AND ${inMonth('completed_at')}`, args),
    query(`SELECT challenge_key, day::text AS day, created_at AS at FROM challenge_completions
           WHERE pair_id = $1 AND to_char(day, 'YYYY-MM') = $3 AND $2::text = $2::text`, args),
    query(`SELECT id, ${day('created_at')} AS day, created_at AS at, title FROM canvas_drawings
           WHERE pair_id = $1 AND ${inMonth('created_at')}`, args),
    query(`SELECT key, ${day('unlocked_at')} AS day, unlocked_at AS at FROM pair_achievements
           WHERE pair_id = $1 AND ${inMonth('unlocked_at')}`, args),
    query(`SELECT month, MAX(created_at) AS at, ${day('MAX(created_at)')} AS day, COUNT(*)::int AS n FROM checkins
           WHERE pair_id = $1 AND month = $3 AND $2::text = $2::text GROUP BY month`, args),
    query(`SELECT id, ${day('target_date')} AS day, target_date AS at, label AS title FROM countdowns
           WHERE pair_id = $1 AND ${inMonth('target_date')}`, args),
  ]);
  const [memories, snaps, posts, dates, bucket, challenges, drawings, achievements, checkins, countdowns] = sources.map((r) => r.rows);
  const challengeByKey = Object.fromEntries(loadSeed('challenges.json').map((c) => [c.key, c]));
  const achievementByKey = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.key, a]));

  const events = [
    ...memories.map((r) => ({ type: 'memory', id: r.id, day: r.day, at: r.at, title: r.title || 'Memory', imageUrl: r.image_url, icon: 'images' })),
    ...snaps.map((r) => ({ type: 'snap', id: r.id, day: r.day, at: r.at, title: r.title || 'Daily Snap', imageUrl: r.image_url, icon: 'camera', byMe: r.sender_id === req.userId })),
    ...posts.map((r) => ({ type: 'post', id: r.id, day: r.day, at: r.at, title: r.title || 'Shared a photo', imageUrl: r.image_url, icon: 'newspaper', byMe: r.author_id === req.userId })),
    ...dates.map((r) => ({ type: 'date', id: r.id, day: r.day, at: r.at, title: r.title, status: r.status, icon: 'calendar' })),
    ...bucket.map((r) => ({ type: 'bucket', id: r.id, day: r.day, at: r.at, title: r.title, icon: 'checkbox' })),
    ...challenges.map((r) => ({ type: 'challenge', id: `${r.challenge_key}:${r.day}`, day: r.day, at: r.at, title: challengeByKey[r.challenge_key]?.title || 'Challenge', icon: 'dice' })),
    ...drawings.map((r) => ({ type: 'drawing', id: r.id, day: r.day, at: r.at, title: r.title || 'Canvas drawing', icon: 'color-palette' })),
    ...achievements.map((r) => ({ type: 'achievement', id: r.key, day: r.day, at: r.at, title: achievementByKey[r.key]?.title || r.key, icon: 'trophy' })),
    ...checkins.filter((r) => r.n >= 2).map((r) => ({ type: 'checkin', id: r.month, day: r.day, at: r.at, title: 'Monthly check-in', icon: 'pulse' })),
    ...countdowns.map((r) => ({ type: 'countdown', id: r.id, day: r.day, at: r.at, title: r.title, icon: 'hourglass' })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at));

  const days = {};
  for (const e of events) (days[e.day] = days[e.day] || []).push(e);

  res.json({
    month,
    days: Object.entries(days).sort(([a], [b]) => a.localeCompare(b)).map(([date, evts]) => ({ date, events: evts })),
    total: events.length,
  });
});

export default router;
