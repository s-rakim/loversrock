import cron from 'node-cron';
import { query } from '../config/db.js';
import { deleteObject } from '../config/storage.js';
import { sendNotification, deepLink, CHANNELS } from '../config/firebase.js';
import { getUserDeviceTokens } from '../models/pairs.js';
import { computePredictions, toDateString } from '../models/periodPredictions.js';
import { fetchQuestions } from '../services/promptSources.js';

const MEMORY_RETENTION_DAYS = 30;
const QUIZ_BANK_WARNING_DAYS = 7;
const PROMPTS_PER_FETCH = 6;

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

// Warns (server log + push to all active pairs' devices would be excessive;
// this is an operator-facing warning) when fewer than 7 days of quiz content
// remain ahead of today.
export async function checkQuizBankLevel() {
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
 * Tops the daily prompt bank up with freshly fetched questions.
 *
 * Fetches PROMPTS_PER_FETCH questions on a randomly chosen topic and schedules
 * them on the soonest upcoming dates that have no prompt yet. Today is never
 * touched - overwriting the question a couple may already be halfway through
 * answering would be worse than running out.
 *
 * Already-scheduled questions are passed as `exclude` so a source that repeats
 * itself can't schedule a duplicate, and scheduled_date is UNIQUE so a double
 * run is a no-op rather than an error.
 */
export async function refreshDailyPrompts(today = new Date()) {
  const start = toDateString(today);

  // Candidate dates: tomorrow through tomorrow + PROMPTS_PER_FETCH.
  const horizon = [];
  for (let offset = 1; offset <= PROMPTS_PER_FETCH; offset++) {
    horizon.push(toDateString(new Date(new Date(`${start}T00:00:00Z`).getTime() + offset * 86400000)));
  }

  const { rows: existing } = await query(
    'SELECT scheduled_date, content FROM daily_prompts WHERE scheduled_date >= $1',
    [start]
  );
  const taken = new Set(existing.map((row) => row.scheduled_date));
  const openDates = horizon.filter((date) => !taken.has(date));

  if (openDates.length === 0) {
    console.log('[cron] daily prompts: bank already full, nothing to fetch');
    return { scheduled: 0, source: 'skipped' };
  }

  const { source, topic, questions } = await fetchQuestions({
    count: openDates.length,
    exclude: existing.map((row) => row.content),
  });

  if (questions.length === 0) {
    console.error('[cron] daily prompts: every source came back empty');
    return { scheduled: 0, source: 'none' };
  }

  let scheduled = 0;
  for (let i = 0; i < Math.min(openDates.length, questions.length); i++) {
    const { rowCount } = await query(
      `INSERT INTO daily_prompts (scheduled_date, category, content, source)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (scheduled_date) DO NOTHING`,
      [openDates[i], topic, questions[i], source]
    );
    scheduled += rowCount;
  }

  console.log(`[cron] daily prompts: +${scheduled} from "${source}" on topic "${topic}"`);
  return { scheduled, source, topic };
}

export function startCronJobs() {
  cron.schedule('0 3 * * *', cleanupExpiredMemories);
  cron.schedule('0 6 * * *', checkQuizBankLevel);
  cron.schedule('0 9 * * 1', pushWeeklyDateIdea);
  cron.schedule('0 8 * * *', pushPeriodReminders);
  // 04:00, before anyone is likely to open the app for the day.
  cron.schedule('0 4 * * *', refreshDailyPrompts);
  console.log(
    '[cron] jobs scheduled: memory cleanup (nightly), quiz bank check (daily), weekly date idea (Mondays), period reminders (daily), prompt refresh (daily)'
  );
}
