import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import { notifyUser, userName } from '../models/notify.js';

const router = asyncRouter();

router.use(requireAuth, requirePair);

// Shared notes. Both partners can read every note; only the author edits it.
router.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT n.*, u.name AS author_name FROM notes n JOIN users u ON u.id = n.author_id
     WHERE n.pair_id = $1 ORDER BY n.is_pinned DESC, n.updated_at DESC`,
    [req.pair.id]
  );
  res.json({ notes: rows });
});

router.post('/', async (req, res) => {
  const { title, body, color } = req.body || {};
  if (!body?.trim()) return res.status(400).json({ error: 'body is required' });
  const { rows } = await query(
    `INSERT INTO notes (pair_id, author_id, title, body, color) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [req.pair.id, req.userId, title?.trim() || null, body.trim(), color || null]
  );
  const name = await userName(req.userId);
  const note = { ...rows[0], author_name: name };
  req.app.get('io').to(`pair:${req.pair.id}`).emit('note:update', { note, action: 'created' });
  notifyUser(req.partnerId, 'notes', { title: `${name} left you a note 💌`, body: note.title || note.body.slice(0, 80) }, { screen: 'Notes' });
  res.status(201).json({ note });
});

router.patch('/:id', async (req, res) => {
  const { title, body, color, isPinned } = req.body || {};
  const { rows: existing } = await query('SELECT * FROM notes WHERE id = $1 AND pair_id = $2', [req.params.id, req.pair.id]);
  const note = existing[0];
  if (!note) return res.status(404).json({ error: 'Note not found' });
  // Pinning is shared; editing words belongs to the author.
  if ((title !== undefined || body !== undefined || color !== undefined) && note.author_id !== req.userId) {
    return res.status(403).json({ error: 'Only the author can edit this note' });
  }
  if (body !== undefined && !String(body).trim()) return res.status(400).json({ error: 'body cannot be empty' });

  const { rows } = await query(
    `UPDATE notes SET
       title = CASE WHEN $1::boolean THEN $2 ELSE title END,
       body = COALESCE($3, body),
       color = CASE WHEN $4::boolean THEN $5 ELSE color END,
       is_pinned = COALESCE($6, is_pinned),
       updated_at = now()
     WHERE id = $7 RETURNING *`,
    [title !== undefined, title?.trim() || null, body?.trim() ?? null, color !== undefined, color ?? null, isPinned ?? null, note.id]
  );
  req.app.get('io').to(`pair:${req.pair.id}`).emit('note:update', { note: rows[0], action: 'updated' });
  res.json({ note: rows[0] });
});

router.delete('/:id', async (req, res) => {
  const { rowCount } = await query('DELETE FROM notes WHERE id = $1 AND pair_id = $2 AND author_id = $3', [
    req.params.id, req.pair.id, req.userId,
  ]);
  if (rowCount === 0) return res.status(404).json({ error: 'Note not found (you can only delete your own)' });
  req.app.get('io').to(`pair:${req.pair.id}`).emit('note:update', { noteId: req.params.id, action: 'deleted' });
  res.status(204).end();
});

export default router;
