// Seasonal decks.
//
// Almost all of the risk here is in one function and one case: a window that
// WRAPS the year end. New Year runs 12-26 to 01-07, and the obvious
// `start <= today <= end` is false for every single day of it. The deck would
// never appear, nothing would error, and you would find out next January — or
// not at all. So the pure function gets hammered first, then the route.
import { inSeason, daysUntilSeason, monthDay } from '../src/models/seasons.js';

const API = 'http://localhost:4000';
const stamp = Date.now();
let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${JSON.stringify(d)?.slice(0, 250)}`); } };

const req = async (p, o = {}) => {
  const res = await fetch(`${API}${p}`, {
    method: o.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}) },
    body: o.body ? JSON.stringify(o.body) : undefined,
  });
  return { status: res.status, data: res.status === 204 ? null : await res.json().catch(() => null) };
};

console.log('=== THE WRAP ===');
const ny = { season_start: '12-26', season_end: '01-07' };
for (const day of ['12-26', '12-31', '01-01', '01-07']) {
  check(`New Year is open on ${day}`, inSeason(ny, day) === true);
}
for (const day of ['12-25', '01-08', '06-15', '03-01']) {
  check(`and shut on ${day}`, inSeason(ny, day) === false);
}

console.log('\n=== THE ORDINARY CASE ===');
const val = { season_start: '02-01', season_end: '02-20' };
check('open on the first day', inSeason(val, '02-01') === true);
check('open on the last day', inSeason(val, '02-20') === true);
check('shut the day before', inSeason(val, '01-31') === false);
check('shut the day after', inSeason(val, '02-21') === false);
// A leap day inside a window is still inside it.
check('a leap day inside a window counts', inSeason({ season_start: '02-20', season_end: '03-05' }, '02-29') === true);

console.log('\n=== NO WINDOW MEANS ALWAYS, NOT NEVER ===');
// The failure that would take out every ordinary deck in the app.
check('a deck with no season is always open', inSeason({}) === true);
check('and so is one with only a start', inSeason({ season_start: '02-01' }) === true);
check('malformed dates fail OPEN rather than hiding a deck forever',
  inSeason({ season_start: 'February', season_end: 'March' }, '06-01') === true);

console.log('\n=== ANNIVERSARY IS A DIFFERENT MONTH PER COUPLE ===');
const anni = { season_anchor: 'anniversary' };
check('open during their month', inSeason(anni, '02-09', { togetherSince: '2020-02-14' }) === true);
check('on any day of that month', inSeason(anni, '02-28', { togetherSince: '2020-02-01' }) === true);
check('shut in other months', inSeason(anni, '03-01', { togetherSince: '2020-02-14' }) === false);
// No date set must not mean "open all year"; there is no anniversary to anchor to.
check('shut entirely when no date is set', inSeason(anni, '02-09', {}) === false);

console.log('\n=== HOW LONG UNTIL IT OPENS ===');
check('12 days to Valentine from Jan 20', daysUntilSeason(val, new Date(Date.UTC(2026, 0, 20))) === 12);
check('6 days to New Year from Dec 20', daysUntilSeason(ny, new Date(Date.UTC(2026, 11, 20))) === 6);
check('null while it is already open', daysUntilSeason(val, new Date(Date.UTC(2026, 1, 10))) === null);
check('null for an evergreen deck', daysUntilSeason({}, new Date()) === null);
// The walk has to cross a year boundary and a leap year without special-casing.
check('crosses the year end', daysUntilSeason(val, new Date(Date.UTC(2026, 11, 31))) === 32,
  daysUntilSeason(val, new Date(Date.UTC(2026, 11, 31))));
check('counts the leap day when there is one',
  daysUntilSeason({ season_start: '03-01', season_end: '03-10' }, new Date(Date.UTC(2028, 1, 27))) === 3,
  daysUntilSeason({ season_start: '03-01', season_end: '03-10' }, new Date(Date.UTC(2028, 1, 27))));

console.log('\n=== THE ROUTE ===');
const signup = async (n) => {
  const u = { email: `season-${n}${stamp}@t.dev`, password: 'pw123456', name: n };
  const r = await req('/auth/signup', { method: 'POST', body: u });
  return { ...u, token: r.data.accessToken, id: r.data.user.id };
};
const A = await signup('Ana');
const B = await signup('Ben');
const invite = await req('/auth/invite', { method: 'POST', token: A.token, body: { deviceTimezone: 'UTC' } });
await req('/auth/invite/accept', { method: 'POST', token: B.token, body: { inviteCode: invite.data.inviteCode, deviceTimezone: 'UTC' } });

const decks = await req('/decks', { token: A.token });
const all = Object.values(decks.data.decksByCategory).flat();
check('ordinary decks are all listed', all.length > 20, all.length);
check('and none of them is marked seasonal', all.filter((d) => d.seasonal).every((d) => d.inSeason), all.filter((d) => d.seasonal && !d.inSeason));

const today = monthDay();
const shown = all.filter((d) => d.category === 'Seasonal').map((d) => d.slug);
const seeded = [
  ['seasonal-valentines', '02-01', '02-20'],
  ['seasonal-christmas', '12-01', '12-27'],
  ['seasonal-new-year', '12-26', '01-07'],
  ['seasonal-summer', '05-15', '08-31'],
  ['seasonal-autumn', '09-15', '11-15'],
  ['seasonal-halloween', '10-15', '11-02'],
];
// Whatever today happens to be, the list must agree with the function — which
// is the only assertion that stays true whenever this suite is run.
for (const [slug, start, end] of seeded) {
  const should = inSeason({ season_start: start, season_end: end }, today);
  check(`${slug} is ${should ? 'shown' : 'hidden'} on ${today}`, shown.includes(slug) === should, shown);
}
check('the anniversary deck is hidden while no date is set', !shown.includes('seasonal-anniversary'), shown);

await req('/profile/together-since', { method: 'PUT', token: A.token, body: { togetherSince: `2020-${today.slice(0, 2)}-05` } });
const withDate = await req('/decks', { token: B.token });
const nowShown = Object.values(withDate.data.decksByCategory).flat().map((d) => d.slug);
check('and appears for BOTH of you once it is', nowShown.includes('seasonal-anniversary'), nowShown.filter((s) => s.startsWith('seasonal')));

console.log('\n=== OUT OF SEASON IS NOT LOCKED ===');
// There is no paywall in this app, and a seasonal deck is not a soft one. An
// old link or a stale list still opens; it just says it is out of season.
const shut = seeded.find(([slug, start, end]) => !inSeason({ season_start: start, season_end: end }, today));
const opened = await req(`/decks/${shut[0]}/questions`, { token: A.token });
check('an out-of-season deck still opens', opened.status === 200, opened.data?.error);
check('and says so', opened.data.deck.inSeason === false && opened.data.deck.seasonal === true, opened.data.deck);
check('with its questions intact', opened.data.questions.length > 0, opened.data.questions?.length);

const upcoming = decks.data.seasonalSoon || [];
check('anything opening within 30 days is announced with a countdown',
  upcoming.every((d) => d.daysUntilSeason > 0 && d.daysUntilSeason <= 30), upcoming.map((d) => [d.slug, d.daysUntilSeason]));
check('and nothing already open is in that list',
  !upcoming.some((d) => shown.includes(d.slug)), upcoming.map((d) => d.slug));

console.log(`\nSEASONS RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
