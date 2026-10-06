import cron from 'node-cron';
import { releaseScheduledMessages, sendMessageReminders } from '../routes/messages.js';
import { query } from '../config/db.js';
import { deleteObject } from '../config/storage.js';
import { sendNotification, deepLink, CHANNELS } from '../config/firebase.js';
import { getUserDeviceTokens } from '../models/pairs.js';
import { computePredictions, toDateString } from '../models/periodPredictions.js';
import { fetchQuestions, pickTopic } from '../services/promptSources.js';
import { applyPromptBank, BANK_SOURCE } from '../models/promptBank.js';
import { generatePrompts, growCatalogues } from '../models/contentGenerator.js';
import { freshenUpcomingDays, quizLlmConfig } from '../models/quizGenerator.js';

const MEMORY_RETENTION_DAYS = 30;
const QUIZ_BANK_WARNING_DAYS = 7;

// Hard-deletes memories soft-deleted more than 30 days ago, including their
// MinIO objects. Runs nightly at 03:00 server time.
export async function cleanupExpiredMemories() {
  const { rows } = await query(
    `SELECT id, image_url FROM memories
     WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '${MEMORY_RETENTION_DAYS} days'`
  );

  for (const row of rows) {
    await deleteObject(row.image_url).catch((err) =>
      console.error(`[cron] failed to delete storage object ${row.image_url}:`, err.message)
    );
    await query('DELETE FROM memories WHERE id = $1', [row.id]);
  }

  if (rows.length > 0) console.log(`[cron] purged ${rows.length} expired memories`);
}

// How far ahead the quiz is kept stocked.
const QUIZ_HORIZON_DAYS = 14;
const QUESTIONS_PER_DAY = 5;

/**
 * Keeps the quiz bank full.
 *
 * This used to only WARN. The seed ships five days of questions, the daily
 * prompts had a refill job and the quiz did not, so on the sixth day the quiz
 * simply became "No quiz scheduled for today" — permanently, and silently,
 * with nothing but a line in a log nobody reads. It is a daily feature with
 * an expiry date, which is not a feature.
 *
 * There is no new content to invent, and inventing some would need a paid
 * model nobody is buying. So the existing bank is recycled: questions are
 * copied forward onto empty upcoming days, least-recently-used first, which
 * for twenty-five seeded questions means each comes round about every five
 * days. A repeat you answered last week is worth considerably more than an
 * empty screen.
 */
export async function refillQuizBank(today = new Date()) {
  const startOfDay = new Date(today);
  startOfDay.setHours(0, 0, 0, 0);

  // Which of the next fortnight's days have nothing on them.
  const { rows: scheduled } = await query(
    `SELECT DISTINCT scheduled_date FROM quiz_questions
      WHERE scheduled_date >= $1::date AND scheduled_date < $1::date + $2::int`,
    [startOfDay.toISOString().slice(0, 10), QUIZ_HORIZON_DAYS]
  );
  const taken = new Set(scheduled.map((r) => new Date(r.scheduled_date).toISOString().slice(0, 10)));

  const empty = [];
  for (let i = 0; i < QUIZ_HORIZON_DAYS; i += 1) {
    const day = new Date(startOfDay);
    day.setDate(day.getDate() + i);
    const key = day.toISOString().slice(0, 10);
    if (!taken.has(key)) empty.push(key);
  }
  if (empty.length === 0) return { filled: 0, days: 0 };

  // The bank, one row per distinct question, oldest use first. DISTINCT ON
  // collapses the copies a previous refill made, so a question that has been
  // recycled twice is not three times as likely to come round again.
  const { rows: bank } = await query(
    `SELECT DISTINCT ON (question_text)
            question_text, type, choices, correct_answer, scheduled_date
       FROM quiz_questions
      ORDER BY question_text, scheduled_date DESC`
  );
  if (bank.length < QUESTIONS_PER_DAY) {
    console.warn(`[cron] quiz bank has only ${bank.length} questions; cannot fill a day`);
    return { filled: 0, days: 0 };
  }

  // Least recently used first.
  bank.sort((a, b) => new Date(a.scheduled_date) - new Date(b.scheduled_date));

  let cursor = 0;
  let filled = 0;
  for (const day of empty) {
    for (let order = 1; order <= QUESTIONS_PER_DAY; order += 1) {
      const question = bank[cursor % bank.length];
      cursor += 1;
      // ON CONFLICT because (scheduled_date, question_order) is unique and two
      // overlapping runs must not fight over the same slot.
      const { rowCount } = await query(
        `INSERT INTO quiz_questions
           (scheduled_date, question_order, type, question_text, choices, correct_answer)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (scheduled_date, question_order) DO NOTHING`,
        [day, order, question.type, question.question_text,
          question.choices ? JSON.stringify(question.choices) : null, question.correct_answer]
      );
      filled += rowCount;
    }
  }

  if (filled > 0) {
    console.log(`[cron] quiz bank: +${filled} questions across ${empty.length} day(s)`);
  }
  return { filled, days: empty.length };
}

// Warns (server log + push to all active pairs' devices would be excessive;
// this is an operator-facing warning) when fewer than 7 days of quiz content
// remain ahead of today. The refill above should mean this never fires.
export async function checkQuizBankLevel() {
  await refillQuizBank();

  const { rows } = await query(
    `SELECT COUNT(DISTINCT scheduled_date) AS days_remaining
     FROM quiz_questions WHERE scheduled_date >= CURRENT_DATE`
  );
  const daysRemaining = Number(rows[0]?.days_remaining || 0);
  if (daysRemaining < QUIZ_BANK_WARNING_DAYS) {
    console.warn(
      `[cron] quiz question bank is running low: only ${daysRemaining} day(s) of content left`
    );
  }
}

// Weekly random date-idea nudge to every active (non-unlinked) pair.
export async function pushWeeklyDateIdea() {
  const { rows: pairs } = await query(
    `SELECT id, user_a_id, user_b_id FROM pairs WHERE unlinked_at IS NULL`
  );
  const { rows: ideas } = await query(
    `SELECT title FROM date_ideas WHERE pair_id IS NULL ORDER BY random() LIMIT 1`
  );
  const idea = ideas[0];
  if (!idea) return;

  for (const pair of pairs) {
    const tokens = [
      ...(await getUserDeviceTokens(pair.user_a_id)),
      ...(await getUserDeviceTokens(pair.user_b_id)),
    ];
    if (tokens.length === 0) continue;
    await sendNotification(
      tokens,
      { title: 'Date idea of the week 💡', body: idea.title },
      deepLink('partner_update', { screen: 'DateIdeas' }),
      { channel: CHANNELS.partner }
    ).catch((err) => console.error('[cron] weekly date idea push failed:', err.message));
  }
}

// Daily "period expected tomorrow" nudge — personal to each user, never
// sent to their partner (see docs/SPEC.md #5).
export async function pushPeriodReminders() {
  const { rows: settingsRows } = await query('SELECT * FROM period_settings');
  const today = toDateString(new Date());

  for (const settings of settingsRows) {
    const { rows: cycles } = await query(
      'SELECT * FROM period_cycles WHERE user_id = $1 ORDER BY start_date DESC LIMIT 1',
      [settings.user_id]
    );
    const lastCycle = cycles[0];
    if (!lastCycle) continue;

    const predictions = computePredictions({
      lastCycleStart: lastCycle.start_date,
      settings: {
        averageCycleLength: settings.average_cycle_length,
        averagePeriodLength: settings.average_period_length,
        lutealPhaseLength: settings.luteal_phase_length,
      },
      today,
    });

    const daysUntil = predictions.nextPeriodDate
      ? Math.round((new Date(`${predictions.nextPeriodDate}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000)
      : null;

    if (daysUntil === 1) {
      const tokens = await getUserDeviceTokens(settings.user_id);
      if (tokens.length === 0) continue;
      await sendNotification(
        tokens,
        {
          title: 'Period expected tomorrow',
          body: 'Based on your cycle history, your period is expected to start tomorrow.',
        },
        deepLink('period_reminder'),
        { channel: CHANNELS.reminders }
      ).catch((err) => console.error('[cron] period reminder push failed:', err.message));
    }
  }
}

/**
 * The daily questions for the coming month.
 *
 * First from our own 365-day list (models/promptBank.js): every date gets its
 * day-of-the-year question, and an upcoming day nobody has answered that
 * holds anything else goes back to the list's. Only the dates the list cannot
 * fill go to the backup, fetchQuestions: the AI connector if one is set up,
 * then the web sources, then the local files. A day either of you has
 * answered is never touched, and scheduled_date is UNIQUE, so running this
 * twice is a no-op.
 */
export async function refreshDailyPrompts(today = new Date(), { ahead = 30 } = {}) {
  const { added, restored, backup } = await applyPromptBank({ today, ahead });
  let scheduled = added;
  let source = BANK_SOURCE;
  let topic = null;

  if (backup.length) {
    const { rows: existing } = await query(
      `SELECT content FROM daily_prompts WHERE scheduled_date >= $1::date - 180`,
      [toDateString(today)]
    );
    const fetched = await fetchQuestions({ count: backup.length, exclude: existing.map((r) => r.content) });
    source = fetched.source;
    topic = fetched.topic;
    for (let i = 0; i < Math.min(backup.length, fetched.questions.length); i++) {
      const { rowCount } = await query(
        `INSERT INTO daily_prompts (scheduled_date, category, content, source)
         VALUES ($1, $2, $3, $4) ON CONFLICT (scheduled_date) DO NOTHING`,
        [backup[i], fetched.topic, fetched.questions[i], fetched.source]
      );
      scheduled += rowCount;
    }
  }

  if (scheduled || restored) {
    console.log(`[cron] daily prompts: +${added} from the list, ${restored} put back to the list`
      + (backup.length ? `, +${scheduled - added} from "${source}" as backup` : ''));
  }
  return { scheduled, restored, fromBank: added, backup: backup.length, source, topic };
}

/**
 * Fresh questions for the coming week, when a language model is configured
 * (models/quizGenerator.js). Replaces only days nobody has started and whose
 * questions are all recycled repeats, so it pays for new questions once per
 * day rather than re-writing the week every night. Without a model this
 * does nothing, and the recycled bank carries on as before.
 */
export async function freshenQuiz({ retry = false } = {}) {
  let config;
  try {
    config = patient(quizLlmConfig());
  } catch (err) {
    console.error(`[cron] quiz generator is misconfigured: ${err.message}`);
    return;
  }
  if (!config) return;
  try {
    await refillQuizBank();
    const { days, questions } = await freshenUpcomingDays({ days: 7, config });
    if (days.length) console.log(`[cron] quiz: ${questions} fresh questions from ${config.provider} for ${days.join(', ')}`);
  } catch (err) {
    // A bad key, a rate limit, an outage: the recycled questions stay, and
    // tomorrow's run tries again (or, if it was only busy, an hour from now).
    console.error(`[cron] quiz generator failed (${config.provider}): ${err.message}`);
    if (err.busy && !retry) laterAgain('quiz generator', () => freshenQuiz({ retry: true }));
  }
}

// The nightly jobs have time: a busy provider is waited on for a while,
// much longer than a screen someone is looking at could wait.
const PATIENT_WAITS = [15 * 1000, 60 * 1000, 3 * 60 * 1000];
function patient(config) {
  return config ? { ...config, busyWaits: PATIENT_WAITS } : config;
}

// Still busy after all that: one more go in an hour, instead of leaving it
// to the next scheduled run (a week away, for the catalogues).
const RETRY_LATER_MS = 60 * 60 * 1000;
function laterAgain(what, run) {
  console.log(`[cron] ${what}: the AI is busy; trying again in an hour`);
  setTimeout(run, RETRY_LATER_MS).unref?.();
}

/** The AI connector, or null when there is none (or it is misconfigured). */
function aiConfig() {
  try {
    return quizLlmConfig();
  } catch (err) {
    console.error(`[cron] AI connector is misconfigured: ${err.message}`);
    return null;
  }
}

/**
 * AI-written questions on the coming week's daily prompts. The nightly fetch
 * already asks the AI first for empty days; this also replaces upcoming days
 * that came from the web or the built-in bank, as long as nobody has answered
 * them yet, so with a connector set up every prompt is a fresh one.
 */
export async function freshenPrompts({ days = 7, includeToday = false, today = new Date(), config = aiConfig(), dryRun = false } = {}) {
  if (!config) return { replaced: 0, preview: [] };
  const first = new Date(`${toDateString(today)}T00:00:00Z`);
  if (!includeToday) first.setUTCDate(first.getUTCDate() + 1);
  const { rows } = await query(
    `SELECT d.id, d.scheduled_date FROM daily_prompts d
      WHERE d.scheduled_date >= $1::date AND d.scheduled_date < $1::date + $2::int
        AND d.source NOT LIKE 'ai:%'
        AND NOT EXISTS (SELECT 1 FROM prompt_responses r WHERE r.prompt_id = d.id)
      ORDER BY d.scheduled_date`,
    [toDateString(first), days]
  );
  if (!rows.length) return { replaced: 0, preview: [] };
  const { rows: all } = await query('SELECT content FROM daily_prompts');
  const topic = pickTopic();
  const fresh = await generatePrompts(rows.length, all.map((r) => r.content), { topic, config });
  if (dryRun) return { replaced: 0, preview: fresh, topic };
  let replaced = 0;
  for (let i = 0; i < Math.min(rows.length, fresh.length); i += 1) {
    const { rowCount } = await query(
      `UPDATE daily_prompts SET content = $1, category = $2, source = $3
        WHERE id = $4 AND NOT EXISTS (SELECT 1 FROM prompt_responses r WHERE r.prompt_id = $4)`,
      [fresh[i], topic, `ai:${config.provider}`, rows[i].id]
    );
    replaced += rowCount;
  }
  return { replaced, preview: [], topic };
}

/**
 * Nightly: the coming month's questions, from the 365-day list first.
 *
 * It used to go on to replace the week's questions with AI-written ones
 * whenever a connector was set up; the list is the daily question now, and
 * the AI only fills what the list cannot (refreshDailyPrompts). freshenPrompts
 * is still there for `npm run ai:generate -- --only prompts`, on request.
 */
export async function freshenDailyPrompts() {
  try {
    await refreshDailyPrompts();
  } catch (err) {
    console.error(`[cron] daily prompts failed: ${err.message}`);
  }
}

/**
 * Weekly: new date ideas (the Date Ideas and Swipe Dates catalogue),
 * bucket-list ideas and challenges from the AI connector. `onlyIfNew` is the
 * startup run: it does nothing once the AI has ever added anything, so a
 * restart does not ask the provider again.
 */
export async function growContent({ onlyIfNew = false, retry = false } = {}) {
  const config = patient(aiConfig());
  if (!config) return;
  try {
    if (onlyIfNew) {
      const { rows } = await query(`SELECT EXISTS (SELECT 1 FROM date_ideas WHERE source = 'ai') AS done`);
      if (rows[0].done) return;
    }
    const added = await growCatalogues({ config });
    console.log(`[cron] content from ${config.provider}: +${added.dateIdeas.length} date ideas, `
      + `+${added.bucketIdeas.length} bucket-list ideas, +${added.challenges.length} challenges`);
  } catch (err) {
    console.error(`[cron] content generation failed (${config.provider}): ${err.message}`);
    if (err.busy && !retry) laterAgain('content generation', () => growContent({ onlyIfNew, retry: true }));
  }
}

export function startCronJobs() {
  // Every minute: scheduled messages whose time has come, and "remind me
  // about this message" reminders that are due.
  cron.schedule('* * * * *', () => {
    releaseScheduledMessages().catch((err) => console.error('[cron] scheduled messages:', err.message));
    sendMessageReminders().catch((err) => console.error('[cron] message reminders:', err.message));
  });
  cron.schedule('0 3 * * *', cleanupExpiredMemories);
  cron.schedule('0 6 * * *', checkQuizBankLevel);
  cron.schedule('0 9 * * 1', pushWeeklyDateIdea);
  cron.schedule('0 8 * * *', pushPeriodReminders);
  // 04:00, before anyone is likely to open the app for the day.
  cron.schedule('0 4 * * *', freshenDailyPrompts);
  // Sundays, early: the catalogues grow by a handful a week.
  cron.schedule('15 5 * * 0', () => growContent());
  cron.schedule('30 6 * * *', freshenQuiz);
  // And once shortly after starting, so a key added to .env shows up in the
  // quiz from tomorrow rather than a week of recycled days later.
  setTimeout(() => {
    freshenQuiz();
    freshenDailyPrompts();
    growContent({ onlyIfNew: true });
  }, 60 * 1000).unref?.();
  console.log(
    '[cron] jobs scheduled: memory cleanup (nightly), quiz bank check (daily), fresh quiz questions (daily, if a model is set), weekly date idea (Mondays), period reminders (daily), prompt refresh (daily)'
  );
}
