import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import { uploadBase64Image } from '../config/storage.js';
import { getUserDeviceTokens } from '../models/pairs.js';
import { sendDataMessage } from '../config/firebase.js';

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

export default router;
