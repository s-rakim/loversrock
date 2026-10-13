import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import { pairLocalDateString } from '../models/pairs.js';
import { notifyUser, userName } from '../models/notify.js';
import { isoWeek } from '../lib/seedData.js';

const router = asyncRouter();

router.use(requireAuth, requirePair);

const WEEKLY_DECK_SIZE = 20;
const STATUSES = ['idea', 'planned', 'confirmed', 'done', 'cancelled'];

// This week's swipe deck. Tailored to the pair's setting (city, suburbs,
// rural, long-distance), refreshed every ISO week, and never re-shows an idea
// you've already swiped. Premium ideas appear once the pair unlocks them.
router.get('/discover', async (req, res) => {
  const week = isoWeek(pairLocalDateString(req.pair));
  const setting = req.query.setting || req.pair.date_setting || null;
  const { rows: unlock } = await query(`SELECT 1 FROM pair_unlocks WHERE pair_id = $1 AND item_key = 'dates:premium'`, [req.pair.id]);
  const premiumUnlocked = Boolean(unlock[0]);

  const { rows } = await query(
    `SELECT d.* FROM date_ideas d
     WHERE d.pair_id IS NULL
       AND ($2::text IS NULL OR d.settings IS NULL OR d.settings ? $2)
       AND ($3::boolean OR d.is_premium = FALSE)
       AND NOT EXISTS (SELECT 1 FROM date_idea_votes v WHERE v.idea_id = d.id AND v.user_id = $1)
     ORDER BY md5(d.id::text || $4) LIMIT $5`,
    [req.userId, setting, premiumUnlocked, `${req.pair.id}:${week}`, WEEKLY_DECK_SIZE]
  );
  const { rows: premiumCount } = await query('SELECT COUNT(*)::int AS n FROM date_ideas WHERE pair_id IS NULL AND is_premium');

  res.json({ week, setting, premiumUnlocked, premiumAvailable: premiumCount[0].n, ideas: rows });
});

// Swipe right/left. Two rights on the same idea is a match.
router.post('/ideas/:id/vote', async (req, res) => {
  const { liked } = req.body || {};
  if (typeof liked !== 'boolean') return res.status(400).json({ error: 'liked must be a boolean' });
  const { rows: idea } = await query('SELECT * FROM date_ideas WHERE id = $1 AND (pair_id IS NULL OR pair_id = $2)', [
    req.params.id, req.pair.id,
  ]);
  if (!idea[0]) return res.status(404).json({ error: 'Date idea not found' });

  await query(
    `INSERT INTO date_idea_votes (pair_id, user_id, idea_id, liked) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, idea_id) DO UPDATE SET liked = EXCLUDED.liked, created_at = now()`,
    [req.pair.id, req.userId, idea[0].id, liked]
  );

  let match = false;
  if (liked) {
    const { rows } = await query('SELECT 1 FROM date_idea_votes WHERE pair_id = $1 AND user_id = $2 AND idea_id = $3 AND liked', [
      req.pair.id, req.partnerId, idea[0].id,
    ]);
    match = Boolean(rows[0]);
  }
  if (match) {
    req.app.get('io').to(`pair:${req.pair.id}`).emit('dates:match', { idea: idea[0] });
    for (const uid of [req.userId, req.partnerId]) {
      notifyUser(uid, 'dates', { title: "It's a match! ❤️", body: `You both want to: ${idea[0].title}` }, { screen: 'DateMatches' });
    }
  }
  res.json({ match, idea: idea[0] });
});

router.get('/matches', async (req, res) => {
  const { rows } = await query(
    `SELECT d.*, MAX(v.created_at) AS matched_at,
            EXISTS (SELECT 1 FROM date_plans p WHERE p.pair_id = $1 AND p.idea_id = d.id AND p.status <> 'cancelled') AS planned
     FROM date_idea_votes v JOIN date_ideas d ON d.id = v.idea_id
     WHERE v.pair_id = $1 AND v.liked
     GROUP BY d.id HAVING COUNT(DISTINCT v.user_id) >= 2
     ORDER BY matched_at DESC`,
    [req.pair.id]
  );
  res.json({ matches: rows });
});

// Scheduling with statuses: idea → planned → confirmed → done (or cancelled).
router.get('/plans', async (req, res) => {
  const { rows } = await query(
    `SELECT p.*, d.description AS idea_description, d.category AS idea_category, d.cost_tier AS idea_cost_tier
     FROM date_plans p LEFT JOIN date_ideas d ON d.id = p.idea_id
     WHERE p.pair_id = $1
     ORDER BY (p.status IN ('done', 'cancelled')), p.scheduled_for NULLS LAST, p.created_at DESC`,
    [req.pair.id]
  );
  res.json({ plans: rows });
});

router.get('/next', async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM date_plans WHERE pair_id = $1 AND status IN ('planned', 'confirmed') AND scheduled_for > now()
     ORDER BY scheduled_for ASC LIMIT 1`,
    [req.pair.id]
  );
  res.json({ plan: rows[0] || null });
});

router.post('/plans', async (req, res) => {
  const { ideaId, title, notes, scheduledFor, status = 'planned' } = req.body || {};
  if (!STATUSES.includes(status)) return res.status(400).json({ error: `status must be one of ${STATUSES.join(', ')}` });
  if (scheduledFor && Number.isNaN(new Date(scheduledFor).getTime())) return res.status(400).json({ error: 'scheduledFor must be a date' });

  let planTitle = title?.trim();
  if (ideaId) {
    const { rows } = await query('SELECT title FROM date_ideas WHERE id = $1 AND (pair_id IS NULL OR pair_id = $2)', [ideaId, req.pair.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Date idea not found' });
    planTitle = planTitle || rows[0].title;
  }
  if (!planTitle) return res.status(400).json({ error: 'title or ideaId is required' });

  const { rows } = await query(
    `INSERT INTO date_plans (pair_id, idea_id, title, notes, scheduled_for, status, created_by, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $6 = 'done' THEN now() END) RETURNING *`,
    [req.pair.id, ideaId || null, planTitle, notes || null, scheduledFor || null, status, req.userId]
  );
  req.app.get('io').to(`pair:${req.pair.id}`).emit('dates:plan', { plan: rows[0], action: 'created' });
  if (rows[0].scheduled_for) {
    const name = await userName(req.userId);
    const when = new Date(rows[0].scheduled_for).toDateString();
    notifyUser(req.partnerId, 'dates', { title: `${name} planned a date 📅`, body: `${planTitle} — ${when}` }, { screen: 'DatePlans' });
  }
  res.status(201).json({ plan: rows[0] });
});

router.patch('/plans/:id', async (req, res) => {
  const { title, notes, scheduledFor, status } = req.body || {};
  if (status !== undefined && !STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${STATUSES.join(', ')}` });
  }
  const { rows } = await query(
    `UPDATE date_plans SET
       title = COALESCE($1, title),
       notes = CASE WHEN $2::boolean THEN $3 ELSE notes END,
       scheduled_for = CASE WHEN $4::boolean THEN $5::timestamptz ELSE scheduled_for END,
       status = COALESCE($6, status),
       completed_at = CASE WHEN $6 = 'done' THEN COALESCE(completed_at, now()) WHEN $6 IS NOT NULL THEN NULL ELSE completed_at END
     WHERE id = $7 AND pair_id = $8 RETURNING *`,
    [title?.trim() || null, notes !== undefined, notes ?? null, scheduledFor !== undefined, scheduledFor ?? null, status ?? null, req.params.id, req.pair.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Date plan not found' });
  req.app.get('io').to(`pair:${req.pair.id}`).emit('dates:plan', { plan: rows[0], action: 'updated' });
  res.json({ plan: rows[0] });
});

router.delete('/plans/:id', async (req, res) => {
  const { rowCount } = await query('DELETE FROM date_plans WHERE id = $1 AND pair_id = $2', [req.params.id, req.pair.id]);
  if (rowCount === 0) return res.status(404).json({ error: 'Date plan not found' });
  res.status(204).end();
});

export default router;
