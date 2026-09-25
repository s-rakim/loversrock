// The monthly check-in, and the random challenge.
//
// They share a file because they share a purpose: both are the app asking the
// two of you to do something deliberate rather than waiting to be opened.
// One looks back over a month, the other asks for one thing today.
import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import { getUserDeviceTokens } from '../models/pairs.js';
import { sendNotification, deepLink, CHANNELS } from '../config/firebase.js';
import {
  CHECKIN_QUESTIONS, normalizeAnswer, monthOf, averageScore,
} from '../models/checkins.js';

const router = asyncRouter();

router.use(requireAuth, requirePair);

const emit = (req, event, payload) =>
  req.app.get('io')?.to(`pair:${req.pair.id}`).emit(event, payload);

/* ------------------------------------------------------------- check-ins */

/** Finds or opens this month's check-in. One per pair per month. */
async function currentCheckin(pairId, month) {
  const { rows } = await query(
    `INSERT INTO checkins (pair_id, month) VALUES ($1, $2)
     -- Both of you can open the screen at the same moment on the 1st.
     ON CONFLICT (pair_id, month) DO UPDATE SET month = EXCLUDED.month
     RETURNING *`,
    [pairId, month]
  );
  return rows[0];
}

router.get('/questions', (req, res) => res.json({ questions: CHECKIN_QUESTIONS }));

router.get('/current', async (req, res) => {
  const month = monthOf();
  const checkin = await currentCheckin(req.pair.id, month);

  const [{ rows: answers }, { rows: done }] = await Promise.all([
    query('SELECT * FROM checkin_answers WHERE checkin_id = $1', [checkin.id]),
    query('SELECT * FROM checkin_completions WHERE checkin_id = $1', [checkin.id]),
  ]);

  const iAmDone = done.some((d) => d.user_id === req.userId);
  const theyAreDone = done.some((d) => d.user_id === req.partnerId);
  const bothDone = iAmDone && theyAreDone;

  const mine = answers.filter((a) => a.user_id === req.userId);
  const theirs = answers.filter((a) => a.user_id === req.partnerId);

  res.json({
    checkin: { id: checkin.id, month: checkin.month },
    questions: CHECKIN_QUESTIONS,
    mine: mine.map((a) => ({ questionKey: a.question_key, score: a.score, answer: a.answer })),
    // Same reveal rule as everything else: their side is invisible until both
    // have finished. A check-in you can read halfway through is one you write
    // differently, and then it measures nothing.
    theirs: bothDone
      ? theirs.map((a) => ({ questionKey: a.question_key, score: a.score, answer: a.answer }))
      : [],
    iAmDone,
    theyAreDone,
    bothDone,
    myAverage: averageScore(mine),
    theirAverage: bothDone ? averageScore(theirs) : null,
  });
});

router.put('/current', async (req, res) => {
  const checkin = await currentCheckin(req.pair.id, monthOf());

  const { rows: done } = await query(
    'SELECT 1 FROM checkin_completions WHERE checkin_id = $1 AND user_id = $2',
    [checkin.id, req.userId]
  );
  // Finished means finished. Otherwise you could read their answers, then go
  // back and change yours to match, which is exactly the thing the reveal
  // rule exists to prevent.
  if (done[0]) return res.status(409).json({ error: 'You have already finished this month' });

  const answers = req.body?.answers;
  if (!answers || typeof answers !== 'object') {
    return res.status(400).json({ error: 'answers is required' });
  }

  for (const [key, raw] of Object.entries(answers)) {
    const norm = normalizeAnswer(key, raw);
    if (!norm.ok) return res.status(400).json({ error: norm.error });
    await query(
      `INSERT INTO checkin_answers (checkin_id, user_id, question_key, score, answer)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (checkin_id, user_id, question_key)
       DO UPDATE SET score = EXCLUDED.score, answer = EXCLUDED.answer`,
      [checkin.id, req.userId, key, norm.value.score, norm.value.answer]
    );
  }

  res.json({ saved: Object.keys(answers).length });
});

router.post('/current/finish', async (req, res) => {
  const checkin = await currentCheckin(req.pair.id, monthOf());

  const { rows: answers } = await query(
    'SELECT question_key FROM checkin_answers WHERE checkin_id = $1 AND user_id = $2',
    [checkin.id, req.userId]
  );
  const answered = new Set(answers.map((a) => a.question_key));
  const missing = CHECKIN_QUESTIONS.filter((q) => !answered.has(q.key)).map((q) => q.key);
  if (missing.length) return res.status(400).json({ error: 'Not finished yet', missing });

  await query(
    `INSERT INTO checkin_completions (checkin_id, user_id) VALUES ($1, $2)
     ON CONFLICT (checkin_id, user_id) DO NOTHING`,
    [checkin.id, req.userId]
  );

  const { rows: done } = await query('SELECT user_id FROM checkin_completions WHERE checkin_id = $1', [checkin.id]);
  const bothDone = done.length === 2;

  emit(req, 'checkin:updated', { checkinId: checkin.id, bothDone });

  const tokens = await getUserDeviceTokens(req.partnerId);
  await sendNotification(
    tokens,
    bothDone
      ? { title: 'Your check-in is ready', body: 'You have both finished — tap to read theirs.' }
      : { title: 'They finished the monthly check-in', body: 'Yours unlocks theirs.' },
    deepLink('checkin'),
    { channel: CHANNELS.partner }
  ).catch((err) => console.error('[checkin] push failed:', err.message));

  res.json({ bothDone });
});

/** Every finished month, for the chart. */
router.get('/history', async (req, res) => {
  const { rows } = await query(
    `SELECT c.id, c.month,
            a.user_id, a.question_key, a.score
       FROM checkins c
       JOIN checkin_answers a ON a.checkin_id = c.id
      WHERE c.pair_id = $1
        -- Only months BOTH of you finished. A half-finished month on a chart
        -- reads as a dip in the relationship rather than a dip in form-filling.
        AND (SELECT count(*) FROM checkin_completions cc WHERE cc.checkin_id = c.id) = 2
      ORDER BY c.month`,
    [req.pair.id]
  );

  const byMonth = new Map();
  for (const row of rows) {
    if (!byMonth.has(row.id)) byMonth.set(row.id, { month: row.month, mine: [], theirs: [] });
    const entry = byMonth.get(row.id);
    (row.user_id === req.userId ? entry.mine : entry.theirs).push(row);
  }

  res.json({
    history: [...byMonth.values()].map((m) => ({
      month: m.month,
      myAverage: averageScore(m.mine),
      theirAverage: averageScore(m.theirs),
    })),
  });
});

/* ------------------------------------------------------------ challenges */

router.get('/challenge', async (req, res) => {
  const { rows } = await query(
    `SELECT pc.id, pc.status, pc.drawn_at, pc.drawn_by, c.slug, c.title, c.detail, c.scope, c.category
       FROM pair_challenges pc JOIN challenges c ON c.id = pc.challenge_id
      WHERE pc.pair_id = $1 AND pc.status = 'open'
      LIMIT 1`,
    [req.pair.id]
  );
  const { rows: history } = await query(
    `SELECT pc.id, pc.status, pc.closed_at, c.title, c.scope
       FROM pair_challenges pc JOIN challenges c ON c.id = pc.challenge_id
      WHERE pc.pair_id = $1 AND pc.status <> 'open'
      ORDER BY pc.closed_at DESC NULLS LAST LIMIT 20`,
    [req.pair.id]
  );
  const { rows: counts } = await query(
    `SELECT count(*)::int AS done FROM pair_challenges WHERE pair_id = $1 AND status = 'done'`,
    [req.pair.id]
  );
  res.json({ challenge: rows[0] || null, history, completed: counts[0].done });
});

router.post('/challenge/draw', async (req, res) => {
  const { rows: open } = await query(
    `SELECT pc.id, c.title FROM pair_challenges pc JOIN challenges c ON c.id = pc.challenge_id
      WHERE pc.pair_id = $1 AND pc.status = 'open' LIMIT 1`,
    [req.pair.id]
  );
  // Drawing again while one is open turns this into a slot machine you pull
  // until you get an easy one.
  if (open[0]) return res.status(409).json({ error: 'You already have one open', challenge: open[0] });

  const { rows } = await query(
    `SELECT c.* FROM challenges c
      WHERE NOT EXISTS (
        SELECT 1 FROM pair_challenges pc
         WHERE pc.challenge_id = c.id AND pc.pair_id = $1 AND pc.status = 'done'
      )
      ORDER BY random() LIMIT 1`,
    [req.pair.id]
  );

  // Every one done at least once. Rather than refusing, the bank reopens —
  // "you have finished them all, here is one again" beats a dead button.
  const pick = rows[0] || (await query('SELECT * FROM challenges ORDER BY random() LIMIT 1')).rows[0];
  if (!pick) return res.status(503).json({ error: 'No challenges are loaded' });

  const { rows: created } = await query(
    `INSERT INTO pair_challenges (pair_id, challenge_id, drawn_by) VALUES ($1, $2, $3)
     -- The partial unique index does the real work: if both of you tap draw
     -- at once, the second insert loses and reads the first one's challenge.
     ON CONFLICT DO NOTHING
     RETURNING id, drawn_at`,
    [req.pair.id, pick.id, req.userId]
  );

  if (!created[0]) {
    const { rows: theirs } = await query(
      `SELECT pc.id, pc.drawn_at, c.slug, c.title, c.detail, c.scope, c.category
         FROM pair_challenges pc JOIN challenges c ON c.id = pc.challenge_id
        WHERE pc.pair_id = $1 AND pc.status = 'open' LIMIT 1`,
      [req.pair.id]
    );
    return res.json({ challenge: theirs[0] || null, raced: true });
  }

  const challenge = {
    id: created[0].id,
    drawn_at: created[0].drawn_at,
    status: 'open',
    slug: pick.slug,
    title: pick.title,
    detail: pick.detail,
    scope: pick.scope,
    category: pick.category,
  };

  emit(req, 'challenge:drawn', { challenge, by: req.userId });

  const tokens = await getUserDeviceTokens(req.partnerId);
  await sendNotification(
    tokens,
    { title: 'A challenge', body: pick.title },
    deepLink('challenge'),
    { channel: CHANNELS.partner }
  ).catch((err) => console.error('[challenge] push failed:', err.message));

  res.status(201).json({ challenge });
});

router.post('/challenge/:id/close', async (req, res) => {
  const status = req.body?.status === 'skipped' ? 'skipped' : 'done';

  const { rows } = await query(
    `UPDATE pair_challenges SET status = $3, closed_at = now()
      WHERE id = $1 AND pair_id = $2 AND status = 'open'
      RETURNING id, status`,
    [req.params.id, req.pair.id, status]
  );
  if (!rows[0]) return res.status(404).json({ error: 'No open challenge with that id' });

  emit(req, 'challenge:closed', { id: rows[0].id, status: rows[0].status, by: req.userId });
  res.json({ challenge: rows[0] });
});

export default router;
