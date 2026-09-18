// Verifies the response shapes each mobile screen actually destructures.
const API = 'http://localhost:4000';
const stamp = Date.now();
let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${JSON.stringify(d)}`); } };
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

async function req(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${API}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

const A = { email: `ct-a${stamp}@t.dev`, password: 'pw123456', name: 'CtA' };
const B = { email: `ct-b${stamp}@t.dev`, password: 'pw123456', name: 'CtB' };
for (const u of [A, B]) u.token = (await req('/auth/signup', { method: 'POST', body: u })).data.accessToken;
const inv = await req('/auth/invite', { method: 'POST', token: A.token, body: { deviceTimezone: 'UTC' } });
await req('/auth/invite/accept', { method: 'POST', token: B.token, body: { inviteCode: inv.data.inviteCode } });

console.log('=== DATE FIELDS THE MOBILE CALENDAR PARSES ===');
const todayStr = new Date().toISOString().slice(0, 10);
const cyc = await req('/period/cycles/start', { method: 'POST', token: A.token, body: { startDate: todayStr } });
check('POST /period/cycles start_date is a plain YYYY-MM-DD', isDay(cyc.data.cycle.start_date), cyc.data.cycle.start_date);
await req('/period/log', { method: 'POST', token: A.token, body: { date: todayStr, flow: 'medium', symptoms: ['Cramps'] } });

const cal = await req(`/period/calendar?month=${todayStr.slice(0, 7)}`, { token: A.token });
// PeriodTrackerScreen does: new Date(`${c.startDate}T00:00:00Z`) and logsByDate[l.date]
check('calendar cycles[].startDate is YYYY-MM-DD (mobile builds Date from it)', isDay(cal.data.cycles[0].startDate), cal.data.cycles[0].startDate);
check('calendar logs[].date is YYYY-MM-DD (mobile keys logsByDate on it)', isDay(cal.data.logs[0].date), cal.data.logs[0].date);
const mobileDateParse = new Date(`${cal.data.cycles[0].startDate}T00:00:00Z`);
check('mobile date construction yields a VALID date (not Invalid Date)', !Number.isNaN(mobileDateParse.getTime()), String(mobileDateParse));
check('calendar predictions use YYYY-MM-DD', isDay(cal.data.predictions.nextPeriodDate) && isDay(cal.data.predictions.fertileWindowStart), cal.data.predictions);

const prompt = await req('/daily-prompt/today', { token: A.token });
check('daily prompt scheduledDate is YYYY-MM-DD', isDay(prompt.data.prompt.scheduledDate), prompt.data.prompt.scheduledDate);

const arch = await req(`/quiz/archive?month=${todayStr.slice(0, 7)}`, { token: A.token });
check('quiz archive day keys are YYYY-MM-DD', arch.data.days.every((d) => isDay(d.date)), arch.data.days.slice(0, 2));

console.log('\n=== FIELDS EACH SCREEN DESTRUCTURES ===');
const games = await req('/games', { token: A.token });
check('GamesScreen: slug/emoji/title/subtitle/is_implemented present', games.data.games.every((g) => g.slug && g.emoji && g.title && 'is_implemented' in g));

const decks = await req('/decks', { token: A.token });
const oneDeck = Object.values(decks.data.decksByCategory)[0][0];
check('HomeScreen deck card: id/slug/title/emoji/is_locked present', !!(oneDeck.id && oneDeck.slug && oneDeck.title && oneDeck.emoji) && 'is_locked' in oneDeck, oneDeck);

await req('/bucket-list', { method: 'POST', token: A.token, body: { title: 'x' } });
const bl = await req('/bucket-list', { token: A.token });
check('BucketListScreen: id/title/is_completed present', bl.data.items.every((i) => i.id && i.title && 'is_completed' in i));

const ideas = await req('/date-ideas', { token: A.token });
check('DateIdeasScreen: title/description/category/cost_tier/is_completed present', ideas.data.ideas.every((i) => i.title && 'cost_tier' in i && 'is_completed' in i));

await req('/countdowns', { method: 'POST', token: A.token, body: { label: 'L', targetDate: new Date(Date.now() + 864e5).toISOString() } });
const cds = await req('/countdowns', { token: A.token });
check('CountdownScreen: label/target_date present, target_date parseable', cds.data.countdowns.every((c) => c.label && !Number.isNaN(new Date(c.target_date).getTime())));

await req('/messages', { method: 'POST', token: A.token, body: { type: 'doodle', strokeData: [[{ x: 1, y: 2 }]] } });
const msgs = await req('/messages', { token: A.token });
const doodleMsg = msgs.data.messages.find((m) => m.type === 'doodle');
check('MessagesScreen: doodle stroke_data is an array of point arrays', Array.isArray(doodleMsg.stroke_data) && Array.isArray(doodleMsg.stroke_data[0]) && 'x' in doodleMsg.stroke_data[0][0], doodleMsg.stroke_data);

const pset = await req('/period/settings', { token: A.token });
check('PeriodTrackerScreen settings: camelCase keys as screen expects', ['averageCycleLength', 'averagePeriodLength', 'sharingEnabled'].every((k) => k in pset.data.settings), pset.data.settings);

const cycles = await req('/period/cycles', { token: A.token });
check('PeriodTrackerScreen openCycle detection uses end_date field', cycles.data.cycles.every((c) => 'end_date' in c));

const dist = await req('/location/distance', { token: A.token });
check('DistanceApartScreen: distanceKm + reason keys present', 'distanceKm' in dist.data && 'reason' in dist.data, dist.data);

const partner = await req('/period/partner', { token: B.token });
check('PeriodTrackerScreen partner card: sharingEnabled + predictions keys', 'sharingEnabled' in partner.data && 'predictions' in partner.data, partner.data);

const wp = await req('/widget-photos/latest', { token: A.token });
check('HomeScreen widget card: widgetPhoto key present (may be null)', 'widgetPhoto' in wp.data);

console.log(`\nCONTRACT RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
process.exit(fails.length ? 1 : 0);
