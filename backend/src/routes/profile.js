import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import { uploadBase64Image } from '../config/storage.js';
import { getActivePairForUser } from '../models/pairs.js';
import { notifyUser, NOTIFICATION_CATEGORIES } from '../models/notify.js';
import { sparkBalance } from '../models/sparks.js';

const router = asyncRouter();

router.use(requireAuth);

const SUPPORTED_LANGUAGES = ['en', 'fr', 'es', 'de'];

// Public-to-partner profile fields. Never includes email, password hash, or
// location — the partner profile is what the other person *chose* to share.
function publicProfile(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    avatarUrl: u.avatar_url,
    bio: u.bio,
    birthday: u.birthday,
    loveLanguage: u.love_language,
    favorites: u.favorites || {},
    avatar: u.avatar || null,
    mood: u.mood_emoji ? { emoji: u.mood_emoji, text: u.mood_text, updatedAt: u.mood_updated_at } : null,
  };
}

function daysSince(date) {
  return Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86400000));
}

function pairInfo(pair) {
  if (!pair) return null;
  const since = pair.together_since || pair.created_at;
  return {
    id: pair.id,
    timezone: pair.timezone,
    anniversaryDate: pair.anniversary_date,
    togetherSince: pair.together_since,
    daysTogether: daysSince(since),
    pairedAt: pair.created_at,
    streakCount: pair.streak_count,
    streakFreezes: pair.streak_freezes,
    lostStreak: pair.lost_streak,
    lostStreakOn: pair.lost_streak_on,
    dateSetting: pair.date_setting,
  };
}

// Everything the app needs to know about "us" in one call: who I am, who my
// partner is, and the pair itself. Works unpaired (partner/pair are null).
router.get('/me', async (req, res) => {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.userId]);
  const me = rows[0];
  if (!me) return res.status(404).json({ error: 'User not found' });

  const pair = await getActivePairForUser(req.userId);
  let partner = null;
  if (pair) {
    const partnerId = pair.user_a_id === req.userId ? pair.user_b_id : pair.user_a_id;
    const { rows: partnerRows } = await query('SELECT * FROM users WHERE id = $1', [partnerId]);
    partner = publicProfile(partnerRows[0]);
  }

  res.json({
    me: {
      ...publicProfile(me),
      email: me.email,
      language: me.language,
      notificationPrefs: me.notification_prefs || {},
      onboarding: me.onboarding || null,
      onboardedAt: me.onboarded_at,
    },
    partner,
    pair: pairInfo(pair),
    sparks: pair ? await sparkBalance(req.userId) : 0,
  });
});

router.patch('/', async (req, res) => {
  const { name, bio, birthday, loveLanguage, favorites, language, avatar } = req.body || {};
  if (avatar !== undefined && avatar !== null) {
    if (typeof avatar !== 'object' || Array.isArray(avatar) || JSON.stringify(avatar).length > 4000) {
      return res.status(400).json({ error: 'avatar must be a small object' });
    }
  }
  if (language !== undefined && !SUPPORTED_LANGUAGES.includes(language)) {
    return res.status(400).json({ error: `language must be one of ${SUPPORTED_LANGUAGES.join(', ')}` });
  }
  if (birthday !== undefined && birthday !== null && !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) {
    return res.status(400).json({ error: 'birthday must be YYYY-MM-DD' });
  }
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'name cannot be empty' });

  const { rows } = await query(
    `UPDATE users SET
       name = COALESCE($1, name),
       bio = CASE WHEN $2::boolean THEN $3 ELSE bio END,
       birthday = CASE WHEN $4::boolean THEN $5::date ELSE birthday END,
       love_language = CASE WHEN $6::boolean THEN $7 ELSE love_language END,
       favorites = CASE WHEN $8::boolean THEN $9::jsonb ELSE favorites END,
       language = COALESCE($10, language),
       avatar = CASE WHEN $12::boolean THEN $13::jsonb ELSE avatar END
     WHERE id = $11 RETURNING *`,
    [
      name?.trim() ?? null,
      bio !== undefined, bio ?? null,
      birthday !== undefined, birthday ?? null,
      loveLanguage !== undefined, loveLanguage ?? null,
      favorites !== undefined, favorites ? JSON.stringify(favorites) : null,
      language ?? null,
      req.userId,
      avatar !== undefined, avatar ? JSON.stringify(avatar) : null,
    ]
  );
  if (avatar !== undefined) {
    const pair = await getActivePairForUser(req.userId);
    if (pair) req.app.get('io').to(`pair:${pair.id}`).emit('avatar:update', { userId: req.userId, avatar: rows[0].avatar });
  }
  res.json({ me: { ...publicProfile(rows[0]), email: rows[0].email, language: rows[0].language } });
});

// Onboarding questionnaire. Profile fields it collects (birthday, name) go to
// their real columns; everything else is kept as the answers themselves.
router.post('/onboarding', async (req, res) => {
  const { answers } = req.body || {};
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    return res.status(400).json({ error: 'answers must be an object' });
  }
  const birthday = /^\d{4}-\d{2}-\d{2}$/.test(answers.birthday || '') ? answers.birthday : null;
  const { rows } = await query(
    `UPDATE users SET onboarding = $1::jsonb, onboarded_at = now(), birthday = COALESCE($2::date, birthday)
     WHERE id = $3 RETURNING onboarding, onboarded_at`,
    [JSON.stringify(answers), birthday, req.userId]
  );

  // An anniversary given during onboarding seeds the pair, if there is one
  // and nobody has set it yet.
  if (/^\d{4}-\d{2}-\d{2}$/.test(answers.anniversary || '')) {
    const pair = await getActivePairForUser(req.userId);
    if (pair && !pair.anniversary_date) {
      await query('UPDATE pairs SET anniversary_date = $1, together_since = COALESCE(together_since, $1) WHERE id = $2', [
        answers.anniversary, pair.id,
      ]);
    }
  }
  res.json({ onboarding: rows[0].onboarding, onboardedAt: rows[0].onboarded_at });
});

router.post('/avatar', async (req, res) => {
  const { image } = req.body || {};
  if (!image) return res.status(400).json({ error: 'image (base64 data URL) is required' });
  const key = await uploadBase64Image(image, { prefix: `avatars/${req.userId}` });
  await query('UPDATE users SET avatar_url = $1 WHERE id = $2', [key, req.userId]);
  res.status(201).json({ avatarUrl: key });
});

router.get('/notifications', async (req, res) => {
  const { rows } = await query('SELECT notification_prefs FROM users WHERE id = $1', [req.userId]);
  const prefs = rows[0]?.notification_prefs || {};
  res.json({
    categories: NOTIFICATION_CATEGORIES,
    prefs: Object.fromEntries(NOTIFICATION_CATEGORIES.map((c) => [c, prefs[c] !== false])),
  });
});

router.patch('/notifications', async (req, res) => {
  const updates = req.body || {};
  const clean = {};
  for (const [k, v] of Object.entries(updates)) {
    if (!NOTIFICATION_CATEGORIES.includes(k) || typeof v !== 'boolean') {
      return res.status(400).json({ error: `Unknown category or non-boolean value: ${k}` });
    }
    clean[k] = v;
  }
  const { rows } = await query(
    `UPDATE users SET notification_prefs = notification_prefs || $1::jsonb WHERE id = $2 RETURNING notification_prefs`,
    [JSON.stringify(clean), req.userId]
  );
  const prefs = rows[0].notification_prefs;
  res.json({ prefs: Object.fromEntries(NOTIFICATION_CATEGORIES.map((c) => [c, prefs[c] !== false])) });
});

router.get('/partner', requirePair, async (req, res) => {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.partnerId]);
  res.json({ partner: publicProfile(rows[0]) });
});

// Relationship-level details either partner can edit.
router.patch('/pair', requirePair, async (req, res) => {
  const { anniversaryDate, togetherSince, dateSetting } = req.body || {};
  for (const [label, v] of [['anniversaryDate', anniversaryDate], ['togetherSince', togetherSince]]) {
    if (v !== undefined && v !== null && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      return res.status(400).json({ error: `${label} must be YYYY-MM-DD` });
    }
  }
  const SETTINGS = ['city', 'suburbs', 'rural', 'long_distance'];
  if (dateSetting !== undefined && dateSetting !== null && !SETTINGS.includes(dateSetting)) {
    return res.status(400).json({ error: `dateSetting must be one of ${SETTINGS.join(', ')}` });
  }

  const { rows } = await query(
    `UPDATE pairs SET
       anniversary_date = CASE WHEN $1::boolean THEN $2::date ELSE anniversary_date END,
       together_since = CASE WHEN $3::boolean THEN $4::date ELSE together_since END,
       date_setting = CASE WHEN $5::boolean THEN $6 ELSE date_setting END
     WHERE id = $7 RETURNING *`,
    [
      anniversaryDate !== undefined, anniversaryDate ?? null,
      togetherSince !== undefined, togetherSince ?? null,
      dateSetting !== undefined, dateSetting ?? null,
      req.pair.id,
    ]
  );
  res.json({ pair: pairInfo(rows[0]) });
});

// Lovers X mood: setting it notifies the partner (unless they muted "mood").
router.post('/mood', requirePair, async (req, res) => {
  const { emoji, text } = req.body || {};
  if (!emoji) return res.status(400).json({ error: 'emoji is required' });

  const { rows } = await query(
    `UPDATE users SET mood_emoji = $1, mood_text = $2, mood_updated_at = now() WHERE id = $3
     RETURNING name, mood_emoji, mood_text, mood_updated_at`,
    [emoji, text || null, req.userId]
  );
  await query('INSERT INTO mood_history (pair_id, user_id, emoji, text) VALUES ($1, $2, $3, $4)', [
    req.pair.id, req.userId, emoji, text || null,
  ]);

  const mood = { emoji: rows[0].mood_emoji, text: rows[0].mood_text, updatedAt: rows[0].mood_updated_at };
  req.app.get('io').to(`pair:${req.pair.id}`).emit('mood:update', { userId: req.userId, mood });
  notifyUser(req.partnerId, 'mood', {
    title: `${rows[0].name} is feeling ${emoji}`,
    body: text || 'Tap to see how they are doing.',
  }, { screen: 'Profile' });

  res.json({ mood });
});

router.get('/mood/history', requirePair, async (req, res) => {
  const { rows } = await query(
    `SELECT id, user_id, emoji, text, created_at FROM mood_history WHERE pair_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [req.pair.id]
  );
  res.json({ history: rows });
});

export default router;
