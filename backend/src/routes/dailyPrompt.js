import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import { pairLocalDateString } from '../models/pairs.js';
import { sendNotification, deepLink, CHANNELS } from '../config/firebase.js';
import { getUserDeviceTokens } from '../models/pairs.js';
import { renderFollowUp, pickTemplate } from '../models/followUps.js';

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
    // Only once both have answered, because a follow-up quotes your PARTNER
    // and offering it earlier would leak their answer through the question.
    followUp: bothAnswered ? await followUpFor(req, prompt, partner) : null,
  });
});

/**
 * The follow-up: a question built from what your partner actually said.
 *
 * Adaptive without an LLM. The templates are written by hand and the only
 * thing filled in is their answer, verbatim — nothing rewrites, summarises or
 * interprets it, which for a question that reads as "they said this about me"
 * matters more than cleverness would.
 *
 * Chosen ONCE and stored. A follow-up that re-rolled on every read would
 * change under you between opening the screen and answering, and the answer
 * would end up attached to a question nobody ever saw.
 */
async function followUpFor(req, prompt, partnerResponse) {
  if (!partnerResponse) return null;

  const { rows: existing } = await query(
    `SELECT p.id, p.template_text,
            (SELECT answer FROM prompt_follow_up_answers WHERE pick_id = p.id AND user_id = $3) AS my_answer,
            (SELECT answer FROM prompt_follow_up_answers WHERE pick_id = p.id AND user_id = $4) AS their_answer
       FROM prompt_follow_up_picks p
      WHERE p.pair_id = $1 AND p.prompt_id = $2`,
    [req.pair.id, prompt.id, req.userId, req.partnerId]
  );

  if (existing[0]) {
    const row = existing[0];
    const both = Boolean(row.my_answer && row.their_answer);
    return {
      id: row.id,
      // Rendered per READER, not once for the pair. You are asked about what
      // THEY said, so the two of you get the same question with different
      // words in it.
      question: renderFollowUp(row.template_text, partnerResponse.answer_text),
      myAnswer: row.my_answer,
      // Same reveal rule as everything else in this app.
      partnerAnswer: both ? row.their_answer : null,
      bothAnswered: both,
    };
  }

  // Templates are looked up by the prompt's own category, falling back to a
  // general set — a category with no bank of its own must still get one
  // rather than silently having the feature switched off.
  const { rows: templates } = await query(
    `SELECT id, template, category FROM prompt_follow_ups
      WHERE category = $1 OR category = 'default'
      ORDER BY sort_order, template`,
    [prompt.category]
  );
  // The exact category if it has a bank, the general one only if it does not.
  // Mixing them would mean a connection prompt sometimes getting a generic
  // follow-up when a written-for-it one was sitting right there.
  const exact = templates.filter((t) => t.category === prompt.category);
  const chosen = pickTemplate(exact.length ? exact : templates, `${req.pair.id}:${prompt.id}`);
  if (!chosen) return null;

  const question = renderFollowUp(chosen.template, partnerResponse.answer_text);
  // Nothing worth quoting — a follow-up reading You said "". What is behind
  // that? is worse than no follow-up.
  if (!question) return null;

  const { rows } = await query(
    `INSERT INTO prompt_follow_up_picks (pair_id, prompt_id, follow_up_id, template_text)
     VALUES ($1, $2, $3, $4)
     -- Both phones can hit /today at once; whoever loses the race reads the
     -- winner's pick rather than erroring or creating a second one.
     ON CONFLICT (pair_id, prompt_id) DO UPDATE SET template_text = prompt_follow_up_picks.template_text
     RETURNING id, template_text`,
    [req.pair.id, prompt.id, chosen.id, chosen.template]
  );

  return {
    id: rows[0].id,
    question: renderFollowUp(rows[0].template_text, partnerResponse.answer_text),
    myAnswer: null,
    partnerAnswer: null,
    bothAnswered: false,
  };
}

router.post('/follow-up/:pickId/respond', async (req, res) => {
  const answer = typeof req.body?.answer === 'string' ? req.body.answer.trim() : '';
  if (!answer) return res.status(400).json({ error: 'answer is required' });

  const { rows: pick } = await query(
    'SELECT id FROM prompt_follow_up_picks WHERE id = $1 AND pair_id = $2',
    [req.params.pickId, req.pair.id]
  );
  if (!pick[0]) return res.status(404).json({ error: 'Follow-up not found' });

  await query(
    `INSERT INTO prompt_follow_up_answers (pick_id, user_id, answer)
     VALUES ($1, $2, $3)
     ON CONFLICT (pick_id, user_id) DO UPDATE SET answer = EXCLUDED.answer`,
    [req.params.pickId, req.userId, answer.slice(0, 2000)]
  );

  const { rows } = await query(
    'SELECT user_id, answer FROM prompt_follow_up_answers WHERE pick_id = $1',
    [req.params.pickId]
  );
  const theirs = rows.find((r) => r.user_id === req.partnerId);

  res.json({
    myAnswer: answer,
    partnerAnswer: theirs ? theirs.answer : null,
    bothAnswered: Boolean(theirs),
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
