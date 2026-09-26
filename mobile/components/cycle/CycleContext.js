// One fetch of the cycle data, shared by every screen in the tracker.
//
// The tracker is five views over the same month of logs; without this each
// tab switch re-fetched the calendar and the phase card flickered back to
// "Loading…". Screens read what they need and call `saveLog` / `refresh`.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../services/api';
import { refreshWidgets } from '../../services/widgetBridge';

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

// Every date covered by a recorded period, for painting a calendar. Pure, so
// your own month and your partner's shared one go through the same code and
// cannot drift apart.
function periodDatesOf(payload) {
  const dates = new Set();
  for (const cycle of payload?.cycles || []) {
    const start = cycle.startDate || cycle.start_date;
    const end = cycle.endDate || cycle.end_date || start;
    if (!start) continue;
    for (
      let d = new Date(`${String(start).slice(0, 10)}T00:00:00Z`);
      d <= new Date(`${String(end).slice(0, 10)}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      dates.add(d.toISOString().slice(0, 10));
    }
  }
  return dates;
}

function logsByDateOf(payload) {
  return Object.fromEntries((payload?.logs || []).map((l) => [String(l.date).slice(0, 10), l]));
}

export function CycleProvider({ children }) {
  const [month, setMonth] = useState(todayDateString().slice(0, 7));
  const [calendar, setCalendar] = useState(null);
  const [cycles, setCycles] = useState([]);
  const [settings, setSettings] = useState(null);
  const [sharing, setSharing] = useState(null);
  const [partner, setPartner] = useState(null);
  // 'owner' | 'partner' | null. Null means this account has not chosen yet,
  // which the screens answer by asking rather than by picking one — see
  // CycleHomeScreen.
  const [role, setRole] = useState(null);
  // The partner's month as the partner is allowed to see it — built on the
  // server from their sharing switches, so nothing arrives here that then has
  // to be remembered to hide. Null when unpaired.
  const [partnerCalendar, setPartnerCalendar] = useState(null);
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
      // Which side of the tracker this account is on. It lives on the profile
      // rather than in period settings because it is an account-level fact:
      // the partner has no period settings of their own to keep it in.
      apiFetch('/profile'),
      apiFetch(`/period/partner/calendar?month=${month}`),
    ]);
    const [cal, cyc, set, shr, part, pred, prof, pcal] = results;

    // Unpaired is a 403 here, and that is not an error — there is simply no
    // partner month to show.
    setPartnerCalendar(pcal.status === 'fulfilled' ? pcal.value : null);

    if (prof.status === 'fulfilled') setRole(prof.value?.me?.cycleRole ?? null);

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
    // Today's symptoms show on the distance widget.
    refreshWidgets();
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

  const periodDates = useMemo(() => periodDatesOf(calendar), [calendar]);
  const logsByDate = useMemo(() => logsByDateOf(calendar), [calendar]);

  // The same four things the calendar draws from, for the partner's month.
  // Cycles are reshaped to the start_date form the calendar counts cycle days
  // from, since the shared endpoint answers in camelCase.
  const partnerView = useMemo(() => ({
    sharingEnabled: Boolean(partnerCalendar?.sharingEnabled),
    predictions: partnerCalendar?.predictions || null,
    periodDates: periodDatesOf(partnerCalendar),
    logsByDate: logsByDateOf(partnerCalendar),
    cycles: (partnerCalendar?.cycles || []).map((c) => ({
      start_date: c.startDate, end_date: c.endDate,
    })),
  }), [partnerCalendar]);

  const openCycle = useMemo(() => cycles.find((c) => !c.end_date) || null, [cycles]);

  const value = useMemo(
    () => ({
      month, setMonth, calendar, cycles, openCycle, settings, sharing, partner,
      role, setRole, partnerView,
      predictions: predictions || calendar?.predictions || null,
      analysis, loading, error, periodDates, logsByDate,
      refresh, saveLog, getLog, startPeriod, endPeriod, updateSettings, updateSharing,
    }),
    [month, calendar, cycles, openCycle, settings, sharing, partner, role, partnerView, predictions, analysis,
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
