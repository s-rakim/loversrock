const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CYCLES_FOR_AVERAGE = 6;
const MIN_CYCLES_FOR_AVERAGE = 2;

function toDate(dateString) {
  return new Date(`${dateString}T00:00:00Z`);
}

export function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(dateString, days) {
  return toDateString(new Date(toDate(dateString).getTime() + days * DAY_MS));
}

export function daysBetween(fromDateString, toDateStringVal) {
  return Math.round((toDate(toDateStringVal).getTime() - toDate(fromDateString).getTime()) / DAY_MS);
}

// Recomputes rolling averages from the user's own cycle history (most
// recent MAX_CYCLES_FOR_AVERAGE completed cycles). Falls back to the
// existing/default settings until there's enough history to trust.
export function computeCycleStats(completedCycles, fallback) {
  const recent = completedCycles
    .filter((c) => c.end_date)
    .sort((a, b) => new Date(b.start_date) - new Date(a.start_date))
    .slice(0, MAX_CYCLES_FOR_AVERAGE);

  if (recent.length < MIN_CYCLES_FOR_AVERAGE) {
    return { averageCycleLength: fallback.averageCycleLength, averagePeriodLength: fallback.averagePeriodLength };
  }

  const periodLengths = recent.map((c) => daysBetween(c.start_date, c.end_date) + 1);
  const averagePeriodLength = Math.round(periodLengths.reduce((a, b) => a + b, 0) / periodLengths.length);

  const gaps = [];
  for (let i = 0; i < recent.length - 1; i += 1) {
    gaps.push(daysBetween(recent[i + 1].start_date, recent[i].start_date));
  }
  const averageCycleLength =
    gaps.length > 0
      ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length)
      : fallback.averageCycleLength;

  return { averageCycleLength, averagePeriodLength };
}

// Computes the current cycle day/phase and forward predictions from the
// most recent cycle's start date and the user's settings. `today` is a
// YYYY-MM-DD string.
export function computePredictions({ lastCycleStart, settings, today }) {
  if (!lastCycleStart) {
    return {
      cycleDay: null,
      phase: null,
      nextPeriodDate: null,
      ovulationDate: null,
      fertileWindowStart: null,
      fertileWindowEnd: null,
    };
  }

  const { averageCycleLength, averagePeriodLength, lutealPhaseLength } = settings;

  const cycleDay = daysBetween(lastCycleStart, today) + 1;
  const ovulationDay = Math.max(1, averageCycleLength - lutealPhaseLength);

  let phase;
  if (cycleDay <= averagePeriodLength) phase = 'menstrual';
  else if (cycleDay < ovulationDay - 1) phase = 'follicular';
  else if (cycleDay <= ovulationDay + 1) phase = 'ovulation';
  else phase = 'luteal';

  const nextPeriodDate = addDays(lastCycleStart, averageCycleLength);
  const ovulationDate = addDays(lastCycleStart, ovulationDay);
  const fertileWindowStart = addDays(ovulationDate, -5);
  const fertileWindowEnd = addDays(ovulationDate, 1);

  return { cycleDay, phase, nextPeriodDate, ovulationDate, fertileWindowStart, fertileWindowEnd };
}
