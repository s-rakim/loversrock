import { Router } from 'express';
import { query } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, async (req, res) => {
  const { rows } = await query('SELECT * FROM games_catalog ORDER BY sort_order');
  res.json({ games: rows });
});

export default router;
