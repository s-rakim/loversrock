import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import { uploadBase64Image, deleteObject } from '../config/storage.js';
import { getUserDeviceTokens, getPairById, otherUserId } from '../models/pairs.js';
import { getIo } from '../sockets/index.js';
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
export async function senderName(pairId, senderId, recipientId) {
  const { rows } = await query(
    `SELECT (SELECT nickname FROM pair_nicknames
              WHERE pair_id = $1 AND set_by_id = $3) AS nickname,
            (SELECT name FROM users WHERE id = $2) AS name`,
    [pairId, senderId, recipientId]
  );
  return rows[0]?.nickname || rows[0]?.name || 'Your partner';
}

router.use(requireAuth, requirePair);

// What the chat can carry. Polls and locations keep their body in `content`
// like a text, so encryption covers them the same way.
export const MESSAGE_TYPES = ['text', 'photo', 'doodle', 'poll', 'location'];

// How long after sending a text can still be edited. The same day as
// Nextcloud Talk gives you: long enough to fix a typo you spot later, short
// enough that an old conversation stays what it was.
export const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

// How far ahead a message can be scheduled.
const MAX_SCHEDULE_MS = 366 * 24 * 60 * 60 * 1000;

const PREVIEW = {
  text: 'Sent you a message',
  photo: 'Sent you a photo',
  doodle: 'Drew you something',
  poll: 'Asked you something',
  location: 'Shared a place with you',
};

const io = (req) => req.app.get('io');

/**
 * Reactions, poll votes and (for `userId`) your own reminder, attached to
 * each message. Two or three queries for the whole page rather than one per
 * bubble.
 */
export async function hydrate(rows, userId) {
  if (!rows.length) return rows;
  const ids = rows.map((m) => m.id);
  const [{ rows: reactions }, { rows: votes }, { rows: reminders }] = await Promise.all([
    query(
      `SELECT target_id, user_id, emoji FROM reactions
        WHERE target_kind = 'message' AND target_id = ANY($1::uuid[])`,
      [ids]
    ),
    query('SELECT message_id, user_id, choice FROM poll_votes WHERE message_id = ANY($1::uuid[])', [ids]),
    userId
      ? query('SELECT message_id, remind_at FROM message_reminders WHERE user_id = $1 AND message_id = ANY($2::uuid[])', [userId, ids])
      : Promise.resolve({ rows: [] }),
  ]);
  const group = (list, key, map) => {
    const out = new Map();
    for (const r of list) {
      if (!out.has(r[key])) out.set(r[key], []);
      out.get(r[key]).push(map(r));
    }
    return out;
  };
  const reactionsOf = group(reactions, 'target_id', (r) => ({ userId: r.user_id, emoji: r.emoji }));
  const votesOf = group(votes, 'message_id', (v) => ({ userId: v.user_id, choice: v.choice }));
  const reminderOf = new Map(reminders.map((r) => [r.message_id, r.remind_at]));
  return rows.map((m) => ({
    ...m,
    reactions: reactionsOf.get(m.id) || [],
    ...(m.type === 'poll' ? { votes: votesOf.get(m.id) || [] } : {}),
    ...(userId ? { reminder: reminderOf.get(m.id) || null } : {}),
  }));
}

async function messageInPair(id, pairId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
  const { rows } = await query('SELECT * FROM messages WHERE id = $1 AND pair_id = $2', [id, pairId]);
  return rows[0] || null;
}

/** Tell both phones a message changed (edited, deleted, voted on, pinned). */
async function broadcastUpdate(ioServer, message) {
  if (!ioServer || message.scheduled_for) return;
  const [full] = await hydrate([message], null);
  ioServer.to(`pair:${message.pair_id}`).emit('message:updated', { message: full });
}

/**
 * A message has arrived: the other phone hears it on the socket if the app
 * is open, and as a push if it is not.
 *
 * THE BODY IS NEVER IN THE PUSH, and that is not a policy decision the
 * server could change its mind about: when the pair has encryption running,
 * the content is sealed before it leaves the sending phone and the server
 * holds ciphertext. So the notification says what KIND of thing arrived, and
 * the phone that can decrypt it shows the rest.
 */
export async function announce(ioServer, message, partnerId) {
  const [full] = await hydrate([message], null);
  ioServer?.to(`pair:${message.pair_id}`).emit('message:new', { message: full });
  if (message.silent) return;     // "Send without notification"
  const tokens = await getUserDeviceTokens(partnerId);
  await sendNotification(
    tokens,
    { title: await senderName(message.pair_id, message.sender_id, partnerId), body: PREVIEW[message.type] || 'Sent you something' },
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
      collapseKey: `msg:${message.pair_id}`,
    }
  ).catch((err) => console.error('[messages] push failed:', err.message));
}

/**
 * Checks a poll or a location the server can read, and works out the poll's
 * meta. A sealed one cannot be read, so the sending phone states the number
 * of options (`poll.options`) and the server holds it to that.
 */
function shapeOf(type, content, encrypted, poll) {
  if (type === 'poll') {
    let optionCount = Number(poll?.options);
    let multi = Boolean(poll?.multi);
    if (!encrypted) {
      let parsed = null;
      try { parsed = JSON.parse(content); } catch { /* checked below */ }
      const options = Array.isArray(parsed?.options) ? parsed.options.filter((o) => String(o || '').trim()) : [];
      if (!String(parsed?.question || '').trim()) return { error: 'A poll needs a question' };
      optionCount = options.length;
      multi = Boolean(parsed.multi ?? multi);
    }
    if (!Number.isInteger(optionCount) || optionCount < 2 || optionCount > 12) {
      return { error: 'A poll needs between 2 and 12 options' };
    }
    return { meta: { optionCount, multi, closed: false } };
  }
  if (type === 'location' && !encrypted) {
    let place = null;
    try { place = JSON.parse(content); } catch { /* checked below */ }
    const lat = Number(place?.lat); const lng = Number(place?.lng);
    if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) return { error: 'A location needs lat and lng' };
  }
  return { meta: null };
}

// The thread. Without `limit`, everything (search needs the whole thread on
// the phone, since only the phone can read it). With `limit`, the newest
// `limit` before `before`, oldest first, and whether there is more.
// `types=photo,doodle` narrows it, for the shared-items view.
router.get('/', async (req, res) => {
  const params = [req.pair.id, req.userId];
  // A scheduled message is its sender's alone until it goes out.
  let where = 'pair_id = $1 AND (scheduled_for IS NULL OR sender_id = $2)';
  if (req.query.types) {
    const types = String(req.query.types).split(',').filter((t) => MESSAGE_TYPES.includes(t));
    params.push(types);
    where += ` AND type = ANY($${params.length}) AND deleted_at IS NULL`;
  }
  if (req.query.before) {
    const before = new Date(String(req.query.before));
    if (Number.isNaN(before.getTime())) return res.status(400).json({ error: 'before must be a date' });
    params.push(before.toISOString());
    where += ` AND sent_at < $${params.length}`;
  }
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 0, 0), 500);
  let rows;
  let hasMore = false;
  if (limit) {
    ({ rows } = await query(`SELECT * FROM messages WHERE ${where} ORDER BY sent_at DESC LIMIT ${limit + 1}`, params));
    hasMore = rows.length > limit;
    rows = rows.slice(0, limit).reverse();
  } else {
    ({ rows } = await query(`SELECT * FROM messages WHERE ${where} ORDER BY sent_at ASC`, params));
  }
  const { rows: pinnedRows } = await query(
    `SELECT * FROM messages WHERE pair_id = $1 AND pinned_at IS NOT NULL AND deleted_at IS NULL
        AND (pinned_until IS NULL OR pinned_until > now()) ORDER BY pinned_at DESC`,
    [req.pair.id]
  );
  res.json({
    messages: await hydrate(rows, req.userId),
    hasMore,
    pinned: await hydrate(pinnedRows, req.userId),
  });
});

router.post('/', async (req, res) => {
  const { type, content, image, strokeData, replyToMessageId, encrypted, sendAt, silent, poll } = req.body;
  if (!MESSAGE_TYPES.includes(type)) {
    return res.status(400).json({ error: `type must be one of ${MESSAGE_TYPES.join(', ')}` });
  }
  if ((type === 'poll' || type === 'location' || type === 'text') && !content) {
    return res.status(400).json({ error: `content is required for ${type} messages` });
  }
  const shape = shapeOf(type, content, Boolean(encrypted), poll);
  if (shape.error) return res.status(400).json({ error: shape.error });

  let scheduledFor = null;
  if (sendAt) {
    const at = new Date(sendAt);
    if (Number.isNaN(at.getTime())) return res.status(400).json({ error: 'sendAt must be a date' });
    if (at.getTime() - Date.now() > MAX_SCHEDULE_MS) return res.status(400).json({ error: 'That is too far ahead' });
    // A time already gone just sends now.
    if (at.getTime() > Date.now() + 30_000) scheduledFor = at.toISOString();
  }

  if (replyToMessageId && !(await messageInPair(replyToMessageId, req.pair.id))) {
    return res.status(400).json({ error: 'That message is not in this chat' });
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
    `INSERT INTO messages (pair_id, sender_id, type, content, image_url, stroke_data, reply_to_message_id,
                           encrypted, scheduled_for, sent_at, silent, meta)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($9, now()), $10, $11) RETURNING *`,
    [
      req.pair.id,
      req.userId,
      type,
      content || null,
      imageUrl,
      type === 'doodle' && strokeData ? JSON.stringify(strokeData) : null,
      replyToMessageId || null,
      Boolean(encrypted),
      scheduledFor,
      Boolean(silent),
      shape.meta ? JSON.stringify(shape.meta) : null,
    ]
  );

  const message = rows[0];
  // Scheduled: nobody else hears about it until the cron sends it.
  if (!scheduledFor) await announce(io(req), message, req.partnerId);
  const [full] = await hydrate([message], req.userId);
  res.status(201).json({ message: full });
});

// Everything the other one sent, up to now, has been read. One call when the
// thread is open rather than one per bubble; the sender's phone hears it and
// shows "Seen".
router.post('/seen', async (req, res) => {
  const { rows } = await query(
    `UPDATE messages SET seen_at = now()
      WHERE pair_id = $1 AND sender_id != $2 AND seen_at IS NULL AND scheduled_for IS NULL
      RETURNING id, seen_at`,
    [req.pair.id, req.userId]
  );
  if (rows.length) {
    io(req)?.to(`pair:${req.pair.id}`).emit('message:seen', {
      by: req.userId, at: rows[0].seen_at, ids: rows.map((r) => r.id),
    });
  }
  res.json({ seen: rows.length });
});

router.patch('/:id/seen', async (req, res) => {
  const { rows } = await query(
    `UPDATE messages SET seen_at = now() WHERE id = $1 AND pair_id = $2 AND sender_id != $3 AND seen_at IS NULL RETURNING *`,
    [req.params.id, req.pair.id, req.userId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Message not found or already seen' });
  res.json({ message: rows[0] });
});

// Edit a text you sent (within EDIT_WINDOW_MS), or change when a scheduled
// one goes out ("now" sends it at once).
router.patch('/:id', async (req, res) => {
  const message = await messageInPair(req.params.id, req.pair.id);
  if (!message || message.deleted_at) return res.status(404).json({ error: 'Message not found' });
  if (message.sender_id !== req.userId) return res.status(403).json({ error: 'You can only change your own messages' });
  const { content, encrypted, sendAt } = req.body || {};

  const sets = [];
  const params = [message.id];
  const set = (sql, value) => { params.push(value); sets.push(sql.replace('?', `$${params.length}`)); };

  if (content !== undefined) {
    if (message.type !== 'text') return res.status(400).json({ error: 'Only a text can be edited' });
    if (!String(content).trim()) return res.status(400).json({ error: 'An edit cannot be empty; delete it instead' });
    if (!message.scheduled_for && Date.now() - new Date(message.sent_at).getTime() > EDIT_WINDOW_MS) {
      return res.status(400).json({ error: 'A message can be edited for 24 hours after it is sent' });
    }
    set('content = ?', content);
    set('encrypted = ?', Boolean(encrypted));
    if (!message.scheduled_for) sets.push('edited_at = now()');
  }

  let releaseNow = false;
  if (sendAt !== undefined) {
    if (!message.scheduled_for) return res.status(400).json({ error: 'That message has already been sent' });
    const at = sendAt === 'now' ? new Date() : new Date(sendAt);
    if (Number.isNaN(at.getTime())) return res.status(400).json({ error: 'sendAt must be a date' });
    if (at.getTime() <= Date.now() + 30_000) {
      releaseNow = true;
      sets.push('scheduled_for = NULL', 'sent_at = now()');
    } else {
      set('scheduled_for = ?', at.toISOString());
      set('sent_at = ?', at.toISOString());
    }
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to change' });

  const { rows } = await query(`UPDATE messages SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params);
  if (releaseNow) await announce(io(req), rows[0], req.partnerId);
  else await broadcastUpdate(io(req), rows[0]);
  const [full] = await hydrate(rows, req.userId);
  res.json({ message: full });
});

// Delete a message you sent. It stays in the thread as "Message deleted",
// with nothing left in it; a scheduled one that never went out just goes.
router.delete('/:id', async (req, res) => {
  const message = await messageInPair(req.params.id, req.pair.id);
  if (!message || message.deleted_at) return res.status(404).json({ error: 'Message not found' });
  if (message.sender_id !== req.userId) return res.status(403).json({ error: 'You can only delete your own messages' });

  await query("DELETE FROM reactions WHERE target_kind = 'message' AND target_id = $1", [message.id]);
  if (message.scheduled_for) {
    await query('DELETE FROM messages WHERE id = $1', [message.id]);
    return res.json({ deleted: true, removed: true });
  }
  await query('DELETE FROM poll_votes WHERE message_id = $1', [message.id]);
  await query('DELETE FROM message_reminders WHERE message_id = $1', [message.id]);
  const { rows } = await query(
    `UPDATE messages SET deleted_at = now(), content = NULL, image_url = NULL, stroke_data = NULL, meta = NULL,
                         pinned_at = NULL, pinned_by = NULL, pinned_until = NULL
      WHERE id = $1 RETURNING *`,
    [message.id]
  );
  if (message.image_url) {
    deleteObject(message.image_url).catch((err) => console.error('[messages] photo not removed:', err.message));
  }
  await broadcastUpdate(io(req), rows[0]);
  res.json({ deleted: true, message: rows[0] });
});

// Vote in a poll. `choices` is the whole of your answer (one, or several on
// a poll that takes more than one); an empty list takes your vote back.
router.put('/:id/vote', async (req, res) => {
  const message = await messageInPair(req.params.id, req.pair.id);
  if (!message || message.deleted_at || message.type !== 'poll') return res.status(404).json({ error: 'Poll not found' });
  const meta = message.meta || {};
  if (meta.closed) return res.status(400).json({ error: 'This poll has ended' });
  const raw = Array.isArray(req.body?.choices) ? req.body.choices : [req.body?.choice];
  const choices = [...new Set(raw.filter((c) => c !== undefined && c !== null).map(Number))];
  if (choices.some((c) => !Number.isInteger(c) || c < 0 || c >= meta.optionCount)) {
    return res.status(400).json({ error: 'No such option' });
  }
  if (choices.length > 1 && !meta.multi) return res.status(400).json({ error: 'This poll takes one answer' });

  await query('DELETE FROM poll_votes WHERE message_id = $1 AND user_id = $2', [message.id, req.userId]);
  for (const choice of choices) {
    await query('INSERT INTO poll_votes (message_id, user_id, choice) VALUES ($1, $2, $3)', [message.id, req.userId, choice]);
  }
  await broadcastUpdate(io(req), message);
  const [full] = await hydrate([message], req.userId);
  res.json({ message: full });
});

// End a poll you asked: no more votes, and the result stands.
router.post('/:id/close', async (req, res) => {
  const message = await messageInPair(req.params.id, req.pair.id);
  if (!message || message.deleted_at || message.type !== 'poll') return res.status(404).json({ error: 'Poll not found' });
  if (message.sender_id !== req.userId) return res.status(403).json({ error: 'Only whoever asked can end a poll' });
  const { rows } = await query(
    `UPDATE messages SET meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{closed}', 'true') WHERE id = $1 RETURNING *`,
    [message.id]
  );
  await broadcastUpdate(io(req), rows[0]);
  const [full] = await hydrate(rows, req.userId);
  res.json({ message: full });
});

// Pin to the top of the chat, for good or `until` a time. Either of you can.
router.put('/:id/pin', async (req, res) => {
  const message = await messageInPair(req.params.id, req.pair.id);
  if (!message || message.deleted_at || message.scheduled_for) return res.status(404).json({ error: 'Message not found' });
  let until = null;
  if (req.body?.until) {
    const at = new Date(req.body.until);
    if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) return res.status(400).json({ error: 'until must be in the future' });
    until = at.toISOString();
  }
  const { rows } = await query(
    'UPDATE messages SET pinned_at = now(), pinned_by = $2, pinned_until = $3 WHERE id = $1 RETURNING *',
    [message.id, req.userId, until]
  );
  await broadcastUpdate(io(req), rows[0]);
  const [full] = await hydrate(rows, req.userId);
  res.json({ message: full });
});

router.delete('/:id/pin', async (req, res) => {
  const message = await messageInPair(req.params.id, req.pair.id);
  if (!message) return res.status(404).json({ error: 'Message not found' });
  const { rows } = await query(
    'UPDATE messages SET pinned_at = NULL, pinned_by = NULL, pinned_until = NULL WHERE id = $1 RETURNING *',
    [message.id]
  );
  await broadcastUpdate(io(req), rows[0]);
  const [full] = await hydrate(rows, req.userId);
  res.json({ message: full });
});

// "Remind me about this message" at a time: a push to you alone.
router.put('/:id/reminder', async (req, res) => {
  const message = await messageInPair(req.params.id, req.pair.id);
  if (!message || message.deleted_at) return res.status(404).json({ error: 'Message not found' });
  const at = new Date(req.body?.at);
  if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) return res.status(400).json({ error: 'at must be in the future' });
  await query(
    `INSERT INTO message_reminders (message_id, user_id, remind_at) VALUES ($1, $2, $3)
     ON CONFLICT (message_id, user_id) DO UPDATE SET remind_at = EXCLUDED.remind_at`,
    [message.id, req.userId, at.toISOString()]
  );
  res.json({ reminder: at.toISOString() });
});

router.delete('/:id/reminder', async (req, res) => {
  await query('DELETE FROM message_reminders WHERE message_id = $1 AND user_id = $2', [req.params.id, req.userId]);
  res.json({ reminder: null });
});

/**
 * Sends every scheduled message whose time has come. Run every minute by the
 * cron; safe to run twice at once, since each row is claimed by the UPDATE
 * that sends it.
 */
export async function releaseScheduledMessages(ioServer = getIo()) {
  const { rows } = await query(
    `UPDATE messages SET scheduled_for = NULL, sent_at = now()
      WHERE scheduled_for IS NOT NULL AND scheduled_for <= now() AND deleted_at IS NULL
      RETURNING *`
  );
  for (const message of rows) {
    const pair = await getPairById(message.pair_id);
    if (!pair) continue;
    await announce(ioServer, message, otherUserId(pair, message.sender_id));
  }
  return rows.length;
}

/** Pushes every message reminder that is due, then forgets it. */
export async function sendMessageReminders() {
  const { rows } = await query(
    `DELETE FROM message_reminders r USING messages m
      WHERE r.message_id = m.id AND r.remind_at <= now()
      RETURNING r.user_id, m.id AS message_id, m.pair_id, m.sender_id, m.type`
  );
  for (const r of rows) {
    const from = r.sender_id === r.user_id ? 'you' : await senderName(r.pair_id, r.sender_id, r.user_id);
    const what = { photo: 'a photo', doodle: 'a drawing', poll: 'a poll', location: 'a place' }[r.type] || 'a message';
    await sendNotification(
      await getUserDeviceTokens(r.user_id),
      { title: 'Reminder', body: `About ${what} from ${from}` },
      deepLink('message', { messageId: r.message_id }),
      { channel: CHANNELS.reminders, priority: 'high' }
    ).catch((err) => console.error('[messages] reminder push failed:', err.message));
  }
  return rows.length;
}

export default router;
