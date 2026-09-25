import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import { notifyUser, userName } from '../models/notify.js';

const router = asyncRouter();

router.use(requireAuth, requirePair);

// Secret messages: the recipient's widget says "You have a message ❤️" and
// only opening it in the app reveals the text. The body is never included in
// a push or the widget summary — a lock screen is not private.
router.get('/', async (req, res) => {
  const { rows: inbox } = await query(
    `SELECT id, sender_id, created_at, opened_at,
            CASE WHEN opened_at IS NOT NULL THEN body END AS body
     FROM secret_messages WHERE pair_id = $1 AND sender_id = $2 ORDER BY created_at DESC LIMIT 50`,
    [req.pair.id, req.partnerId]
  );
  const { rows: sent } = await query(
    `SELECT id, body, created_at, opened_at FROM secret_messages
     WHERE pair_id = $1 AND sender_id = $2 ORDER BY created_at DESC LIMIT 50`,
    [req.pair.id, req.userId]
  );
  res.json({ inbox, sent, unopened: inbox.filter((m) => !m.opened_at).length });
});

router.post('/', async (req, res) => {
  const body = req.body?.body?.trim();
  if (!body) return res.status(400).json({ error: 'body is required' });
  if (body.length > 1000) return res.status(400).json({ error: 'Keep it under 1000 characters' });
  const { rows } = await query(
    'INSERT INTO secret_messages (pair_id, sender_id, body) VALUES ($1, $2, $3) RETURNING id, body, created_at, opened_at',
    [req.pair.id, req.userId, body]
  );
  req.app.get('io').to(`pair:${req.pair.id}`).emit('secret:new', { id: rows[0].id, senderId: req.userId });
  const name = await userName(req.userId);
  notifyUser(req.partnerId, 'secret', { title: 'You have a message ❤️', body: `${name} left you something. Open it in the app.` }, {
    screen: 'SecretMessage',
  });
  res.status(201).json({ secret: rows[0] });
});

router.post('/:id/open', async (req, res) => {
  const { rows } = await query(
    `UPDATE secret_messages SET opened_at = COALESCE(opened_at, now())
     WHERE id = $1 AND pair_id = $2 AND sender_id = $3
     RETURNING id, body, created_at, opened_at`,
    [req.params.id, req.pair.id, req.partnerId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Secret message not found' });
  req.app.get('io').to(`pair:${req.pair.id}`).emit('secret:opened', { id: rows[0].id });
  res.json({ secret: rows[0] });
});

export default router;
