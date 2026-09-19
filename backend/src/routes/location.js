import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';

const router = asyncRouter();

router.use(requireAuth, requirePair);

// Opt-in, off by default, instantly revocable — see docs/SPEC.md #4.
// Disabling clears the stored position immediately, not just the flag.
router.post('/enable', async (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be a boolean' });

  await query(
    `UPDATE users SET
       location_sharing_enabled = $1,
       last_lat = CASE WHEN $1 IS FALSE THEN NULL ELSE last_lat END,
       last_lng = CASE WHEN $1 IS FALSE THEN NULL ELSE last_lng END,
       location_shared_at = CASE WHEN $1 IS FALSE THEN NULL ELSE location_shared_at END
     WHERE id = $2`,
    [enabled, req.userId]
  );

  res.status(204).end();
});

router.post('/update', async (req, res) => {
  const { lat, lng } = req.body;
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'lat and lng must be numbers' });
  }

  const { rows } = await query('SELECT location_sharing_enabled FROM users WHERE id = $1', [req.userId]);
  if (!rows[0]?.location_sharing_enabled) {
    return res.status(403).json({ error: 'Location sharing is not enabled' });
  }

  await query(
    `UPDATE users SET last_lat = $1, last_lng = $2, location_shared_at = now() WHERE id = $3`,
    [lat, lng, req.userId]
  );

  req.app.get('io').to(`pair:${req.pair.id}`).emit('location:update', { userId: req.userId, lat, lng });
  res.status(204).end();
});

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Only returned if BOTH users have sharing enabled.
router.get('/distance', async (req, res) => {
  const { rows } = await query(
    'SELECT id, last_lat, last_lng, location_sharing_enabled FROM users WHERE id = ANY($1::uuid[])',
    [[req.userId, req.partnerId]]
  );

  const me = rows.find((r) => r.id === req.userId);
  const partner = rows.find((r) => r.id === req.partnerId);

  if (!me?.location_sharing_enabled || !partner?.location_sharing_enabled) {
    return res.json({ distanceKm: null, reason: 'Both partners must enable location sharing' });
  }
  if (me.last_lat == null || partner.last_lat == null) {
    return res.json({ distanceKm: null, reason: 'Waiting for a location update' });
  }

  const distanceKm = haversineKm(me.last_lat, me.last_lng, partner.last_lat, partner.last_lng);
  res.json({ distanceKm });
});

export default router;
