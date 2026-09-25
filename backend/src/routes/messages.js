import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import { uploadBase64Image } from '../config/storage.js';
import { notifyUser, userName } from '../models/notify.js';

const router = asyncRouter();

router.use(requireAuth, requirePair);

// Unified text/photo/doodle feed.
router.get('/', async (req, res) => {
  const { rows } = await query('SELECT * FROM messages WHERE pair_id = $1 ORDER BY sent_at ASC', [req.pair.id]);
  // Reactions ride along on each message as [{ emoji, user_id }].
  const { rows: reactions } = rows.length
    ? await query('SELECT message_id, user_id, emoji FROM message_reactions WHERE message_id = ANY($1::uuid[])', [rows.map((m) => m.id)])
    : { rows: [] };
  for (const m of rows) m.reactions = reactions.filter((r) => r.message_id === m.id).map(({ emoji, user_id }) => ({ emoji, user_id }));
  res.json({ messages: rows });
});

router.post('/', async (req, res) => {
  const { type, content, image, strokeData, replyToMessageId } = req.body;
  if (!['text', 'photo', 'doodle'].includes(type)) {
    return res.status(400).json({ error: 'type must be text, photo, or doodle' });
  }

  let imageUrl = null;
  if (type === 'photo') {
    if (!image) return res.status(400).json({ error: 'image is required for photo messages' });
    imageUrl = await uploadBase64Image(image, { prefix: `messages/${req.pair.id}` });
  }

  // Doodles are stored as an SVG path array (stroke_data), never rasterized
  // to an image — the client re-renders them as real react-native-svg paths.
  if (type === 'doodle' && !strokeData) {
    return res.status(400).json({ error: 'strokeData is required for doodle messages' });
  }

  const { rows } = await query(
    `INSERT INTO messages (pair_id, sender_id, type, content, image_url, stroke_data, reply_to_message_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      req.pair.id,
      req.userId,
      type,
      content || null,
      imageUrl,
      type === 'doodle' ? JSON.stringify(strokeData) : null,
      replyToMessageId || null,
    ]
  );

  const message = rows[0];
  message.reactions = [];
  req.app.get('io').to(`pair:${req.pair.id}`).emit('message:new', { message });
  const senderName = await userName(req.userId);
  notifyUser(req.partnerId, 'messages', {
    title: senderName,
    body: type === 'text' ? String(content || '').slice(0, 120) : type === 'photo' ? 'Sent a photo 📷' : 'Sent a doodle 🎨',
  }, { screen: 'Messages' });
  res.status(201).json({ message });
});

router.patch('/:id/seen', async (req, res) => {
  const { rows } = await query(
    `UPDATE messages SET seen_at = now() WHERE id = $1 AND pair_id = $2 AND sender_id != $3 AND seen_at IS NULL RETURNING *`,
    [req.params.id, req.pair.id, req.userId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Message not found or already seen' });
  res.json({ message: rows[0] });
});

// Toggle an emoji reaction on any message in the pair's chat.
router.post('/:id/react', async (req, res) => {
  const emoji = String(req.body?.emoji || '').trim();
  if (!emoji || emoji.length > 16) return res.status(400).json({ error: 'emoji is required' });
  const { rows: msg } = await query('SELECT id, sender_id FROM messages WHERE id = $1 AND pair_id = $2', [req.params.id, req.pair.id]);
  if (!msg[0]) return res.status(404).json({ error: 'Message not found' });

  const { rowCount } = await query('DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3', [
    msg[0].id, req.userId, emoji,
  ]);
  if (rowCount === 0) {
    await query('INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)', [msg[0].id, req.userId, emoji]);
  }
  const { rows: reactions } = await query('SELECT user_id, emoji FROM message_reactions WHERE message_id = $1', [msg[0].id]);
  req.app.get('io').to(`pair:${req.pair.id}`).emit('message:reactions', { messageId: msg[0].id, reactions });
  if (rowCount === 0 && msg[0].sender_id !== req.userId) {
    const name = await userName(req.userId);
    notifyUser(msg[0].sender_id, 'messages', { title: `${name} reacted ${emoji}`, body: 'to your message' }, { screen: 'Messages' });
  }
  res.json({ messageId: msg[0].id, added: rowCount === 0, reactions });
});

export default router;
