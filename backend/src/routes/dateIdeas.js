import { Router } from 'express';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';

const router = Router();

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

export default router;
