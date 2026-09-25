// Moods, notes and reactions — the things that make a partner feel present
// without either of you opening the app for them.
//
// Grouped into one router because they are one idea, not three: each is a
// small signal one person leaves and the other picks up, each feeds a widget,
// and none of them is big enough to deserve its own file.
import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import { getUserDeviceTokens } from '../models/pairs.js';
import { NUDGE_LABELS, normalizeKind, NUDGE_THROTTLE_SECONDS } from '../models/nudges.js';
import { sendNotification, deepLink, CHANNELS } from '../config/firebase.js';
import { normalizeAvatar, catalogue } from '../models/wardrobe.js';

const router = asyncRouter();
router.use(requireAuth, requirePair);

// A closed set, because a free-text mood cannot be drawn on a widget and
// cannot be matched to an icon. The labels live on the client; this is the
// contract between the two.
export const MOODS = [
  'happy', 'loved', 'calm', 'tired', 'stressed',
  'sad', 'annoyed', 'excited', 'lonely', 'unwell',
];

const emit = (req, event, payload) =>
  req.app.get('io')?.to(`pair:${req.pair.id}`).emit(event, payload);

// ------------------------------------------------------------------- moods

router.get('/moods', async (req, res) => {
  const { rows } = await query('SELECT * FROM partner_moods WHERE pair_id = $1', [req.pair.id]);
  res.json({
    mine: rows.find((r) => r.user_id === req.userId) || null,
    theirs: rows.find((r) => r.user_id === req.partnerId) || null,
  });
});

router.put('/moods', async (req, res) => {
  const mood = String(req.body?.mood || '');
  if (!MOODS.includes(mood)) {
    return res.status(400).json({ error: `mood must be one of ${MOODS.join(', ')}` });
  }
  const note = req.body?.note ? String(req.body.note).slice(0, 120) : null;

  // One row per person, replaced in place: a mood is a current state, not a
  // log. The cycle tracker keeps history for the person whose body it is;
  // this is just "how are you right now".
  const { rows } = await query(
    `INSERT INTO partner_moods (pair_id, user_id, mood, note)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (pair_id, user_id)
       DO UPDATE SET mood = EXCLUDED.mood, note = EXCLUDED.note, updated_at = now()
     RETURNING *`,
    [req.pair.id, req.userId, mood, note]
  );

  emit(req, 'mood:changed', { mood: rows[0] });

  // Worth a notification: a mood changing is exactly the kind of thing you
  // would want to know about without checking.
  const tokens = await getUserDeviceTokens(req.partnerId);
  sendNotification(
    tokens,
    { title: 'Mood update', body: note ? `Feeling ${mood} — "${note}"` : `Feeling ${mood}` },
    deepLink('mood'),
    { channel: CHANNELS.partner }
  ).catch(() => { /* a mood is not worth failing the request over */ });

  res.json({ mood: rows[0] });
});

// ------------------------------------------------------------------- notes

router.get('/notes', async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM notes WHERE pair_id = $1 ORDER BY pinned DESC, created_at DESC LIMIT 200',
    [req.pair.id]
  );

  // A sealed note the OTHER person wrote is withheld until it is opened.
  // Sending the body and asking the client not to show it would make the
  // whole feature a decoration — anyone reading the response would see it.
  res.json({
    notes: rows.map((note) => {
      const mine = note.author_id === req.userId;
      const hidden = note.sealed && !mine && !note.opened_at;
      return hidden ? { ...note, body: null, isSealed: true } : { ...note, isSealed: false };
    }),
  });
});

router.post('/notes', async (req, res) => {
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'body is required' });

  const { rows } = await query(
    'INSERT INTO notes (pair_id, author_id, body, sealed) VALUES ($1, $2, $3, $4) RETURNING *',
    [req.pair.id, req.userId, body.slice(0, 2000), Boolean(req.body?.sealed)]
  );

  emit(req, 'note:new', { note: { ...rows[0], body: rows[0].sealed ? null : rows[0].body } });

  const tokens = await getUserDeviceTokens(req.partnerId);
  sendNotification(
    tokens,
    rows[0].sealed
      ? { title: 'Something for you', body: 'A sealed note is waiting.' }
      : { title: 'A note for you', body: body.slice(0, 120) },
    deepLink('notes'),
    { channel: CHANNELS.partner }
  ).catch(() => {});

  res.status(201).json({ note: rows[0] });
});

/** Breaks the seal. Only the recipient can, and only once. */
router.post('/notes/:id/open', async (req, res) => {
  const { rows } = await query(
    `UPDATE notes SET opened_at = now()
      WHERE id = $1 AND pair_id = $2 AND author_id <> $3 AND opened_at IS NULL
      RETURNING *`,
    [req.params.id, req.pair.id, req.userId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'No sealed note to open' });

  // The author is told it was read, which is most of the point of sealing it.
  emit(req, 'note:opened', { note: rows[0] });
  res.json({ note: rows[0] });
});

router.patch('/notes/:id', async (req, res) => {
  const { rows } = await query(
    'UPDATE notes SET pinned = $1 WHERE id = $2 AND pair_id = $3 RETURNING *',
    [Boolean(req.body?.pinned), req.params.id, req.pair.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Note not found' });
  res.json({ note: rows[0] });
});

router.delete('/notes/:id', async (req, res) => {
  const { rowCount } = await query(
    'DELETE FROM notes WHERE id = $1 AND pair_id = $2 AND author_id = $3',
    [req.params.id, req.pair.id, req.userId]
  );
  if (!rowCount) return res.status(404).json({ error: 'Note not found' });
  res.status(204).end();
});

// --------------------------------------------------------------- reactions

const TARGETS = ['message', 'memory', 'note', 'doodle'];

router.get('/reactions/:kind', async (req, res) => {
  if (!TARGETS.includes(req.params.kind)) return res.status(400).json({ error: 'Unknown target' });
  const { rows } = await query(
    'SELECT * FROM reactions WHERE pair_id = $1 AND target_kind = $2',
    [req.pair.id, req.params.kind]
  );
  // Grouped by target so a thread can look each one up rather than filtering
  // the whole list per bubble.
  const byTarget = {};
  for (const row of rows) {
    (byTarget[row.target_id] = byTarget[row.target_id] || []).push(row);
  }
  res.json({ reactions: byTarget });
});

router.put('/reactions', async (req, res) => {
  const { targetKind, targetId, emoji } = req.body || {};
  if (!TARGETS.includes(targetKind)) return res.status(400).json({ error: 'Unknown target' });
  if (!targetId) return res.status(400).json({ error: 'targetId is required' });

  // No emoji means "take mine off". Reacting is a toggle, not an append.
  if (!emoji) {
    await query(
      'DELETE FROM reactions WHERE user_id = $1 AND target_kind = $2 AND target_id = $3',
      [req.userId, targetKind, targetId]
    );
    emit(req, 'reaction:changed', { targetKind, targetId, userId: req.userId, emoji: null });
    return res.json({ reaction: null });
  }

  const { rows } = await query(
    `INSERT INTO reactions (pair_id, user_id, target_kind, target_id, emoji)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, target_kind, target_id)
       DO UPDATE SET emoji = EXCLUDED.emoji, created_at = now()
     RETURNING *`,
    [req.pair.id, req.userId, targetKind, targetId, String(emoji).slice(0, 8)]
  );

  emit(req, 'reaction:changed', { targetKind, targetId, userId: req.userId, emoji: rows[0].emoji });
  res.json({ reaction: rows[0] });
});

// ------------------------------------------------------------- characters
//
// One character each. You dress yours; they see it. The reverse is the point
// of the whole thing — the little person at the top of their Home is you,
// wearing what you put on and the mood you set.

router.get('/wardrobe', async (_req, res) => {
  // The catalogue comes from the server so both phones agree on what exists.
  // A client that only knew its own list would render an unknown garment as
  // nothing, and the failure mode of "nothing" is a naked character.
  res.json(catalogue());
});

router.get('/avatars', async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM user_avatars WHERE user_id = ANY($1::uuid[])',
    [[req.userId, req.partnerId]]
  );
  const find = (id) => {
    const row = rows.find((r) => r.user_id === id);
    // Someone who has never opened the wardrobe still has a character; they
    // just have the default one.
    return normalizeAvatar(row ? { ...row, hairColor: row.hair_color, outfit: row.outfit } : {});
  };
  res.json({ mine: find(req.userId), theirs: find(req.partnerId) });
});

router.put('/avatars', async (req, res) => {
  // Only ever your own row: the id comes from the token, never the body, so
  // nobody can dress their partner against their will.
  const avatar = normalizeAvatar(req.body || {});

  const { rows } = await query(
    `INSERT INTO user_avatars (user_id, skin, hair, hair_color, build, outfit, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (user_id) DO UPDATE
       SET skin = EXCLUDED.skin, hair = EXCLUDED.hair, hair_color = EXCLUDED.hair_color,
           build = EXCLUDED.build, outfit = EXCLUDED.outfit, updated_at = now()
     RETURNING *`,
    [req.userId, avatar.skin, avatar.hair, avatar.hairColor, avatar.build, JSON.stringify(avatar.outfit)]
  );

  // So their phone re-dresses the character without being reopened.
  emit(req, 'avatar:changed', { userId: req.userId });

  res.json({ avatar: normalizeAvatar({ ...rows[0], hairColor: rows[0].hair_color, outfit: rows[0].outfit }) });
});

/* ----------------------------------------------------------------- nudges */
//
// The in-app half of the quick-kiss widget. Same table, ordinary auth.
//
// Two routes rather than one shared with /widget/kiss because the two callers
// hold different credentials: the widget has the weak read-mostly token that
// lives in SharedPreferences, the app has the real session. Giving the app
// its own route means the widget token's permissions stay exactly as narrow
// as they were designed to be.

router.get('/nudges', async (req, res) => {
  const [fromThem, fromMe] = await Promise.all([
    query(
      `SELECT kind, created_at, seen_at FROM nudges
        WHERE pair_id = $1 AND from_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [req.pair.id, req.partnerId]
    ),
    query(
      `SELECT kind, created_at FROM nudges
        WHERE pair_id = $1 AND from_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [req.pair.id, req.userId]
    ),
  ]);
  const { rows: unseen } = await query(
    'SELECT count(*)::int AS n FROM nudges WHERE pair_id = $1 AND from_id = $2 AND seen_at IS NULL',
    [req.pair.id, req.partnerId]
  );
  res.json({
    theirs: fromThem.rows[0] || null,
    mine: fromMe.rows[0] || null,
    unseen: unseen[0].n,
  });
});

router.post('/nudges', async (req, res) => {
  const kind = normalizeKind(req.body?.kind);

  // The same thirty seconds the widget gets. A double-tap is one kiss.
  const { rows: recent } = await query(
    `SELECT created_at FROM nudges
      WHERE pair_id = $1 AND from_id = $2
        AND created_at > now() - ($3 || ' seconds')::interval
      ORDER BY created_at DESC LIMIT 1`,
    [req.pair.id, req.userId, NUDGE_THROTTLE_SECONDS]
  );
  if (recent[0]) return res.json({ sent: false, throttled: true, at: recent[0].created_at });

  const { rows } = await query(
    'INSERT INTO nudges (pair_id, from_id, kind) VALUES ($1, $2, $3) RETURNING id, kind, created_at',
    [req.pair.id, req.userId, kind]
  );

  emit(req, 'nudge:received', { nudge: rows[0], from: req.userId });

  const tokens = await getUserDeviceTokens(req.partnerId);
  await sendNotification(
    tokens,
    NUDGE_LABELS[kind],
    deepLink('home'),
    { channel: CHANNELS.partner }
  ).catch((err) => console.error('[presence] nudge push failed:', err.message));

  res.status(201).json({ sent: true, nudge: rows[0] });
});

router.post('/nudges/seen', async (req, res) => {
  const { rowCount } = await query(
    'UPDATE nudges SET seen_at = now() WHERE pair_id = $1 AND from_id = $2 AND seen_at IS NULL',
    [req.pair.id, req.partnerId]
  );
  res.json({ seen: rowCount });
});

export default router;
