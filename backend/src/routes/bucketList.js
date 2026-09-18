import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import { uploadBase64Image } from '../config/storage.js';

const router = asyncRouter();

router.use(requireAuth, requirePair);

router.get('/', async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM bucket_list_items WHERE pair_id = $1 ORDER BY is_completed, created_at DESC',
    [req.pair.id]
  );
  res.json({ items: rows });
});

router.post('/', async (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });

  const { rows } = await query(
    `INSERT INTO bucket_list_items (pair_id, title, created_by) VALUES ($1, $2, $3) RETURNING *`,
    [req.pair.id, title, req.userId]
  );

  const item = rows[0];
  req.app.get('io').to(`pair:${req.pair.id}`).emit('bucket:update', { item, action: 'created' });
  res.status(201).json({ item });
});

router.patch('/:id', async (req, res) => {
  const { title, isCompleted } = req.body;

  const { rows } = await query(
    `UPDATE bucket_list_items SET
       title = COALESCE($1, title),
       is_completed = COALESCE($2, is_completed),
       completed_at = CASE WHEN $2 IS TRUE THEN now() WHEN $2 IS FALSE THEN NULL ELSE completed_at END
     WHERE id = $3 AND pair_id = $4
     RETURNING *`,
    [title ?? null, isCompleted ?? null, req.params.id, req.pair.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Item not found' });

  req.app.get('io').to(`pair:${req.pair.id}`).emit('bucket:update', { item: rows[0], action: 'updated' });
  res.json({ item: rows[0] });
});

// Converts a completed bucket-list item into a memory. Requires the caller
// to already have uploaded a photo for it (image is required here, same as
// POST /memories) since a bucket-list item has no photo of its own.
router.post('/:id/convert-to-memory', async (req, res) => {
  const { image, caption } = req.body;
  if (!image) return res.status(400).json({ error: 'image (base64 data URL) is required' });

  const { rows: items } = await query('SELECT * FROM bucket_list_items WHERE id = $1 AND pair_id = $2', [
    req.params.id,
    req.pair.id,
  ]);
  const item = items[0];
  if (!item) return res.status(404).json({ error: 'Item not found' });

  const key = await uploadBase64Image(image, { prefix: `memories/${req.pair.id}` });

  const { rows: memoryRows } = await query(
    `INSERT INTO memories (pair_id, image_url, caption, taken_at, created_by, source)
     VALUES ($1, $2, $3, now(), $4, 'manual') RETURNING *`,
    [req.pair.id, key, caption || item.title, req.userId]
  );

  await query(
    `UPDATE bucket_list_items SET is_completed = TRUE, completed_at = now() WHERE id = $1`,
    [item.id]
  );

  res.status(201).json({ memory: memoryRows[0] });
});

export default router;
