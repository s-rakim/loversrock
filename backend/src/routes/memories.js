import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import { uploadBase64Image } from '../config/storage.js';

const router = asyncRouter();

router.use(requireAuth, requirePair);

router.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM memories WHERE pair_id = $1 AND deleted_at IS NULL ORDER BY taken_at DESC`,
    [req.pair.id]
  );
  res.json({ memories: rows });
});

router.post('/', async (req, res) => {
  const { image, caption, takenAt } = req.body;
  if (!image) return res.status(400).json({ error: 'image (base64 data URL) is required' });

  const key = await uploadBase64Image(image, { prefix: `memories/${req.pair.id}` });

  const { rows } = await query(
    `INSERT INTO memories (pair_id, image_url, caption, taken_at, created_by, source)
     VALUES ($1, $2, $3, COALESCE($4, now()), $5, 'manual')
     RETURNING *`,
    [req.pair.id, key, caption || null, takenAt || null, req.userId]
  );

  res.status(201).json({ memory: rows[0] });
});

router.patch('/:id', async (req, res) => {
  const { caption, takenAt, deleted } = req.body;

  const { rows: existing } = await query('SELECT * FROM memories WHERE id = $1 AND pair_id = $2', [
    req.params.id,
    req.pair.id,
  ]);
  if (!existing[0]) return res.status(404).json({ error: 'Memory not found' });

  const { rows } = await query(
    `UPDATE memories SET
       caption = COALESCE($1, caption),
       taken_at = COALESCE($2, taken_at),
       deleted_at = CASE WHEN $3::boolean IS TRUE THEN now() WHEN $3::boolean IS FALSE THEN NULL ELSE deleted_at END
     WHERE id = $4 AND pair_id = $5
     RETURNING *`,
    [caption ?? null, takenAt ?? null, deleted ?? null, req.params.id, req.pair.id]
  );

  res.json({ memory: rows[0] });
});

// Either partner can restore, within the 30-day soft-delete window (the
// nightly cron hard-deletes anything older — see backend/src/cron/index.js).
router.post('/:id/restore', async (req, res) => {
  const { rows: existing } = await query(
    `SELECT * FROM memories WHERE id = $1 AND pair_id = $2 AND deleted_at IS NOT NULL AND deleted_at > now() - interval '30 days'`,
    [req.params.id, req.pair.id]
  );
  if (!existing[0]) return res.status(404).json({ error: 'Memory not found or past restore window' });

  const { rows } = await query('UPDATE memories SET deleted_at = NULL WHERE id = $1 RETURNING *', [req.params.id]);
  res.json({ memory: rows[0] });
});

export default router;
