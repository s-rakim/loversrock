import { createHash, randomBytes } from 'crypto';
import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { getObjectStream } from '../config/storage.js';
import { computePredictions, toDateString } from '../models/periodPredictions.js';
import { getUserDeviceTokens, pairLocalDateString } from '../models/pairs.js';
import { resolveMascotArt } from '../models/mascotArt.js';
import { moodEmoji, symptomEmoji } from '../models/widgetEmoji.js';
import { sendNotification, deepLink, CHANNELS } from '../config/firebase.js';
import { NUDGE_LABELS, normalizeKind, NUDGE_THROTTLE_SECONDS } from '../models/nudges.js';

const router = asyncRouter();

const hashToken = (raw) => createHash('sha256').update(raw).digest('hex');

// What a widget can afford to draw.
//
// Android RemoteViews cross a Binder transaction with a hard ~1MB ceiling and
// an iOS widget gets a few hundred milliseconds of background execution. A
// drawing of 120,000 points is neither of those things, so the widget copy is
// thinned to something a 2x2 tile can show — which at that size is all the
// detail that survives anyway.
const WIDGET_DRAWING = { strokes: 120, points: 2400, minStep: 3 };



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
/**
 * The first letter of a name, as a person would read it.
 *
 * Array.from rather than [0] so a name opening with an emoji or an accented
 * letter yields the whole character instead of half a surrogate pair — and
 * the first LETTER, skipping emoji, because a bubble with a lone butterfly in
 * it reads as decoration, not as a person.
 */
function initialOf(name) {
  if (!name) return null;
  const letter = Array.from(String(name)).find((ch) => /\p{L}|\p{N}/u.test(ch));
  return letter ? letter.toLocaleUpperCase() : null;
}

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
    // Why there is no number, so the distance widget can say something true
    // instead of a bare dash: 'ok' | 'sharing_off' | 'no_location'.
    distanceStatus: null,
    // The letter in the partner's bubble on the distance widget — from the
    // nickname YOU gave them if there is one, since that is how you think of
    // them, else their own name.
    partnerInitial: null,
    // The two full-body mascots on the distance widget: which bundled picture
    // is you and which is them ('a' | 'b'). Always different from each other.
    myArt: null,
    partnerArt: null,
    // Each of you as an emoji, under your mascot: the mood you picked on the
    // mood bar, and up to three of today's logged symptoms. Only symptoms
    // with an emoji in models/widgetEmoji.js ever appear — anything intimate
    // is never sent to a home screen — and the partner's only when they
    // share symptoms with you.
    myMoodEmoji: null,
    partnerMoodEmoji: null,
    mySymptomEmoji: [],
    partnerSymptomEmoji: [],
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
    // The daily-question widget shows the question itself. Answering happens
    // in the app — a home screen is no place to type a paragraph — but a
    // question you can read without unlocking anything is one you think about
    // during the day instead of at 11pm.
    todaysQuestion: null,
    // The next-date widget.
    nextDate: null,
    // The quick-kiss widget, both halves of it: whether one is waiting for
    // you, and when you last sent one, so the button can say so.
    lastKissFromPartnerAt: null,
    unseenKisses: 0,
    lastKissSentAt: null,
    // The canvas widget only needs to know there IS one, and when. The
    // strokes are a separate fetch — see GET /widget/drawing.
    latestDrawingAt: null,
    latestDrawingTitle: null,
    updatedAt: new Date().toISOString(),
  };

  if (!pair) return res.json(summary);

  const partnerId = pair.user_a_id === req.userId ? pair.user_b_id : pair.user_a_id;

  // Every widget reads this endpoint, so a bad stored timezone must cost the
  // symptom row its precision, not the whole home screen its data.
  let today;
  try { today = pairLocalDateString(pair); } catch { today = new Date().toISOString().slice(0, 10); }

  const [
    promptRes, countdownRes, photoRes, locationRes, partnerPeriodRes, moodRes, noteRes,
    questionRes, dateRes, kissInRes, kissOutRes, drawingRes, myMoodRes, logRes, partnerSharingRes,
  ] = await Promise.all([
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
      `SELECT id, name, last_lat, last_lng, location_sharing_enabled, mascot_art, cycle_role
         FROM users WHERE id = ANY($1::uuid[])`,
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
    query('SELECT content FROM daily_prompts WHERE scheduled_date = CURRENT_DATE LIMIT 1'),
    query(
      `SELECT title, scheduled_for FROM date_ideas
        WHERE pair_id = $1 AND status = 'scheduled' AND scheduled_for > now()
        ORDER BY scheduled_for ASC LIMIT 1`,
      [pair.id]
    ),
    // Theirs to me: the newest, and how many I have not looked at.
    query(
      `SELECT max(created_at) AS at, count(*) FILTER (WHERE seen_at IS NULL) AS unseen
         FROM nudges WHERE pair_id = $1 AND from_id = $2 AND kind = 'kiss'`,
      [pair.id, partnerId]
    ),
    query(
      `SELECT max(created_at) AS at FROM nudges
        WHERE pair_id = $1 AND from_id = $2 AND kind = 'kiss'`,
      [pair.id, req.userId]
    ),
    query(
      'SELECT title, updated_at FROM canvas_drawings WHERE pair_id = $1 ORDER BY updated_at DESC LIMIT 1',
      [pair.id]
    ),
    query('SELECT mood FROM partner_moods WHERE pair_id = $1 AND user_id = $2', [pair.id, req.userId]),
    // Today in the pair's pinned timezone, the same "today" as everything else.
    query(
      'SELECT user_id, symptoms FROM period_daily_logs WHERE user_id = ANY($1::uuid[]) AND log_date = $2',
      [[req.userId, partnerId], today]
    ),
    query('SELECT share_symptoms FROM period_sharing WHERE user_id = $1', [partnerId]),
  ]);

  summary.todaysQuestion = questionRes.rows[0]?.content || null;

  if (dateRes.rows[0]) {
    const at = new Date(dateRes.rows[0].scheduled_for);
    summary.nextDate = {
      title: dateRes.rows[0].title,
      scheduledFor: at.toISOString(),
      daysUntil: Math.max(0, Math.ceil((at.getTime() - Date.now()) / 86400000)),
    };
  }

  summary.lastKissFromPartnerAt = kissInRes.rows[0]?.at || null;
  summary.unseenKisses = Number(kissInRes.rows[0]?.unseen || 0);
  summary.lastKissSentAt = kissOutRes.rows[0]?.at || null;

  if (drawingRes.rows[0]) {
    summary.latestDrawingAt = drawingRes.rows[0].updated_at;
    summary.latestDrawingTitle = drawingRes.rows[0].title;
  }

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
  if (!me?.location_sharing_enabled || !partner?.location_sharing_enabled) {
    summary.distanceStatus = 'sharing_off';
  } else if (me.last_lat == null || partner.last_lat == null) {
    summary.distanceStatus = 'no_location';
  } else {
    summary.distanceStatus = 'ok';
    summary.distanceKm = Number(haversineKm(me.last_lat, me.last_lng, partner.last_lat, partner.last_lng).toFixed(1));
  }

  const { rows: nickRows } = await query(
    'SELECT nickname FROM pair_nicknames WHERE pair_id = $1 AND set_by_id = $2',
    [pair.id, req.userId]
  );
  summary.partnerInitial = initialOf(nickRows[0]?.nickname || partner?.name);

  const art = resolveMascotArt(
    { art: me?.mascot_art, cycleRole: me?.cycle_role },
    { art: partner?.mascot_art, cycleRole: partner?.cycle_role },
    pair.user_a_id === req.userId
  );
  summary.myArt = art.mine;
  summary.partnerArt = art.theirs;

  summary.myMoodEmoji = moodEmoji(myMoodRes.rows[0]?.mood);
  summary.partnerMoodEmoji = moodEmoji(moodRes.rows[0]?.mood);

  const symptomsOf = (id) => {
    const raw = logRes.rows.find((r) => r.user_id === id)?.symptoms;
    return Array.isArray(raw) ? raw : [];
  };
  summary.mySymptomEmoji = symptomEmoji(symptomsOf(req.userId));
  // Two switches, both theirs: the master sharing switch (partnerPeriodRes
  // only returns a row when it is on) and symptoms specifically.
  if (partnerPeriodRes.rows[0] && partnerSharingRes.rows[0]?.share_symptoms) {
    summary.partnerSymptomEmoji = symptomEmoji(symptomsOf(partnerId));
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

/**
 * The latest drawing, downsampled enough to cross a widget's budget.
 *
 * Kept OFF /summary on purpose. Every widget on the home screen hits that
 * endpoint on every refresh; only the canvas widget wants strokes, and a real
 * drawing is tens of thousands of points. Making everyone pay for it would
 * slow down the five widgets that do not care.
 *
 * Downsampling is geometric rather than by count: a stroke drawn slowly has
 * hundreds of points a fraction of a pixel apart, and dropping every Nth one
 * of those loses nothing, while a fast flick has few points that all matter.
 * So points are kept when they are far enough from the last kept one, which
 * preserves the shape of both.
 */
router.get('/drawing', requireWidgetToken, async (req, res) => {
  const { rows: pairRows } = await query(
    `SELECT id FROM pairs WHERE (user_a_id = $1 OR user_b_id = $1) AND unlinked_at IS NULL AND user_b_id IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
    [req.userId]
  );
  if (!pairRows[0]) return res.json({ drawing: null });

  const { rows } = await query(
    `SELECT id, title, canvas_color, stroke_data, updated_at FROM canvas_drawings
      WHERE pair_id = $1 ORDER BY pinned DESC, updated_at DESC LIMIT 1`,
    [pairRows[0].id]
  );
  if (!rows[0]) return res.json({ drawing: null });

  const strokes = (rows[0].stroke_data?.strokes || []).slice(0, WIDGET_DRAWING.strokes);
  let budget = WIDGET_DRAWING.points;

  const thinned = [];
  for (const stroke of strokes) {
    if (budget <= 0) break;
    const kept = [];
    let lastX = null;
    let lastY = null;
    for (const p of stroke.points || []) {
      const far = lastX === null
        || Math.abs(p.x - lastX) + Math.abs(p.y - lastY) >= WIDGET_DRAWING.minStep;
      if (far) {
        kept.push({ x: Math.round(p.x), y: Math.round(p.y) });
        lastX = p.x;
        lastY = p.y;
      }
    }
    // The last point of a stroke is where the finger stopped, so keeping it
    // is the difference between a line that ends and one that stops short.
    const last = stroke.points?.[stroke.points.length - 1];
    if (last && kept.length && (kept[kept.length - 1].x !== Math.round(last.x)
      || kept[kept.length - 1].y !== Math.round(last.y))) {
      kept.push({ x: Math.round(last.x), y: Math.round(last.y) });
    }
    if (kept.length === 0) continue;
    const take = kept.slice(0, budget);
    budget -= take.length;
    thinned.push({ points: take, color: stroke.color, width: stroke.width, tool: stroke.tool });
  }

  res.json({
    drawing: {
      id: rows[0].id,
      title: rows[0].title,
      canvasColor: rows[0].canvas_color,
      updatedAt: rows[0].updated_at,
      strokes: thinned,
    },
  });
});

/**
 * A kiss, sent from a home screen.
 *
 * This is the only WRITE the widget token can perform, and it was worth
 * thinking about before adding. The token lives in plain SharedPreferences /
 * an app group container so a widget process can read it, which is a weaker
 * place than the keychain the real session lives in. So the rule is that
 * anything the widget token can do must be something you would not mind a
 * thief of that phone doing: it can read a summary, and it can tell your
 * partner you are thinking of them. It cannot read a message, post one, see a
 * sealed note, or touch anything else.
 *
 * Rate-limited because a button on a home screen will be pressed by a pocket.
 */
router.post('/kiss', requireWidgetToken, async (req, res) => {
  const { rows: pairRows } = await query(
    `SELECT * FROM pairs WHERE (user_a_id = $1 OR user_b_id = $1) AND unlinked_at IS NULL AND user_b_id IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
    [req.userId]
  );
  const pair = pairRows[0];
  if (!pair) return res.status(409).json({ error: 'Not paired' });

  const kind = normalizeKind(req.body?.kind);

  // One every thirty seconds. Not an error — a pocket press should be a
  // no-op, not a red banner the next time the widget refreshes.
  const { rows: recent } = await query(
    `SELECT created_at FROM nudges
      WHERE pair_id = $1 AND from_id = $2
        AND created_at > now() - ($3 || ' seconds')::interval
      ORDER BY created_at DESC LIMIT 1`,
    [pair.id, req.userId, NUDGE_THROTTLE_SECONDS]
  );
  if (recent[0]) return res.json({ sent: false, throttled: true, at: recent[0].created_at });

  const { rows } = await query(
    'INSERT INTO nudges (pair_id, from_id, kind) VALUES ($1, $2, $3) RETURNING id, kind, created_at',
    [pair.id, req.userId, kind]
  );

  const partnerId = pair.user_a_id === req.userId ? pair.user_b_id : pair.user_a_id;
  req.app.get('io')?.to(`pair:${pair.id}`).emit('nudge:received', { nudge: rows[0], from: req.userId });

  const tokens = await getUserDeviceTokens(partnerId);
  await sendNotification(
    tokens,
    NUDGE_LABELS[kind],
    deepLink('home'),
    { channel: CHANNELS.partner }
  ).catch((err) => console.error('[widget] kiss push failed:', err.message));

  res.status(201).json({ sent: true, nudge: rows[0] });
});

// Marks their kisses as seen, so the widget's little badge clears. Called by
// the app rather than the widget — opening the app is what "seen" means.
router.post('/kiss/seen', requireWidgetToken, async (req, res) => {
  const { rows: pairRows } = await query(
    `SELECT * FROM pairs WHERE (user_a_id = $1 OR user_b_id = $1) AND unlinked_at IS NULL AND user_b_id IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
    [req.userId]
  );
  if (!pairRows[0]) return res.status(409).json({ error: 'Not paired' });
  const { rowCount } = await query(
    'UPDATE nudges SET seen_at = now() WHERE pair_id = $1 AND from_id <> $2 AND seen_at IS NULL',
    [pairRows[0].id, req.userId]
  );
  res.json({ seen: rowCount });
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
