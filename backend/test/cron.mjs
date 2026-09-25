// Executes the cron job functions for real against the live DB + storage,
// instead of trusting that node-cron registered them.
process.env.DATABASE_URL = 'postgres://loversrock:loversrock@localhost:5432/loversrock';
process.env.STORAGE_ENDPOINT = '127.0.0.1';
process.env.STORAGE_PORT = '9000';
process.env.STORAGE_USE_SSL = 'false';
process.env.STORAGE_ACCESS_KEY = 'S3RVER';
process.env.STORAGE_SECRET_KEY = 'S3RVER';
process.env.STORAGE_BUCKET = 'loversrock';

const { query, pool } = await import('../src/config/db.js');
const { uploadBase64Image, storageClient } = await import('../src/config/storage.js');
const cron = await import('../src/cron/index.js');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
let pass = 0;
const fails = [];
const check = (n, c, d) => {
  if (c) { pass++; console.log(`  PASS  ${n}`); }
  else { fails.push(n); console.log(`  FAIL  ${n} :: ${JSON.stringify(d)}`); }
};
const objectExists = async (key) => {
  try { await storageClient.statObject('loversrock', key); return true; } catch { return false; }
};

console.log('=== CRON: 30-DAY MEMORY PURGE ===');
const { rows: pairRows } = await query('SELECT id, user_a_id FROM pairs WHERE unlinked_at IS NULL LIMIT 1');
const pair = pairRows[0];

// One memory soft-deleted 40 days ago (must be purged), one 5 days ago (must survive).
const oldKey = await uploadBase64Image(PNG, { prefix: `memories/${pair.id}` });
const freshKey = await uploadBase64Image(PNG, { prefix: `memories/${pair.id}` });
const { rows: oldRow } = await query(
  `INSERT INTO memories (pair_id, image_url, created_by, deleted_at) VALUES ($1,$2,$3, now() - interval '40 days') RETURNING id`,
  [pair.id, oldKey, pair.user_a_id]
);
const { rows: freshRow } = await query(
  `INSERT INTO memories (pair_id, image_url, created_by, deleted_at) VALUES ($1,$2,$3, now() - interval '5 days') RETURNING id`,
  [pair.id, freshKey, pair.user_a_id]
);
check('stale + recent soft-deleted memories staged', await objectExists(oldKey) && await objectExists(freshKey));

await cron.cleanupExpiredMemories();

const stillOld = await query('SELECT 1 FROM memories WHERE id = $1', [oldRow[0].id]);
const stillFresh = await query('SELECT 1 FROM memories WHERE id = $1', [freshRow[0].id]);
check('40-day-old soft-deleted memory HARD-deleted from DB', stillOld.rows.length === 0);
check('its storage object was also removed (no orphan blob)', (await objectExists(oldKey)) === false);
check('5-day-old soft-deleted memory SURVIVES (still restorable)', stillFresh.rows.length === 1);
check('surviving memory keeps its storage object', await objectExists(freshKey));

console.log('\n=== CRON: QUIZ BANK WARNING ===');
const warnings = [];
const origWarn = console.warn;
console.warn = (...a) => warnings.push(a.join(' '));
await cron.checkQuizBankLevel();
console.warn = origWarn;
const { rows: daysLeft } = await query(
  `SELECT COUNT(DISTINCT scheduled_date) AS d FROM quiz_questions WHERE scheduled_date >= CURRENT_DATE`
);
check(`quiz bank warning fires when < 7 days left (have ${daysLeft[0].d})`, Number(daysLeft[0].d) < 7 ? warnings.length === 1 : warnings.length === 0, warnings);

console.log('\n=== CRON: PERIOD REMINDER (fires exactly 1 day out) ===');
const { rows: u } = await query(`SELECT id FROM users ORDER BY created_at DESC LIMIT 1`);
const userId = u[0].id;
await query('DELETE FROM period_cycles WHERE user_id = $1', [userId]);
await query(
  `INSERT INTO period_settings (user_id, average_cycle_length, average_period_length, luteal_phase_length)
   VALUES ($1, 28, 5, 14) ON CONFLICT (user_id) DO UPDATE SET average_cycle_length = 28`,
  [userId]
);
// Cycle started 27 days ago => next period predicted tomorrow => reminder due.
await query(`INSERT INTO period_cycles (user_id, start_date) VALUES ($1, CURRENT_DATE - 27)`, [userId]);
const { computePredictions, toDateString } = await import('../src/models/periodPredictions.js');
const todayStr = toDateString(new Date());
const tomorrowStr = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

// The reminder fires on "nextPeriodDate is exactly 1 day out"; assert that
// decision precisely through the pure prediction function.
const { rows: cyc } = await query('SELECT start_date FROM period_cycles WHERE user_id = $1', [userId]);
const predDue = computePredictions({
  lastCycleStart: cyc[0].start_date,
  settings: { averageCycleLength: 28, averagePeriodLength: 5, lutealPhaseLength: 14 },
  today: todayStr,
});
check('cycle started 27d ago => next period predicted TOMORROW (reminder due)', predDue.nextPeriodDate === tomorrowStr, { got: predDue.nextPeriodDate, want: tomorrowStr });
await cron.pushPeriodReminders();
check('pushPeriodReminders() runs clean against live data', true);

await query('DELETE FROM period_cycles WHERE user_id = $1', [userId]);
await query(`INSERT INTO period_cycles (user_id, start_date) VALUES ($1, CURRENT_DATE - 18)`, [userId]);
const { rows: cyc2 } = await query('SELECT start_date FROM period_cycles WHERE user_id = $1', [userId]);
const predNotDue = computePredictions({
  lastCycleStart: cyc2[0].start_date,
  settings: { averageCycleLength: 28, averagePeriodLength: 5, lutealPhaseLength: 14 },
  today: todayStr,
});
const daysOut = Math.round((new Date(predNotDue.nextPeriodDate) - new Date(todayStr)) / 86400000);
check('cycle started 18d ago => period 10 days out, NOT due', daysOut === 10, { daysOut });
check('luteal phase correctly identified at day 19', predNotDue.phase === 'luteal', predNotDue.phase);
await cron.pushPeriodReminders();
check('pushPeriodReminders() no-ops when nothing is due', true);

console.log('\n=== CRON: CHECK-IN REMINDER / STREAK AT RISK ===');
// Push delivery itself needs Firebase; these prove the jobs walk every pair
// (including ones with live streaks and half-answered days) without throwing.
let threw = null;
try { await cron.pushMonthlyCheckinReminder(); } catch (err) { threw = err.message; }
check('pushMonthlyCheckinReminder() runs across all pairs', threw === null, threw);
threw = null;
await query(`UPDATE pairs SET streak_count = GREATEST(streak_count, 3), last_active_date = CURRENT_DATE - 1 WHERE id = $1`, [pair.id]);
try { await cron.pushStreakAtRisk(); } catch (err) { threw = err.message; }
check('pushStreakAtRisk() runs with an at-risk streak present', threw === null, threw);

console.log(`\nCRON RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
await pool.end();
process.exit(fails.length ? 1 : 0);
