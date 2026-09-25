import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import { pairLocalDateString } from '../models/pairs.js';
import { sendNotification, deepLink, CHANNELS } from '../config/firebase.js';
import { getUserDeviceTokens } from '../models/pairs.js';

const router = asyncRouter();

router.use(requireAuth, requirePair);

// Reveal-after-both is enforced here, not just hidden in the UI: the
// partner's answer is only ever included in the response once both rows exist.
router.get('/today', async (req, res) => {
  const today = pairLocalDateString(req.pair);

  const { rows: promptRows } = await query(
    'SELECT * FROM daily_prompts WHERE scheduled_date = $1',
    [today]
  );
  const prompt = promptRows[0];
  if (!prompt) return res.status(404).json({ error: 'No prompt scheduled for today' });

  const { rows: responses } = await query(
    'SELECT * FROM prompt_responses WHERE pair_id = $1 AND prompt_id = $2',
    [req.pair.id, prompt.id]
  );

  const mine = responses.find((r) => r.user_id === req.userId) || null;
  const partner = responses.find((r) => r.user_id === req.partnerId) || null;
  const bothAnswered = Boolean(mine && partner);

  res.json({
    prompt: { id: prompt.id, category: prompt.category, content: prompt.content, scheduledDate: prompt.scheduled_date },
    myAnswer: mine ? mine.answer_text : null,
    partnerAnswer: bothAnswered ? partner.answer_text : null,
    bothAnswered,
    streakCount: req.pair.streak_count,
  });
});

router.post('/today/respond', async (req, res) => {
  const { answerText } = req.body;
  if (!answerText) return res.status(400).json({ error: 'answerText is required' });

  const today = pairLocalDateString(req.pair);
  const { rows: promptRows } = await query('SELECT * FROM daily_prompts WHERE scheduled_date = $1', [today]);
  const prompt = promptRows[0];
  if (!prompt) return res.status(404).json({ error: 'No prompt scheduled for today' });

  await query(
    `INSERT INTO prompt_responses (pair_id, prompt_id, user_id, answer_text)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (pair_id, prompt_id, user_id) DO UPDATE SET answer_text = EXCLUDED.answer_text`,
    [req.pair.id, prompt.id, req.userId, answerText]
  );

  const { rows: responses } = await query(
    'SELECT * FROM prompt_responses WHERE pair_id = $1 AND prompt_id = $2',
    [req.pair.id, prompt.id]
  );
  const mine = responses.find((r) => r.user_id === req.userId);
  const partner = responses.find((r) => r.user_id === req.partnerId);
  const bothAnswered = Boolean(mine && partner);

  let newStreak = req.pair.streak_count;

  if (bothAnswered) {
    // Streak is attributed to the pair-local calendar day, not to when the
    // cron/server happens to process it — computed inline, right here.
    const { rows: pairRows } = await query('SELECT last_active_date FROM pairs WHERE id = $1', [req.pair.id]);
    const lastActiveDate = pairRows[0].last_active_date;

    if (lastActiveDate !== today) {
      const yesterday = new Date(new Date(`${today}T00:00:00Z`).getTime() - 86400000)
        .toISOString()
        .slice(0, 10);
      const continued = lastActiveDate === yesterday;
      newStreak = continued ? req.pair.streak_count + 1 : 1;

      // A streak that just broke is REMEMBERED rather than simply zeroed, so
      // it can be offered back (see routes/achievements.js). Without this the
      // number is gone the instant it lapses and there is nothing to repair.
      // Only worth keeping if it was actually a streak — losing a one-day
      // "streak" is not a loss.
      const broke = !continued && req.pair.streak_count > 1;

      await query(
        `UPDATE pairs
            SET streak_count = $1,
                last_active_date = $2,
                longest_streak = GREATEST(longest_streak, $1),
                broken_streak = CASE WHEN $4::boolean THEN $5 ELSE broken_streak END,
                broken_streak_at = CASE WHEN $4::boolean THEN $2::date ELSE broken_streak_at END
          WHERE id = $3`,
        [newStreak, today, req.pair.id, broke, broke ? req.pair.streak_count : null]
      );
    }

    // Idempotent "both answered" push: notified_at is only set once we've
    // actually fired the push, so a retried request never double-sends.
    if (!mine.notified_at || !partner.notified_at) {
      const partnerTokens = await getUserDeviceTokens(req.partnerId);
      const myTokens = await getUserDeviceTokens(req.userId);
      await sendNotification(
        [...partnerTokens, ...myTokens],
        {
          title: "You both answered today's prompt 💛",
          body: 'Tap to see what your partner said.',
        },
        deepLink('prompt'),
        { channel: CHANNELS.partner }
      ).catch((err) => console.error('[daily-prompt] push failed:', err.message));

      await query('UPDATE prompt_responses SET notified_at = now() WHERE pair_id = $1 AND prompt_id = $2', [
        req.pair.id,
        prompt.id,
      ]);
    }
  }

  res.json({
    myAnswer: answerText,
    partnerAnswer: bothAnswered ? partner.answer_text : null,
    bothAnswered,
    streakCount: newStreak,
  });
});

export default router;
