import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import { uploadBase64Image } from '../config/storage.js';
import { getUserDeviceTokens } from '../models/pairs.js';
import { sendNotification, deepLink, CHANNELS } from '../config/firebase.js';

const router = asyncRouter();

/**
 * Whose name goes on the notification.
 *
 * The nickname THEY gave the sender, not the sender's own display name. The
 * notification lands on the recipient's phone and should read the way they
 * think of the person — the same rule the rest of the app follows.
 *
 * Never an empty title: on Android that renders as the package name.
 */
async function senderName(pairId, senderId, recipientId) {
  const { rows } = await query(
    `SELECT (SELECT nickname FROM pair_nicknames
              WHERE pair_id = $1 AND set_by_id = $3) AS nickname,
            (SELECT name FROM users WHERE id = $2) AS name`,
    [pairId, senderId, recipientId]
  );
  return rows[0]?.nickname || rows[0]?.name || 'Your partner';
}

router.use(requireAuth, requirePair);

// Unified text/photo/doodle feed.
router.get('/', async (req, res) => {
  const { rows } = await query('SELECT * FROM messages WHERE pair_id = $1 ORDER BY sent_at ASC', [req.pair.id]);
  res.json({ messages: rows });
});

router.post('/', async (req, res) => {
  const { type, content, image, strokeData, replyToMessageId, encrypted } = req.body;
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
  //
  // When the pair has encryption running, the strokes arrive already sealed
  // as a string in `content` instead, and stroke_data is left null. A drawing
  // is as much a message as a sentence is.
  if (type === 'doodle' && !strokeData && !(encrypted && content)) {
    return res.status(400).json({ error: 'strokeData is required for doodle messages' });
  }

  // `encrypted` is a label, not a transformation: the client has already
  // sealed `content` before it got here, and this server could not unseal it
  // if it wanted to. Recording the flag is what lets the reading phone know
  // to try, and lets every message written before encryption existed keep
  // rendering as the plain text it is.
  const { rows } = await query(
    `INSERT INTO messages (pair_id, sender_id, type, content, image_url, stroke_data, reply_to_message_id, encrypted)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [
      req.pair.id,
      req.userId,
      type,
      content || null,
      imageUrl,
      type === 'doodle' && strokeData ? JSON.stringify(strokeData) : null,
      replyToMessageId || null,
      Boolean(encrypted),
    ]
  );

  const message = rows[0];
  req.app.get('io').to(`pair:${req.pair.id}`).emit('message:new', { message });

  // A socket only reaches a phone with the app open. The push is what makes a
  // message arrive on a phone in a pocket — which for the thing people use
  // this app for most is the difference between it working and not.
  //
  // THE BODY IS NEVER IN THE PUSH, and that is not a policy decision the
  // server could change its mind about: when the pair has encryption running,
  // the content is sealed before it leaves the sending phone and the server
  // holds ciphertext. It could not put the message in the notification if it
  // wanted to. So the notification says what KIND of thing arrived, and the
  // phone that can decrypt it shows the rest.
  const preview = {
    text: 'Sent you a message',
    photo: 'Sent you a photo',
    doodle: 'Drew you something',
  }[type] || 'Sent you something';

  const tokens = await getUserDeviceTokens(req.partnerId);
  await sendNotification(
    tokens,
    { title: await senderName(req.pair.id, req.userId, req.partnerId), body: preview },
    deepLink('message', { messageId: message.id }),
    {
      channel: CHANNELS.partner,
      // High priority, because a normal-priority message push can sit in a
      // doze queue for minutes on Android — which for a chat is the same as
      // not sending it.
      priority: 'high',
      // Ten messages in a row should be one line in the tray that updates,
      // not ten. The tag is the pair, so a burst collapses and a reply an
      // hour later still arrives on its own.
      collapseKey: `msg:${req.pair.id}`,
    }
  ).catch((err) => console.error('[messages] push failed:', err.message));

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

export default router;
