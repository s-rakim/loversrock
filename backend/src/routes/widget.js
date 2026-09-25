import { createHash, randomBytes } from 'crypto';
import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { getObjectStream } from '../config/storage.js';
import { computePredictions, toDateString } from '../models/periodPredictions.js';

const router = asyncRouter();

const hashToken = (raw) => createHash('sha256').update(raw).digest('hex');

// Deliberately NOT requireAuth: this is the widget's own read-only credential,
// usable on this endpoint alone. It can never reach messages, memories, or
// anything else, and revoking it doesn't log the phone out.
async function requireWidgetToken(req, res, next) {
  const raw = req.get('X-Widget-Token');
  if (!raw) return res.status(401).json({ error: 'Missing widget token' });

  const { rows } = await query(
    'SELECT * FROM widget_tokens WHERE token_hash = $1 AND revoked_at IS NULL',
    [hashToken(raw)]
  );
  const token = rows[0];
  if (!token) return res.status(401).json({ error: 'Invalid or revoked widget token' });

  // Throttled so a widget polling every 15 minutes doesn't write on every read.
  if (!token.last_used_at || Date.now() - new Date(token.last_used_at).getTime() > 10 * 60 * 1000) {
    await query('UPDATE widget_tokens SET last_used_at = now() WHERE id = $1', [token.id]);
  }

  req.userId = token.user_id;
  next();
}

// Issued from the app (normal bearer auth), handed to the native widget layer,
// and shown to the user exactly once.
router.post('/token', requireAuth, async (req, res) => {
  const { label } = req.body || {};
  const raw = randomBytes(32).toString('hex');

  const { rows } = await query(
    `INSERT INTO widget_tokens (user_id, token_hash, label) VALUES ($1, $2, $3)
     RETURNING id, created_at`,
    [req.userId, hashToken(raw), label || 'device widget']
  );

  res.status(201).json({ widgetToken: raw, id: rows[0].id, createdAt: rows[0].created_at });
});

router.get('/tokens', requireAuth, async (req, res) => {
  const { rows } = await query(
    `SELECT id, label, created_at, last_used_at, revoked_at FROM widget_tokens
     WHERE user_id = $1 ORDER BY created_at DESC`,
    [req.userId]
  );
  res.json({ tokens: rows });
});

router.delete('/token/:id', requireAuth, async (req, res) => {
  const { rowCount } = await query(
    'UPDATE widget_tokens SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL',
    [req.params.id, req.userId]
  );
  if (rowCount === 0) return res.status(404).json({ error: 'Token not found' });
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

// Everything the home/lock screen widgets render, in one round trip — a widget
// gets a few hundred milliseconds of background execution, so it can't afford
// to chain calls. Every field is nullable: widgets must degrade gracefully
// rather than error.
router.get('/summary', requireWidgetToken, async (req, res) => {
  const { rows: pairRows } = await query(
    `SELECT * FROM pairs
     WHERE (user_a_id = $1 OR user_b_id = $1) AND unlinked_at IS NULL AND user_b_id IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
    [req.userId]
  );
  const pair = pairRows[0] || null;

  const summary = {
    paired: Boolean(pair),
    streakCount: pair ? pair.streak_count : 0,
    promptAnsweredToday: false,
    nextCountdown: null,
    distanceKm: null,
    latestPhotoUrl: null,
    partnerCyclePhase: null,
    partnerNextPeriodDate: null,
    // Ambient presence: the whole reason a widget exists is to show these
    // without anything being opened.
    daysTogether: null,
    togetherSince: null,
    partnerMood: null,
    partnerMoodNote: null,
    partnerMoodAt: null,
    // A sealed note is ANNOUNCED, never revealed. The widget runs in another
    // process with no session, and a home screen is the one place a secret
    // must not be printed.
    sealedNoteWaiting: false,
    latestNote: null,
    latestNoteAt: null,
    updatedAt: new Date().toISOString(),
  };

  if (!pair) return res.json(summary);

  const partnerId = pair.user_a_id === req.userId ? pair.user_b_id : pair.user_a_id;

  const [promptRes, countdownRes, photoRes, locationRes, partnerPeriodRes, moodRes, noteRes] = await Promise.all([
    query(
      `SELECT 1 FROM prompt_responses pr
       JOIN daily_prompts dp ON dp.id = pr.prompt_id
       WHERE pr.pair_id = $1 AND pr.user_id = $2 AND dp.scheduled_date = CURRENT_DATE`,
      [pair.id, req.userId]
    ),
    query(
      `SELECT label, target_date FROM countdowns
       WHERE pair_id = $1 AND auto_archived = FALSE AND target_date > now()
       ORDER BY target_date ASC LIMIT 1`,
      [pair.id]
    ),
    query(
      'SELECT image_url FROM widget_photos WHERE pair_id = $1 ORDER BY created_at DESC LIMIT 1',
      [pair.id]
    ),
    query(
      'SELECT id, last_lat, last_lng, location_sharing_enabled FROM users WHERE id = ANY($1::uuid[])',
      [[req.userId, partnerId]]
    ),
    query('SELECT * FROM period_settings WHERE user_id = $1 AND sharing_enabled = TRUE', [partnerId]),
    query('SELECT mood, note, updated_at FROM partner_moods WHERE pair_id = $1 AND user_id = $2',
      [pair.id, partnerId]),
    query(
      `SELECT body, sealed, opened_at, created_at FROM notes
        WHERE pair_id = $1 AND author_id = $2
        ORDER BY created_at DESC LIMIT 1`,
      [pair.id, partnerId]
    ),
  ]);

  summary.togetherSince = pair.together_since || null;
  summary.daysTogether = pair.together_since
    ? Math.max(0, Math.floor((Date.now() - new Date(pair.together_since).getTime()) / 86400000))
    : null;

  if (moodRes.rows[0]) {
    summary.partnerMood = moodRes.rows[0].mood;
    summary.partnerMoodNote = moodRes.rows[0].note;
    summary.partnerMoodAt = moodRes.rows[0].updated_at;
  }

  const latestNote = noteRes.rows[0];
  if (latestNote) {
    summary.latestNoteAt = latestNote.created_at;
    if (latestNote.sealed && !latestNote.opened_at) summary.sealedNoteWaiting = true;
    else summary.latestNote = String(latestNote.body).slice(0, 140);
  }

  summary.promptAnsweredToday = promptRes.rows.length > 0;

  if (countdownRes.rows[0]) {
    const target = new Date(countdownRes.rows[0].target_date);
    summary.nextCountdown = {
      label: countdownRes.rows[0].label,
      targetDate: target.toISOString(),
      daysRemaining: Math.max(0, Math.ceil((target.getTime() - Date.now()) / 86400000)),
    };
  }

  if (photoRes.rows[0]) summary.latestPhotoUrl = photoRes.rows[0].image_url;

  const me = locationRes.rows.find((r) => r.id === req.userId);
  const partner = locationRes.rows.find((r) => r.id === partnerId);
  if (
    me?.location_sharing_enabled &&
    partner?.location_sharing_enabled &&
    me.last_lat != null &&
    partner.last_lat != null
  ) {
    summary.distanceKm = Number(haversineKm(me.last_lat, me.last_lng, partner.last_lat, partner.last_lng).toFixed(1));
  }

  // Same privacy boundary as GET /period/partner (docs/SPEC.md #5): phase and
  // predicted date only, never raw flow/symptoms/mood/notes.
  const partnerPeriod = partnerPeriodRes.rows[0];
  if (partnerPeriod) {
    const { rows: cycles } = await query(
      'SELECT start_date FROM period_cycles WHERE user_id = $1 ORDER BY start_date DESC LIMIT 1',
      [partnerId]
    );
    if (cycles[0]) {
      const predictions = computePredictions({
        lastCycleStart: cycles[0].start_date,
        settings: {
          averageCycleLength: partnerPeriod.average_cycle_length,
          averagePeriodLength: partnerPeriod.average_period_length,
          lutealPhaseLength: partnerPeriod.luteal_phase_length,
        },
        today: toDateString(new Date()),
      });
      summary.partnerCyclePhase = predictions.phase;
      summary.partnerNextPeriodDate = predictions.nextPeriodDate;
    }
  }

  res.json(summary);
});

// Widgets can't send an Authorization header through the image loader on
// either platform, so the photo is fetched with the widget token in the query
// string instead. Same read-only credential, same revocation.
router.get('/photo', async (req, res, next) => {
  const raw = req.query.token;
  if (!raw) return res.status(401).json({ error: 'Missing widget token' });
  req.headers['x-widget-token'] = raw;
  return requireWidgetToken(req, res, next);
}, async (req, res) => {
  const { rows: pairRows } = await query(
    `SELECT id FROM pairs WHERE (user_a_id = $1 OR user_b_id = $1) AND unlinked_at IS NULL AND user_b_id IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
    [req.userId]
  );
  if (!pairRows[0]) return res.status(404).json({ error: 'Not paired' });

  const { rows } = await query(
    'SELECT image_url FROM widget_photos WHERE pair_id = $1 ORDER BY created_at DESC LIMIT 1',
    [pairRows[0].id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'No photo yet' });

  const key = rows[0].image_url;
  // Declare the type. Android's BitmapFactory sniffs the bytes and copes
  // without it, but iOS's image loader and any HTTP cache in between go by
  // the header - an image served as "no idea" is the kind of thing that
  // works on one platform and silently shows a blank widget on the other.
  const extension = (key.split('.').pop() || '').toLowerCase();
  const contentType = extension === 'png' ? 'image/png'
    : extension === 'webp' ? 'image/webp'
      : extension === 'gif' ? 'image/gif'
        : 'image/jpeg';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-cache');

  const stream = await getObjectStream(key);
  // Once piping has begun the status line is already sent, so a late error
  // can only destroy the response - calling res.status() then would throw.
  stream.on('error', () => {
    if (res.headersSent) res.destroy();
    else res.status(404).end();
  });
  stream.pipe(res);
});

export default router;
