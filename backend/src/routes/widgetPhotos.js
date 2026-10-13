import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import { uploadBase64Image } from '../config/storage.js';
import { getUserDeviceTokens } from '../models/pairs.js';
import { sendDataMessage } from '../config/firebase.js';
import { pairLocalDateString } from '../models/pairs.js';
import { earnSparks, SPARK_REWARDS } from '../models/sparks.js';
import { notifyUser, userName } from '../models/notify.js';

const router = asyncRouter();

router.use(requireAuth, requirePair);

// Mirrors into the memories feed with source='widget' so it's visible even
// if native widget delivery fails, and sends an FCM *data* message (not a
// notification message) so Android can wake the app/widget in the
// background rather than only drawing a tray notification.
router.post('/', async (req, res) => {
  const { image, caption } = req.body;
  if (!image) return res.status(400).json({ error: 'image (base64 data URL) is required' });

  const key = await uploadBase64Image(image, { prefix: `widget-photos/${req.pair.id}` });

  const { rows } = await query(
    `INSERT INTO widget_photos (pair_id, sender_id, image_url, caption) VALUES ($1, $2, $3, $4) RETURNING *`,
    [req.pair.id, req.userId, key, caption || null]
  );

  await query(
    `INSERT INTO memories (pair_id, image_url, caption, taken_at, created_by, source)
     VALUES ($1, $2, $3, now(), $4, 'widget')`,
    [req.pair.id, key, caption || null, req.userId]
  );

  const partnerTokens = await getUserDeviceTokens(req.partnerId);
  await sendDataMessage(partnerTokens, {
    type: 'widget_photo',
    widgetPhotoId: rows[0].id,
    imageUrl: key,
  }).catch((err) => console.error('[widget-photos] data message failed:', err.message));

  // Daily Snap: a visible "new snap" push (mutable under 'snaps'), plus Sparks
  // once per pair-local day. The data message above still refreshes widgets.
  await earnSparks({ pairId: req.pair.id, userId: req.userId, amount: SPARK_REWARDS.daily_snap, reason: 'daily_snap', ref: pairLocalDateString(req.pair) });
  const senderName = await userName(req.userId);
  notifyUser(req.partnerId, 'snaps', { title: `${senderName} sent a Daily Snap 📸`, body: caption || 'Tap to see it.' }, { screen: 'DailySnap' });
  req.app.get('io').to(`pair:${req.pair.id}`).emit('snap:new', { widgetPhoto: rows[0] });

  res.status(201).json({ widgetPhoto: rows[0] });
});

// Pull-based fallback for when the push/data-message delivery doesn't land.
router.get('/latest', async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM widget_photos WHERE pair_id = $1 ORDER BY created_at DESC LIMIT 1',
    [req.pair.id]
  );
  res.json({ widgetPhoto: rows[0] || null });
});

// Daily Snap history, newest first, with who sent each.
router.get('/', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 60, 200);
  const { rows } = await query(
    `SELECT w.*, u.name AS sender_name FROM widget_photos w JOIN users u ON u.id = w.sender_id
     WHERE w.pair_id = $1 ORDER BY w.created_at DESC LIMIT $2`,
    [req.pair.id, limit]
  );
  res.json({ snaps: rows });
});

router.patch('/:id/seen', async (req, res) => {
  const { rows } = await query(
    `UPDATE widget_photos SET seen_at = COALESCE(seen_at, now())
     WHERE id = $1 AND pair_id = $2 AND sender_id <> $3 RETURNING *`,
    [req.params.id, req.pair.id, req.userId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Snap not found' });
  res.json({ widgetPhoto: rows[0] });
});

export default router;
