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

const FLOW_VALUES = ['spotting', 'light', 'medium', 'heavy'];

router.post('/log', async (req, res) => {
  const { date, flow, symptoms, mood, notes } = req.body;
  if (!date) return res.status(400).json({ error: 'date is required' });
  if (flow && !FLOW_VALUES.includes(flow)) {
    return res.status(400).json({ error: `flow must be one of: ${FLOW_VALUES.join(', ')}` });
  }
  if (symptoms && !Array.isArray(symptoms)) {
    return res.status(400).json({ error: 'symptoms must be an array' });
  }

  const { rows } = await query(
    `INSERT INTO period_daily_logs (user_id, log_date, flow, symptoms, mood, notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, log_date) DO UPDATE SET
       flow = EXCLUDED.flow, symptoms = EXCLUDED.symptoms, mood = EXCLUDED.mood, notes = EXCLUDED.notes
     RETURNING *`,
    [req.userId, date, flow || null, symptoms ? JSON.stringify(symptoms) : null, mood || null, notes || null]
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
    logs: logs.map((l) => ({ date: l.log_date, flow: l.flow, symptoms: l.symptoms, mood: l.mood, hasNotes: Boolean(l.notes) })),
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

  res.json({ predictions });
});

// Partner view: only ever exposes computed phase/dates, never raw logs,
// flow, symptoms, mood, or notes — see docs/SPEC.md #5. Gated solely on
// the sharer's own sharing_enabled flag, not on the viewer's.
router.get('/partner', requirePair, async (req, res) => {
  const { rows } = await query('SELECT * FROM period_settings WHERE user_id = $1', [req.partnerId]);
  const partnerSettings = rows[0];

  if (!partnerSettings || !partnerSettings.sharing_enabled) {
    return res.json({ sharingEnabled: false, predictions: null });
  }

  const lastCycle = await getLastCycle(req.partnerId);
  const today = toDateString(new Date());
  const predictions = lastCycle
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

  res.json({ sharingEnabled: true, predictions });
});

export default router;
