// The canvas gallery.
//
// A drawing used to have exactly one destination: the message thread, where
// it scrolled away and was gone. That is the wrong home for the thing people
// actually spend twenty minutes on. Here a drawing is kept, titled, pinned,
// and — the part that makes it worth building — REOPENED, so the other person
// can add to it and hand it back.
//
// The list deliberately does not return stroke data. A gallery of thirty
// drawings is thirty jsonb blobs of a few hundred kilobytes each, and the
// grid only needs a thumbnail's worth. `/:id` fetches the strokes for the one
// being opened.
import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import { normalizeDrawing, normalizeTitle, LIMITS } from '../models/canvas.js';

const router = asyncRouter();

router.use(requireAuth, requirePair);

// Enough of the strokes for a thumbnail, none of the weight.
//
// The first 40 strokes of a drawing are what it looked like when it was
// mostly finished — detail comes last — so a preview drawn from them reads as
// the real thing rather than a fragment.
const PREVIEW_STROKES = 40;

const LIST_COLUMNS = `
  id, title, canvas_color, pinned, created_by, updated_by, created_at, updated_at,
  jsonb_array_length(stroke_data -> 'strokes') AS stroke_count,
  jsonb_path_query_array(stroke_data -> 'strokes', '$[0 to ${PREVIEW_STROKES - 1}]') AS preview
`;

router.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT ${LIST_COLUMNS} FROM canvas_drawings
     WHERE pair_id = $1
     ORDER BY pinned DESC, updated_at DESC
     LIMIT 200`,
    [req.pair.id]
  );
  res.json({ drawings: rows });
});

router.get('/:id', async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM canvas_drawings WHERE id = $1 AND pair_id = $2',
    [req.params.id, req.pair.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Drawing not found' });
  res.json({ drawing: rows[0] });
});

router.post('/', async (req, res) => {
  const { strokeData, canvasColor, title } = req.body;
  const drawing = normalizeDrawing(strokeData, canvasColor);
  if (!drawing.ok) return res.status(400).json({ error: drawing.error });

  const { rows } = await query(
    `INSERT INTO canvas_drawings (pair_id, created_by, updated_by, title, stroke_data, canvas_color)
     VALUES ($1, $2, $2, $3, $4, $5)
     RETURNING id, title, canvas_color, pinned, created_by, updated_by, created_at, updated_at`,
    [req.pair.id, req.userId, normalizeTitle(title),
      JSON.stringify({ strokes: drawing.value.strokes }), drawing.value.canvasColor]
  );

  // The other phone finds out a drawing arrived without having to reopen the
  // gallery — the whole point of a shared canvas is that it is shared now.
  req.app.get('io')?.to(`pair:${req.pair.id}`)
    .emit('canvas:saved', { drawing: rows[0], by: req.userId });

  res.status(201).json({ drawing: rows[0] });
});

// A drawing either of you can keep adding to.
//
// The whole stroke list is replaced rather than appended to, because the
// editor supports undo and erasing: "what it looks like now" is the only
// thing either side can agree on, and a diff of strokes would let two people
// undo each other into a state neither of them drew.
router.put('/:id', async (req, res) => {
  const { strokeData, canvasColor, title } = req.body;

  const existing = await query(
    'SELECT canvas_color FROM canvas_drawings WHERE id = $1 AND pair_id = $2',
    [req.params.id, req.pair.id]
  );
  if (!existing.rows[0]) return res.status(404).json({ error: 'Drawing not found' });

  const drawing = normalizeDrawing(strokeData, canvasColor ?? existing.rows[0].canvas_color);
  if (!drawing.ok) return res.status(400).json({ error: drawing.error });

  const { rows } = await query(
    `UPDATE canvas_drawings
     SET stroke_data = $3, canvas_color = $4,
         title = COALESCE($5, title),
         updated_by = $6, updated_at = now()
     WHERE id = $1 AND pair_id = $2
     RETURNING id, title, canvas_color, pinned, created_by, updated_by, created_at, updated_at`,
    [req.params.id, req.pair.id,
      JSON.stringify({ strokes: drawing.value.strokes }), drawing.value.canvasColor,
      normalizeTitle(title), req.userId]
  );

  req.app.get('io')?.to(`pair:${req.pair.id}`)
    .emit('canvas:saved', { drawing: rows[0], by: req.userId });

  res.json({ drawing: rows[0] });
});

router.patch('/:id', async (req, res) => {
  const { title, pinned } = req.body;
  const { rows } = await query(
    `UPDATE canvas_drawings
     SET title = CASE WHEN $3::boolean THEN $4 ELSE title END,
         pinned = COALESCE($5, pinned)
     WHERE id = $1 AND pair_id = $2
     RETURNING id, title, canvas_color, pinned, created_by, updated_by, created_at, updated_at`,
    // `title` is distinguished from "title not sent" by a flag rather than by
    // null, so that clearing a title back to nothing is possible at all.
    [req.params.id, req.pair.id,
      Object.prototype.hasOwnProperty.call(req.body, 'title'), normalizeTitle(title),
      typeof pinned === 'boolean' ? pinned : null]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Drawing not found' });
  res.json({ drawing: rows[0] });
});

router.delete('/:id', async (req, res) => {
  const { rowCount } = await query(
    'DELETE FROM canvas_drawings WHERE id = $1 AND pair_id = $2',
    [req.params.id, req.pair.id]
  );
  if (rowCount === 0) return res.status(404).json({ error: 'Drawing not found' });
  req.app.get('io')?.to(`pair:${req.pair.id}`).emit('canvas:deleted', { id: req.params.id });
  res.status(204).end();
});

router.get('/meta/limits', (req, res) => res.json({ limits: LIMITS }));

export default router;
