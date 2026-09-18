import { Router } from 'express';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth, requirePair);

// Auto-archives passed dates on read, rather than relying solely on cron,
// so the list is always correct even between cron ticks.
router.get('/', async (req, res) => {
  await query(
    `UPDATE countdowns SET auto_archived = TRUE WHERE pair_id = $1 AND target_date < now() AND auto_archived = FALSE`,
    [req.pair.id]
  );
  const { rows } = await query(
    'SELECT * FROM countdowns WHERE pair_id = $1 AND auto_archived = FALSE ORDER BY target_date ASC',
    [req.pair.id]
  );
  res.json({ countdowns: rows });
});

router.get('/archived', async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM countdowns WHERE pair_id = $1 AND auto_archived = TRUE ORDER BY target_date DESC',
    [req.pair.id]
  );
  res.json({ countdowns: rows });
});

router.post('/', async (req, res) => {
  const { targetDate, label } = req.body;
  if (!targetDate || !label) return res.status(400).json({ error: 'targetDate and label are required' });

  const { rows } = await query(
    `INSERT INTO countdowns (pair_id, target_date, label, created_by) VALUES ($1, $2, $3, $4) RETURNING *`,
    [req.pair.id, targetDate, label, req.userId]
  );
  res.status(201).json({ countdown: rows[0] });
});

router.delete('/:id', async (req, res) => {
  const { rowCount } = await query('DELETE FROM countdowns WHERE id = $1 AND pair_id = $2', [
    req.params.id,
    req.pair.id,
  ]);
  if (rowCount === 0) return res.status(404).json({ error: 'Countdown not found' });
  res.status(204).end();
});

export default router;
