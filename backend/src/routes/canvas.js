import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import { notifyUser, userName } from '../models/notify.js';

const router = asyncRouter();

router.use(requireAuth, requirePair);

const MAX_STROKES = 2000;
const HEX = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

// A stroke is { color, width, points: [{x, y}], tool?: 'pen'|'eraser' }.
// Coordinates are normalised 0..1 of the canvas, so two phones with
// different screen sizes draw on the same picture.
function validStroke(s) {
  return (
    s && typeof s === 'object' && Array.isArray(s.points) && s.points.length >= 1 && s.points.length <= 5000 &&
    s.points.every((p) => typeof p?.x === 'number' && typeof p?.y === 'number') &&
    (s.color === undefined || HEX.test(s.color)) &&
    (s.width === undefined || (typeof s.width === 'number' && s.width > 0 && s.width <= 0.2))
  );
}

async function ensureCanvas(pairId) {
  await query('INSERT INTO pair_canvas (pair_id) VALUES ($1) ON CONFLICT DO NOTHING', [pairId]);
  const { rows } = await query('SELECT * FROM pair_canvas WHERE pair_id = $1', [pairId]);
  return rows[0];
}

// The one shared live canvas both partners draw on.
router.get('/', async (req, res) => {
  res.json({ canvas: await ensureCanvas(req.pair.id) });
});

// Appends strokes and fans them out live to the partner.
router.post('/strokes', async (req, res) => {
  const incoming = req.body?.strokes;
  if (!Array.isArray(incoming) || incoming.length === 0 || !incoming.every(validStroke)) {
    return res.status(400).json({ error: 'strokes must be a non-empty array of { color, width, points:[{x,y}] }' });
  }
  // Tagged server-side with the author so undo only ever removes your own.
  const strokes = incoming.map((s) => ({ color: s.color, width: s.width, tool: s.tool, points: s.points, by: req.userId }));
  const canvas = await ensureCanvas(req.pair.id);
  if (canvas.strokes.length + strokes.length > MAX_STROKES) {
    return res.status(413).json({ error: 'Canvas is full — save it to the gallery and clear it' });
  }
  const { rows } = await query(
    `UPDATE pair_canvas SET strokes = strokes || $1::jsonb, updated_by = $2, updated_at = now()
     WHERE pair_id = $3 RETURNING jsonb_array_length(strokes) AS count, updated_at`,
    [JSON.stringify(strokes), req.userId, req.pair.id]
  );
  req.app.get('io').to(`pair:${req.pair.id}`).emit('canvas:strokes', { strokes, fromUserId: req.userId });

  // One "partner is drawing" push per 30 minutes at most, not per stroke.
  const idleMs = Date.now() - new Date(canvas.updated_at).getTime();
  if (canvas.updated_by !== req.userId || idleMs > 30 * 60 * 1000) {
    const name = await userName(req.userId);
    notifyUser(req.partnerId, 'canvas', { title: `${name} is drawing on your Canvas 🎨`, body: 'Open it to see.' }, { screen: 'SharedCanvas' });
  }
  res.status(201).json({ count: rows[0].count, updatedAt: rows[0].updated_at });
});

// Undo removes the caller's own most recent stroke only.
router.post('/undo', async (req, res) => {
  const canvas = await ensureCanvas(req.pair.id);
  const strokes = canvas.strokes;
  let idx = -1;
  for (let i = strokes.length - 1; i >= 0; i -= 1) {
    if (strokes[i].by === req.userId) { idx = i; break; }
  }
  if (idx === -1) return res.status(404).json({ error: 'Nothing of yours to undo' });
  strokes.splice(idx, 1);
  await query('UPDATE pair_canvas SET strokes = $1::jsonb, updated_at = now() WHERE pair_id = $2', [JSON.stringify(strokes), req.pair.id]);
  req.app.get('io').to(`pair:${req.pair.id}`).emit('canvas:reset', { strokes, background: canvas.background });
  res.json({ strokes });
});

router.patch('/', async (req, res) => {
  const { background } = req.body || {};
  if (!HEX.test(background || '')) return res.status(400).json({ error: 'background must be a hex colour' });
  await ensureCanvas(req.pair.id);
  const { rows } = await query('UPDATE pair_canvas SET background = $1, updated_at = now() WHERE pair_id = $2 RETURNING *', [
    background, req.pair.id,
  ]);
  req.app.get('io').to(`pair:${req.pair.id}`).emit('canvas:reset', { strokes: rows[0].strokes, background });
  res.json({ canvas: rows[0] });
});

router.delete('/', async (req, res) => {
  await ensureCanvas(req.pair.id);
  await query(`UPDATE pair_canvas SET strokes = '[]'::jsonb, updated_by = $1, updated_at = now() WHERE pair_id = $2`, [
    req.userId, req.pair.id,
  ]);
  req.app.get('io').to(`pair:${req.pair.id}`).emit('canvas:reset', { strokes: [] });
  res.status(204).end();
});

// Snapshot the live canvas into the gallery (optionally clearing it).
router.post('/save', async (req, res) => {
  const { title, clear } = req.body || {};
  const canvas = await ensureCanvas(req.pair.id);
  if (canvas.strokes.length === 0) return res.status(400).json({ error: 'The canvas is empty' });
  const { rows } = await query(
    `INSERT INTO canvas_drawings (pair_id, created_by, title, strokes, background) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [req.pair.id, req.userId, title?.trim() || null, JSON.stringify(canvas.strokes), canvas.background]
  );
  if (clear) {
    await query(`UPDATE pair_canvas SET strokes = '[]'::jsonb, updated_at = now() WHERE pair_id = $1`, [req.pair.id]);
    req.app.get('io').to(`pair:${req.pair.id}`).emit('canvas:reset', { strokes: [] });
  }
  res.status(201).json({ drawing: rows[0] });
});

router.get('/gallery', async (req, res) => {
  const { rows } = await query(
    `SELECT d.*, u.name AS created_by_name FROM canvas_drawings d JOIN users u ON u.id = d.created_by
     WHERE d.pair_id = $1 ORDER BY d.created_at DESC`,
    [req.pair.id]
  );
  res.json({ drawings: rows });
});

router.delete('/gallery/:id', async (req, res) => {
  const { rowCount } = await query('DELETE FROM canvas_drawings WHERE id = $1 AND pair_id = $2', [req.params.id, req.pair.id]);
  if (rowCount === 0) return res.status(404).json({ error: 'Drawing not found' });
  res.status(204).end();
});

// Load a gallery drawing back onto the live canvas to keep working on it.
router.post('/gallery/:id/restore', async (req, res) => {
  const { rows } = await query('SELECT * FROM canvas_drawings WHERE id = $1 AND pair_id = $2', [req.params.id, req.pair.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Drawing not found' });
  await ensureCanvas(req.pair.id);
  await query('UPDATE pair_canvas SET strokes = $1::jsonb, background = $2, updated_by = $3, updated_at = now() WHERE pair_id = $4', [
    JSON.stringify(rows[0].strokes), rows[0].background, req.userId, req.pair.id,
  ]);
  req.app.get('io').to(`pair:${req.pair.id}`).emit('canvas:reset', { strokes: rows[0].strokes, background: rows[0].background });
  res.json({ strokes: rows[0].strokes, background: rows[0].background });
});

export { validStroke };
export default router;
