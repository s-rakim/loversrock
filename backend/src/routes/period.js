import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import { computeCycleStats, computePredictions, toDateString } from '../models/periodPredictions.js';

const router = asyncRouter();

const DEFAULT_SETTINGS = { averageCycleLength: 28, averagePeriodLength: 5, lutealPhaseLength: 14 };

async function ensureSettings(userId) {
  const { rows } = await query('SELECT * FROM period_settings WHERE user_id = $1', [userId]);
  if (rows[0]) return rows[0];

  const { rows: created } = await query(
    `INSERT INTO period_settings (user_id, average_cycle_length, average_period_length, luteal_phase_length)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [userId, DEFAULT_SETTINGS.averageCycleLength, DEFAULT_SETTINGS.averagePeriodLength, DEFAULT_SETTINGS.lutealPhaseLength]
  );
  return created[0];
}

function settingsPayload(row) {
  return {
    averageCycleLength: row.average_cycle_length,
    averagePeriodLength: row.average_period_length,
    lutealPhaseLength: row.luteal_phase_length,
    sharingEnabled: row.sharing_enabled,
  };
}

async function getLastCycle(userId) {
  const { rows } = await query(
    'SELECT * FROM period_cycles WHERE user_id = $1 ORDER BY start_date DESC LIMIT 1',
    [userId]
  );
  return rows[0] || null;
}

router.use(requireAuth);

router.get('/settings', async (req, res) => {
  const settings = await ensureSettings(req.userId);
  res.json({ settings: settingsPayload(settings) });
});

router.patch('/settings', async (req, res) => {
  await ensureSettings(req.userId);
  const { averageCycleLength, averagePeriodLength, lutealPhaseLength, sharingEnabled } = req.body;

  const { rows } = await query(
    `UPDATE period_settings SET
       average_cycle_length = COALESCE($1, average_cycle_length),
       average_period_length = COALESCE($2, average_period_length),
       luteal_phase_length = COALESCE($3, luteal_phase_length),
       sharing_enabled = COALESCE($4, sharing_enabled),
       updated_at = now()
     WHERE user_id = $5
     RETURNING *`,
    [averageCycleLength ?? null, averagePeriodLength ?? null, lutealPhaseLength ?? null, sharingEnabled ?? null, req.userId]
  );

  res.json({ settings: settingsPayload(rows[0]) });
});

router.get('/cycles', async (req, res) => {
  const { rows } = await query('SELECT * FROM period_cycles WHERE user_id = $1 ORDER BY start_date DESC', [
    req.userId,
  ]);
  res.json({ cycles: rows });
});

router.post('/cycles/start', async (req, res) => {
  const { startDate } = req.body;
  if (!startDate) return res.status(400).json({ error: 'startDate is required' });

  const openCycle = await query('SELECT id FROM period_cycles WHERE user_id = $1 AND end_date IS NULL', [
    req.userId,
  ]);
  if (openCycle.rows.length > 0) {
    return res.status(409).json({ error: 'You already have an open period — end it before starting a new one' });
  }

  const { rows } = await query(
    `INSERT INTO period_cycles (user_id, start_date) VALUES ($1, $2) RETURNING *`,
    [req.userId, startDate]
  );
  res.status(201).json({ cycle: rows[0] });
});

router.post('/cycles/:id/end', async (req, res) => {
  const { endDate } = req.body;
  if (!endDate) return res.status(400).json({ error: 'endDate is required' });

  const { rows } = await query(
    `UPDATE period_cycles SET end_date = $1 WHERE id = $2 AND user_id = $3 RETURNING *`,
    [endDate, req.params.id, req.userId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Cycle not found' });

  // Roll the settings' averages forward from real history now that a
  // fresh completed cycle is available.
  const { rows: allCycles } = await query('SELECT * FROM period_cycles WHERE user_id = $1', [req.userId]);
  const settings = await ensureSettings(req.userId);
  const stats = computeCycleStats(allCycles, {
    averageCycleLength: settings.average_cycle_length,
    averagePeriodLength: settings.average_period_length,
  });
  await query(
    `UPDATE period_settings SET average_cycle_length = $1, average_period_length = $2, updated_at = now() WHERE user_id = $3`,
    [stats.averageCycleLength, stats.averagePeriodLength, req.userId]
  );

  res.json({ cycle: rows[0] });
});

router.delete('/cycles/:id', async (req, res) => {
  const { rowCount } = await query('DELETE FROM period_cycles WHERE id = $1 AND user_id = $2', [
    req.params.id,
    req.userId,
  ]);
  if (rowCount === 0) return res.status(404).json({ error: 'Cycle not found' });
  res.status(204).end();
});

router.get('/log/:date', async (req, res) => {
  const { rows } = await query('SELECT * FROM period_daily_logs WHERE user_id = $1 AND log_date = $2', [
    req.userId,
    req.params.date,
  ]);
  res.json({ log: rows[0] || null });
});

const FLOW_VALUES = ['spotting', 'light', 'medium', 'heavy', 'disaster'];
const ENERGY_VALUES = ['low', 'medium', 'high', 'energized'];
const TEST_VALUES = ['positive', 'negative'];
const PREGNANCY_TEST_VALUES = ['positive', 'faint', 'negative'];
const MUCUS_VALUES = ['dry', 'sticky', 'creamy', 'watery', 'egg_white'];
const SEX_DRIVE_VALUES = ['none', 'low', 'medium', 'high'];
const SHARING_CATEGORIES = ['share_phase', 'share_symptoms', 'share_mood', 'share_flow', 'share_sex_drive', 'share_notes'];

router.post('/log', async (req, res) => {
  const {
    date, flow, symptoms, moods, mood, notes, energy, intercourse, medicine,
    breastSelfExam, ovulationTest, pregnancyTest, cervicalMucus,
    weightKg, temperatureC, waterMl, sexDrive, moment,
  } = req.body;

  if (!date) return res.status(400).json({ error: 'date is required' });

  const oneOf = (value, allowed, field) =>
    value === undefined || value === null || allowed.includes(value)
      ? null
      : `${field} must be one of: ${allowed.join(', ')}`;

  const problem =
    oneOf(flow, FLOW_VALUES, 'flow') ||
    oneOf(energy, ENERGY_VALUES, 'energy') ||
    oneOf(ovulationTest, TEST_VALUES, 'ovulationTest') ||
    oneOf(pregnancyTest, PREGNANCY_TEST_VALUES, 'pregnancyTest') ||
    oneOf(cervicalMucus, MUCUS_VALUES, 'cervicalMucus') ||
    oneOf(sexDrive, SEX_DRIVE_VALUES, 'sexDrive');
  if (problem) return res.status(400).json({ error: problem });

  for (const [field, value] of [['symptoms', symptoms], ['moods', moods], ['medicine', medicine]]) {
    if (value !== undefined && value !== null && !Array.isArray(value)) {
      return res.status(400).json({ error: `${field} must be an array` });
    }
  }
  const numeric = (value, field, min, max) => {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'number' || Number.isNaN(value)) return `${field} must be a number`;
    if (value < min || value > max) return `${field} must be between ${min} and ${max}`;
    return null;
  };
  const numberProblem =
    numeric(weightKg, 'weightKg', 20, 400) ||
    numeric(temperatureC, 'temperatureC', 30, 45) ||
    numeric(waterMl, 'waterMl', 0, 10000);
  if (numberProblem) return res.status(400).json({ error: numberProblem });

  // COALESCE on update: a screen that only saves water must not blank out the
  // symptoms logged from another card on the same day. Explicit nulls are sent
  // as JSON null and still overwrite, which is how a value gets cleared.
  const { rows } = await query(
    `INSERT INTO period_daily_logs (
       user_id, log_date, flow, symptoms, moods, mood, notes, energy, intercourse,
       medicine, breast_self_exam, ovulation_test, pregnancy_test, cervical_mucus,
       weight_kg, temperature_c, water_ml, sex_drive, moment
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     ON CONFLICT (user_id, log_date) DO UPDATE SET
       flow             = COALESCE(EXCLUDED.flow, period_daily_logs.flow),
       symptoms         = COALESCE(EXCLUDED.symptoms, period_daily_logs.symptoms),
       moods            = COALESCE(EXCLUDED.moods, period_daily_logs.moods),
       mood             = COALESCE(EXCLUDED.mood, period_daily_logs.mood),
       notes            = COALESCE(EXCLUDED.notes, period_daily_logs.notes),
       energy           = COALESCE(EXCLUDED.energy, period_daily_logs.energy),
       intercourse      = COALESCE(EXCLUDED.intercourse, period_daily_logs.intercourse),
       medicine         = COALESCE(EXCLUDED.medicine, period_daily_logs.medicine),
       breast_self_exam = COALESCE(EXCLUDED.breast_self_exam, period_daily_logs.breast_self_exam),
       ovulation_test   = COALESCE(EXCLUDED.ovulation_test, period_daily_logs.ovulation_test),
       pregnancy_test   = COALESCE(EXCLUDED.pregnancy_test, period_daily_logs.pregnancy_test),
       cervical_mucus   = COALESCE(EXCLUDED.cervical_mucus, period_daily_logs.cervical_mucus),
       weight_kg        = COALESCE(EXCLUDED.weight_kg, period_daily_logs.weight_kg),
       temperature_c    = COALESCE(EXCLUDED.temperature_c, period_daily_logs.temperature_c),
       water_ml         = COALESCE(EXCLUDED.water_ml, period_daily_logs.water_ml),
       sex_drive        = COALESCE(EXCLUDED.sex_drive, period_daily_logs.sex_drive),
       moment           = COALESCE(EXCLUDED.moment, period_daily_logs.moment),
       updated_at       = now()
     RETURNING *`,
    [
      req.userId, date, flow ?? null,
      symptoms ? JSON.stringify(symptoms) : null,
      moods ? JSON.stringify(moods) : null,
      mood ?? null, notes ?? null, energy ?? null,
      intercourse ? JSON.stringify(intercourse) : null,
      medicine ? JSON.stringify(medicine) : null,
      breastSelfExam ?? null, ovulationTest ?? null, pregnancyTest ?? null,
      cervicalMucus ?? null, weightKg ?? null, temperatureC ?? null, waterMl ?? null,
      sexDrive ?? null, moment ?? null,
    ]
  );

  res.json({ log: rows[0] });
});

router.get('/calendar', async (req, res) => {
  const month = req.query.month; // YYYY-MM
  if (!/^\d{4}-\d{2}$/.test(month || '')) {
    return res.status(400).json({ error: 'month must be formatted YYYY-MM' });
  }

  const { rows: cycles } = await query('SELECT * FROM period_cycles WHERE user_id = $1 ORDER BY start_date', [
    req.userId,
  ]);
  const { rows: logs } = await query(
    `SELECT * FROM period_daily_logs WHERE user_id = $1 AND to_char(log_date, 'YYYY-MM') = $2`,
    [req.userId, month]
  );

  const settings = await ensureSettings(req.userId);
  const lastCycle = cycles[cycles.length - 1];
  const today = toDateString(new Date());
  const predictions = lastCycle
    ? computePredictions({
        lastCycleStart: lastCycle.start_date,
        settings: {
          averageCycleLength: settings.average_cycle_length,
          averagePeriodLength: settings.average_period_length,
          lutealPhaseLength: settings.luteal_phase_length,
        },
        today,
      })
    : null;

  res.json({
    month,
    cycles: cycles.map((c) => ({ startDate: c.start_date, endDate: c.end_date })),
    logs: logs.map((l) => ({
      date: l.log_date,
      flow: l.flow,
      symptoms: l.symptoms || [],
      moods: l.moods || (l.mood ? [l.mood] : []),
      mood: l.mood,
      sexDrive: l.sex_drive,
      hasIntercourse: Boolean(l.intercourse),
      hasNotes: Boolean(l.notes),
    })),
    predictions,
  });
});

router.get('/predictions', async (req, res) => {
  const settings = await ensureSettings(req.userId);
  const lastCycle = await getLastCycle(req.userId);
  const today = toDateString(new Date());

  const predictions = lastCycle
    ? computePredictions({
        lastCycleStart: lastCycle.start_date,
        settings: {
          averageCycleLength: settings.average_cycle_length,
          averagePeriodLength: settings.average_period_length,
          lutealPhaseLength: settings.luteal_phase_length,
        },
        today,
      })
    : null;

  // The Analysis screen stays locked until there is enough history for the
  // averages to mean anything - three logged periods, per the spec.
  const { rows: cycleCount } = await query(
    'SELECT COUNT(*)::int AS n FROM period_cycles WHERE user_id = $1',
    [req.userId]
  );
  const cyclesLogged = cycleCount[0].n;

  res.json({ cyclesLogged, analysisUnlocked: cyclesLogged >= 3, predictions });
});

// Partner view: only ever exposes computed phase/dates, never raw logs,
// flow, symptoms, mood, or notes — see docs/SPEC.md #5. Gated solely on
// the sharer's own sharing_enabled flag, not on the viewer's.
/** The owner's own sharing switches. Creates the row on first read. */
router.get('/sharing', async (req, res) => {
  const { rows } = await query(
    `INSERT INTO period_sharing (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
     RETURNING *`,
    [req.userId]
  );
  const { rows: settings } = await query(
    'SELECT sharing_enabled FROM period_settings WHERE user_id = $1',
    [req.userId]
  );
  res.json({ sharingEnabled: Boolean(settings[0]?.sharing_enabled), categories: rows[0] });
});

/** Only ever writes the caller's own row - there is no userId parameter. */
router.patch('/sharing', async (req, res) => {
  const updates = Object.entries(req.body || {}).filter(([key]) => SHARING_CATEGORIES.includes(key));
  const unknown = Object.keys(req.body || {}).filter(
    (key) => !SHARING_CATEGORIES.includes(key) && key !== 'sharingEnabled'
  );
  if (unknown.length) {
    return res.status(400).json({ error: `unknown sharing categories: ${unknown.join(', ')}` });
  }
  if (updates.some(([, value]) => typeof value !== 'boolean')) {
    return res.status(400).json({ error: 'sharing categories must be booleans' });
  }

  if (typeof req.body?.sharingEnabled === 'boolean') {
    await query(
      `INSERT INTO period_settings (user_id, sharing_enabled) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET sharing_enabled = EXCLUDED.sharing_enabled, updated_at = now()`,
      [req.userId, req.body.sharingEnabled]
    );
  }

  if (updates.length) {
    const sets = updates.map(([key], i) => `${key} = $${i + 2}`).join(', ');
    await query(
      `INSERT INTO period_sharing (user_id) VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING`,
      [req.userId]
    );
    await query(
      `UPDATE period_sharing SET ${sets}, updated_at = now() WHERE user_id = $1`,
      [req.userId, ...updates.map(([, value]) => value)]
    );
  }

  const { rows } = await query('SELECT * FROM period_sharing WHERE user_id = $1', [req.userId]);
  const { rows: settings } = await query(
    'SELECT sharing_enabled FROM period_settings WHERE user_id = $1',
    [req.userId]
  );
  res.json({ sharingEnabled: Boolean(settings[0]?.sharing_enabled), categories: rows[0] });
});

/**
 * The partner's read-only view.
 *
 * Assembled field by field from the categories the owner switched on - a raw
 * daily-log row is never returned, so a column added later cannot leak by
 * default (docs/SPEC.md #5, amended). sharing_enabled is the master switch:
 * with it off, nothing is returned whatever the individual flags say.
 */
router.get('/partner', requirePair, async (req, res) => {
  const { rows } = await query('SELECT * FROM period_settings WHERE user_id = $1', [req.partnerId]);
  const partnerSettings = rows[0];

  if (!partnerSettings || !partnerSettings.sharing_enabled) {
    return res.json({ sharingEnabled: false, predictions: null, today: null });
  }

  const { rows: sharingRows } = await query('SELECT * FROM period_sharing WHERE user_id = $1', [req.partnerId]);
  // No row means the defaults: phase only.
  const sharing = sharingRows[0] || { share_phase: true };

  const lastCycle = await getLastCycle(req.partnerId);
  const today = toDateString(new Date());

  const predictions =
    sharing.share_phase && lastCycle
      ? computePredictions({
          lastCycleStart: lastCycle.start_date,
          settings: {
            averageCycleLength: partnerSettings.average_cycle_length,
            averagePeriodLength: partnerSettings.average_period_length,
            lutealPhaseLength: partnerSettings.luteal_phase_length,
          },
          today,
        })
      : null;

  const { rows: logRows } = await query(
    'SELECT * FROM period_daily_logs WHERE user_id = $1 AND log_date = $2',
    [req.partnerId, today]
  );
  const log = logRows[0];

  const todayView = {};
  if (log) {
    if (sharing.share_symptoms) todayView.symptoms = log.symptoms || [];
    if (sharing.share_mood) todayView.moods = log.moods || (log.mood ? [log.mood] : []);
    if (sharing.share_flow) todayView.flow = log.flow || null;
    if (sharing.share_notes) todayView.notes = log.notes || null;
    if (sharing.share_sex_drive) {
      // Derived, never the raw intercourse record: a partner sees "there was
      // activity logged", not protection, orgasm or counts. The self-reported
      // level rides the same switch - it is the same category of information.
      todayView.sexDriveLogged = Boolean(log.intercourse);
      todayView.sexDrive = log.sex_drive || null;
    }
    // The one-word "Moment" is a feeling, so it follows the mood switch.
    if (sharing.share_mood) todayView.moment = log.moment || null;
    if (Object.keys(todayView).length) todayView.updatedAt = log.updated_at || log.created_at;
  }

  res.json({
    sharingEnabled: true,
    shared: Object.fromEntries(SHARING_CATEGORIES.map((key) => [key, Boolean(sharing[key])])),
    predictions,
    today: Object.keys(todayView).length ? todayView : null,
  });
});

export default router;
