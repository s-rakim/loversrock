import cron from 'node-cron';
import { query } from '../config/db.js';
import { deleteObject } from '../config/storage.js';
import { sendNotification } from '../config/firebase.js';
import { getUserDeviceTokens } from '../models/pairs.js';

const MEMORY_RETENTION_DAYS = 30;
const QUIZ_BANK_WARNING_DAYS = 7;

// Hard-deletes memories soft-deleted more than 30 days ago, including their
// MinIO objects. Runs nightly at 03:00 server time.
async function cleanupExpiredMemories() {
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
async function checkQuizBankLevel() {
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
async function pushWeeklyDateIdea() {
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
    await sendNotification(tokens, {
      title: 'Date idea of the week 💡',
      body: idea.title,
    }).catch((err) => console.error('[cron] weekly date idea push failed:', err.message));
  }
}

export function startCronJobs() {
  cron.schedule('0 3 * * *', cleanupExpiredMemories);
  cron.schedule('0 6 * * *', checkQuizBankLevel);
  cron.schedule('0 9 * * 1', pushWeeklyDateIdea);
  console.log('[cron] jobs scheduled: memory cleanup (nightly), quiz bank check (daily), weekly date idea (Mondays)');
}
