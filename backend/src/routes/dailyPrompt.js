import { Router } from "express";
import { query } from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";
import { getActivePairForUser, getPartnerUserId } from "../models/pairs.js";
import { sendNotification } from "../config/firebase.js";

export const dailyPromptRouter = Router();

// "Today" is always computed in the PAIR's timezone (pinned decision #2 in SPEC.md),
// never the requesting device's local timezone.
function todayInTimezone(timezone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date()); // YYYY-MM-DD
}

dailyPromptRouter.get("/today", requireAuth, async (req, res) => {
  const pair = await getActivePairForUser(req.userId);
  if (!pair) return res.status(400).json({ error: "You don't have a partner linked yet" });

  const today = todayInTimezone(pair.timezone);

  const { rows: promptRows } = await query(
    `SELECT * FROM daily_prompts WHERE scheduled_date = $1`,
    [today]
  );
  const prompt = promptRows[0];
  if (!prompt) return res.status(404).json({ error: "No prompt scheduled for today yet" });

  const { rows: responses } = await query(
    `SELECT user_id, answer_text, created_at FROM prompt_responses
     WHERE pair_id = $1 AND prompt_id = $2`,
    [pair.id, prompt.id]
  );

  const myResponse = responses.find((r) => r.user_id === req.userId) || null;
  const partnerResponse = responses.find((r) => r.user_id !== req.userId) || null;
  const bothAnswered = responses.length === 2;

  return res.json({
    prompt: { id: prompt.id, category: prompt.category, content: prompt.content },
    myResponse,
    // Enforced server-side, not just hidden in the UI: partner's answer is only
    // ever included in the response once both have answered.
    partnerResponse: bothAnswered ? partnerResponse : null,
    bothAnswered,
    streakCount: pair.streak_count,
  });
});

dailyPromptRouter.post("/today/respond", requireAuth, async (req, res) => {
  const { answerText } = req.body;
  if (!answerText) return res.status(400).json({ error: "answerText is required" });

  const pair = await getActivePairForUser(req.userId);
  if (!pair) return res.status(400).json({ error: "You don't have a partner linked yet" });

  const today = todayInTimezone(pair.timezone);
  const { rows: promptRows } = await query(`SELECT * FROM daily_prompts WHERE scheduled_date = $1`, [
    today,
  ]);
  const prompt = promptRows[0];
  if (!prompt) return res.status(404).json({ error: "No prompt scheduled for today yet" });

  await query(
    `INSERT INTO prompt_responses (pair_id, prompt_id, user_id, answer_text)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (pair_id, prompt_id, user_id) DO UPDATE SET answer_text = EXCLUDED.answer_text`,
    [pair.id, prompt.id, req.userId, answerText]
  );

  // Check if both have now answered, and fire the "reveal" push exactly once
  // (idempotency via notified_at, per SPEC.md 3.2).
  const { rows: responses } = await query(
    `SELECT user_id, notified_at FROM prompt_responses WHERE pair_id = $1 AND prompt_id = $2`,
    [pair.id, prompt.id]
  );

  if (responses.length === 2 && responses.every((r) => !r.notified_at)) {
    await query(
      `UPDATE prompt_responses SET notified_at = now() WHERE pair_id = $1 AND prompt_id = $2`,
      [pair.id, prompt.id]
    );
    const partnerId = await getPartnerUserId(req.userId);
    const { rows: devices } = await query(
      `SELECT fcm_token FROM user_devices WHERE user_id IN ($1, $2)`,
      [req.userId, partnerId]
    );
    await sendNotification(
      devices.map((d) => d.fcm_token),
      "Today's answers are in! 🕯️",
      "You both answered today's question — tap to reveal each other's answers."
    );

    // Streak update, attributed to the pair's local calendar day (SPEC.md 3.3),
    // not dependent on cron timing.
    await updateStreak(pair);
  }

  return res.status(204).send();
});

async function updateStreak(pair) {
  const today = todayInTimezone(pair.timezone);
  const isConsecutive =
    pair.last_active_date &&
    new Date(today) - new Date(pair.last_active_date) === 24 * 60 * 60 * 1000;

  const newStreak = isConsecutive ? pair.streak_count + 1 : 1;
  await query(`UPDATE pairs SET streak_count = $1, last_active_date = $2 WHERE id = $3`, [
    newStreak,
    today,
    pair.id,
  ]);
}
