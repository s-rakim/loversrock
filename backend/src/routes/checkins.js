import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import { pairLocalDateString } from '../models/pairs.js';
import { earnSparks, SPARK_REWARDS } from '../models/sparks.js';
import { notifyUser, userName } from '../models/notify.js';

const router = asyncRouter();

router.use(requireAuth, requirePair);

// The monthly check-in. Ratings are 1–5; text answers are optional. Like the
// daily prompt, your partner's answers only come back once you've both sent.
export const CHECKIN_QUESTIONS = [
  { key: 'connection', type: 'rating', text: 'How connected did you feel to each other this month?' },
  { key: 'communication', type: 'rating', text: 'How well did we communicate?' },
  { key: 'quality_time', type: 'rating', text: 'How was our quality time together?' },
  { key: 'fun', type: 'rating', text: 'How much fun did we have?' },
  { key: 'support', type: 'rating', text: 'How supported did you feel?' },
  { key: 'highlight', type: 'text', text: 'What was your favourite moment with me this month?' },
  { key: 'felt_loved', type: 'text', text: 'When did you feel most loved?' },
  { key: 'improve', type: 'text', text: 'What is one thing we could do better next month?' },
  { key: 'looking_forward', type: 'text', text: 'What are you looking forward to together?' },
];

function currentMonth(pair) {
  return pairLocalDateString(pair).slice(0, 7);
}

async function monthView(req, month) {
  const { rows } = await query('SELECT * FROM checkins WHERE pair_id = $1 AND month = $2', [req.pair.id, month]);
  const mine = rows.find((r) => r.user_id === req.userId) || null;
  const partner = rows.find((r) => r.user_id === req.partnerId) || null;
  const both = Boolean(mine && partner);
  return {
    month,
    questions: CHECKIN_QUESTIONS,
    myAnswers: mine?.answers || null,
    partnerAnswers: both ? partner.answers : null,
    partnerDone: Boolean(partner),
    bothDone: both,
  };
}

router.get('/current', async (req, res) => {
  res.json(await monthView(req, currentMonth(req.pair)));
});

router.post('/current', async (req, res) => {
  const { answers } = req.body || {};
  if (!answers || typeof answers !== 'object') return res.status(400).json({ error: 'answers is required' });

  const clean = {};
  for (const q of CHECKIN_QUESTIONS) {
    const v = answers[q.key];
    if (q.type === 'rating') {
      if (!Number.isInteger(v) || v < 1 || v > 5) return res.status(400).json({ error: `${q.key} must be a rating from 1 to 5` });
      clean[q.key] = v;
    } else if (v !== undefined && v !== null && String(v).trim()) {
      clean[q.key] = String(v).trim().slice(0, 2000);
    }
  }

  const month = currentMonth(req.pair);
  await query(
    `INSERT INTO checkins (pair_id, user_id, month, answers) VALUES ($1, $2, $3, $4)
     ON CONFLICT (pair_id, user_id, month) DO UPDATE SET answers = EXCLUDED.answers`,
    [req.pair.id, req.userId, month, JSON.stringify(clean)]
  );
  await earnSparks({ pairId: req.pair.id, userId: req.userId, amount: SPARK_REWARDS.checkin, reason: 'checkin', ref: month });

  const view = await monthView(req, month);
  const name = await userName(req.userId);
  if (view.bothDone) {
    req.app.get('io').to(`pair:${req.pair.id}`).emit('checkin:revealed', { month });
    notifyUser(req.partnerId, 'checkins', { title: 'Your check-in is ready to read 💞', body: `${name} finished this month's check-in too.` }, { screen: 'CheckIn' });
  } else {
    notifyUser(req.partnerId, 'checkins', { title: `${name} did this month's check-in`, body: 'Do yours to see each other\'s answers.' }, { screen: 'CheckIn' });
  }
  res.json(view);
});

// Past months, with averages so trends are visible at a glance.
router.get('/history', async (req, res) => {
  const { rows } = await query('SELECT user_id, month, answers FROM checkins WHERE pair_id = $1 ORDER BY month DESC', [req.pair.id]);
  const months = {};
  for (const r of rows) {
    months[r.month] = months[r.month] || {};
    months[r.month][r.user_id === req.userId ? 'mine' : 'partner'] = r.answers;
  }
  const ratingKeys = CHECKIN_QUESTIONS.filter((q) => q.type === 'rating').map((q) => q.key);
  const history = Object.entries(months).map(([month, { mine, partner }]) => {
    const both = Boolean(mine && partner);
    const all = [mine, both ? partner : null].filter(Boolean);
    const averages = Object.fromEntries(
      ratingKeys.map((k) => [k, all.length ? all.reduce((sum, a) => sum + (a[k] || 0), 0) / all.length : null])
    );
    return { month, myAnswers: mine || null, partnerAnswers: both ? partner : null, bothDone: both, averages };
  });
  res.json({ history, questions: CHECKIN_QUESTIONS });
});

export default router;
