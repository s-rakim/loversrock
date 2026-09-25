// When a seasonal deck is in season.
//
// Kept as a pure function away from the route because the interesting case is
// the one that is easy to get wrong and impossible to notice: a window that
// WRAPS the year end. New Year runs 12-26 to 01-07, and `start <= today <=
// end` is false for every day of it. The deck would simply never appear, and
// nothing would error — you would find out next January, or not at all.
//
// Dates are MM-DD strings rather than real dates because a seasonal deck
// recurs every year. Storing 2026-12-25 would mean re-seeding each January,
// and forgetting to is the same silent failure again.

/** 'MM-DD' for a Date, in the server's local reckoning of the day. */
export function monthDay(date = new Date()) {
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${m}-${d}`;
}

const VALID = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * @param deck  { season_start, season_end, season_anchor }
 * @param today a 'MM-DD' string
 * @param opts  { togetherSince } — an ISO date or null, for anniversary decks
 */
export function inSeason(deck, today = monthDay(), opts = {}) {
  // An anchored deck ignores the fixed window entirely: it is in season for
  // the whole month the two of you started in.
  if (deck?.season_anchor === 'anniversary') {
    if (!opts.togetherSince) return false;
    const month = String(new Date(opts.togetherSince).getUTCMonth() + 1).padStart(2, '0');
    return today.slice(0, 2) === month;
  }

  const { season_start: start, season_end: end } = deck || {};
  // No window at all is an evergreen deck, which is always available. This is
  // the common case and must not be mistaken for "out of season".
  if (!start || !end) return true;
  if (!VALID.test(start) || !VALID.test(end) || !VALID.test(today)) return true;

  // The wrap. 12-26 → 01-07 is two ranges, not one.
  if (start > end) return today >= start || today <= end;
  return today >= start && today <= end;
}

/**
 * How many days until a deck opens, or null if it is open or has no window.
 *
 * Used to say "back in 12 days" rather than hiding a seasonal deck entirely,
 * which is the difference between a feature people anticipate and one they
 * never learn exists.
 */
export function daysUntilSeason(deck, from = new Date(), opts = {}) {
  if (!deck?.season_start && deck?.season_anchor !== 'anniversary') return null;
  if (inSeason(deck, monthDay(from), opts)) return null;

  // Walked rather than computed, because the answer has to respect leap
  // years, month lengths and the wrap all at once, and 400 iterations of a
  // date addition is free next to getting any of those subtly wrong.
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  for (let i = 1; i <= 366; i++) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (inSeason(deck, monthDay(cursor), opts)) return i;
  }
  return null;
}
