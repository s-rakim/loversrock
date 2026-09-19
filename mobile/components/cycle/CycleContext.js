// One fetch of the cycle data, shared by every screen in the tracker.
//
// The tracker is five views over the same month of logs; without this each
// tab switch re-fetched the calendar and the phase card flickered back to
// "Loading…". Screens read what they need and call `saveLog` / `refresh`.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../services/api';

const CycleContext = createContext(null);

export function todayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function shiftMonth(month, delta) {
  const [year, m] = month.split('-').map(Number);
  const d = new Date(year, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function CycleProvider({ children }) {
  const [month, setMonth] = useState(todayDateString().slice(0, 7));
  const [calendar, setCalendar] = useState(null);
  const [cycles, setCycles] = useState([]);
  const [settings, setSettings] = useState(null);
  const [sharing, setSharing] = useState(null);
  const [partner, setPartner] = useState(null);
  const [predictions, setPredictions] = useState(null);
  const [analysis, setAnalysis] = useState({ cyclesLogged: 0, analysisUnlocked: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    const results = await Promise.allSettled([
      apiFetch(`/period/calendar?month=${month}`),
      apiFetch('/period/cycles'),
      apiFetch('/period/settings'),
      apiFetch('/period/sharing'),
      apiFetch('/period/partner'),
      apiFetch('/period/predictions'),
    ]);
    const [cal, cyc, set, shr, part, pred] = results;

    if (cal.status === 'fulfilled') setCalendar(cal.value);
    if (cyc.status === 'fulfilled') setCycles(cyc.value.cycles || []);
    if (set.status === 'fulfilled') setSettings(set.value.settings);
    if (shr.status === 'fulfilled') setSharing(shr.value);
    // A solo account has no partner, so /period/partner 404s — that is not an
    // error worth surfacing, it just means there is no partner view.
    setPartner(part.status === 'fulfilled' ? part.value : null);
    if (pred.status === 'fulfilled') {
      setPredictions(pred.value.predictions);
      setAnalysis({ cyclesLogged: pred.value.cyclesLogged, analysisUnlocked: pred.value.analysisUnlocked });
    }

    // Only the calendar failing means the screen genuinely has nothing.
    setError(cal.status === 'rejected' ? cal.reason?.message || 'Could not reach the server' : null);
    setLoading(false);
  }, [month]);

  useEffect(() => { refresh(); }, [refresh]);

  const saveLog = useCallback(async (patch) => {
    const { log } = await apiFetch('/period/log', { method: 'POST', body: patch });
    await refresh();
    return log;
  }, [refresh]);

  const getLog = useCallback(async (date) => {
    const { log } = await apiFetch(`/period/log/${date}`);
    return log;
  }, []);

  const startPeriod = useCallback(async (startDate) => {
    await apiFetch('/period/cycles/start', { method: 'POST', body: { startDate } });
    await refresh();
  }, [refresh]);

  const endPeriod = useCallback(async (cycleId, endDate) => {
    await apiFetch(`/period/cycles/${cycleId}/end`, { method: 'POST', body: { endDate } });
    await refresh();
  }, [refresh]);

  const updateSettings = useCallback(async (patch) => {
    const { settings: next } = await apiFetch('/period/settings', { method: 'PATCH', body: patch });
    setSettings(next);
    return next;
  }, []);

  const updateSharing = useCallback(async (patch) => {
    const next = await apiFetch('/period/sharing', { method: 'PATCH', body: patch });
    setSharing(next);
    return next;
  }, []);

  // Every date covered by a recorded period, for painting the calendar.
  const periodDates = useMemo(() => {
    const dates = new Set();
    for (const cycle of calendar?.cycles || []) {
      const start = cycle.startDate || cycle.start_date;
      const end = cycle.endDate || cycle.end_date || start;
      if (!start) continue;
      for (
        let d = new Date(`${start}T00:00:00Z`);
        d <= new Date(`${end}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 1)
      ) {
        dates.add(d.toISOString().slice(0, 10));
      }
    }
    return dates;
  }, [calendar]);

  const logsByDate = useMemo(
    () => Object.fromEntries((calendar?.logs || []).map((l) => [String(l.date).slice(0, 10), l])),
    [calendar]
  );

  const openCycle = useMemo(() => cycles.find((c) => !c.end_date) || null, [cycles]);

  const value = useMemo(
    () => ({
      month, setMonth, calendar, cycles, openCycle, settings, sharing, partner,
      predictions: predictions || calendar?.predictions || null,
      analysis, loading, error, periodDates, logsByDate,
      refresh, saveLog, getLog, startPeriod, endPeriod, updateSettings, updateSharing,
    }),
    [month, calendar, cycles, openCycle, settings, sharing, partner, predictions, analysis,
     loading, error, periodDates, logsByDate, refresh, saveLog, getLog, startPeriod, endPeriod,
     updateSettings, updateSharing]
  );

  return <CycleContext.Provider value={value}>{children}</CycleContext.Provider>;
}

export function useCycle() {
  const ctx = useContext(CycleContext);
  if (!ctx) throw new Error('useCycle must be used inside a CycleProvider');
  return ctx;
}
