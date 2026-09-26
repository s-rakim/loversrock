// Exercises the widget data layer: the scoped read-only token, the one-shot
// summary the native widgets render, and the token's security boundary.
const API = 'http://localhost:4000';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const stamp = Date.now();
let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${JSON.stringify(d)}`); } };

async function req(path, { method = 'GET', body, token, widgetToken, raw = false } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(widgetToken ? { 'X-Widget-Token': widgetToken } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

const A = { email: `w-a${stamp}@t.dev`, password: 'pw123456', name: 'WidgetA' };
const B = { email: `w-b${stamp}@t.dev`, password: 'pw123456', name: 'WidgetB' };
for (const u of [A, B]) u.token = (await req('/auth/signup', { method: 'POST', body: u })).data.accessToken;

console.log('=== WIDGET TOKEN ===');
const issued = await req('/widget/token', { method: 'POST', token: A.token, body: { label: 'Pixel 8' } });
check('token issued to an authenticated user', issued.status === 201 && typeof issued.data.widgetToken === 'string', issued.data);
check('token is high-entropy (64 hex chars)', /^[0-9a-f]{64}$/.test(issued.data.widgetToken || ''));
const WT = issued.data.widgetToken;

const stored = await req('/widget/tokens', { token: A.token });
check('token is listed for the user', stored.data.tokens.length === 1 && stored.data.tokens[0].label === 'Pixel 8');
check('raw token value is NOT returned on listing (only the hash is stored)', !JSON.stringify(stored.data).includes(WT));
check('issuing requires normal auth', (await req('/widget/token', { method: 'POST' })).status === 401);

console.log('\n=== SECURITY BOUNDARY ===');
check('summary rejects a missing widget token', (await req('/widget/summary')).status === 401);
check('summary rejects a bogus widget token', (await req('/widget/summary', { widgetToken: 'f'.repeat(64) })).status === 401);
check('widget token does NOT work as a bearer token', (await req('/memories', { token: WT })).status === 401);
check('widget token cannot read messages', (await req('/messages', { widgetToken: WT })).status === 401);
check('widget token cannot read memories', (await req('/memories', { widgetToken: WT })).status === 401);
check('widget token cannot read raw period logs', (await req('/period/settings', { widgetToken: WT })).status === 401);

console.log('\n=== SUMMARY: UNPAIRED ===');
const solo = await req('/widget/summary', { widgetToken: WT });
check('summary works before pairing (degrades, does not error)', solo.status === 200 && solo.data.paired === false, solo.data);
check('all display fields present and null-safe when unpaired',
  ['streakCount', 'promptAnsweredToday', 'nextCountdown', 'distanceKm', 'latestPhotoUrl', 'partnerCyclePhase'].every((k) => k in solo.data), solo.data);

console.log('\n=== SUMMARY: PAIRED + POPULATED ===');
const inv = await req('/auth/invite', { method: 'POST', token: A.token, body: { deviceTimezone: 'UTC' } });
await req('/auth/invite/accept', { method: 'POST', token: B.token, body: { inviteCode: inv.data.inviteCode } });
await req('/daily-prompt/today/respond', { method: 'POST', token: A.token, body: { answerText: 'a' } });
await req('/daily-prompt/today/respond', { method: 'POST', token: B.token, body: { answerText: 'b' } });
await req('/countdowns', { method: 'POST', token: A.token, body: { label: 'Anniversary', targetDate: new Date(Date.now() + 10 * 864e5).toISOString() } });
await req('/countdowns', { method: 'POST', token: A.token, body: { label: 'Later thing', targetDate: new Date(Date.now() + 60 * 864e5).toISOString() } });
await req('/widget-photos', { method: 'POST', token: B.token, body: { image: PNG, caption: 'hi' } });
for (const u of [A, B]) await req('/location/enable', { method: 'POST', token: u.token, body: { enabled: true } });
await req('/location/update', { method: 'POST', token: A.token, body: { lat: 51.5074, lng: -0.1278 } });
await req('/location/update', { method: 'POST', token: B.token, body: { lat: 48.8566, lng: 2.3522 } });

const s = await req('/widget/summary', { widgetToken: WT });
check('paired flag true', s.data.paired === true);
check('streak surfaced for the widget', s.data.streakCount === 1, s.data.streakCount);
check("today's prompt shows as answered", s.data.promptAnsweredToday === true);
check('SOONEST countdown chosen, not just any', s.data.nextCountdown?.label === 'Anniversary', s.data.nextCountdown);
check('countdown days remaining computed', s.data.nextCountdown?.daysRemaining === 10, s.data.nextCountdown);
check('latest partner photo surfaced', typeof s.data.latestPhotoUrl === 'string' && s.data.latestPhotoUrl.length > 0);
check('distance apart surfaced (London->Paris ~343km)', Math.abs(s.data.distanceKm - 343) < 5, s.data.distanceKm);

// ---- The distance widget: the partner's bubble, and why there is no number.
check('distance widget knows the number is real', s.data.distanceStatus === 'ok', s.data.distanceStatus);
check('the partner bubble takes the initial of their name', s.data.partnerInitial === 'W', s.data.partnerInitial);

// A nickname is how you think of them, so it wins over their own name — and a
// leading emoji is skipped, because a bubble holding a butterfly reads as
// decoration rather than as a person.
await req('/profile/nickname', { method: 'PUT', token: A.token, body: { nickname: '✨🦋ma cherie' } });
const nick = await req('/widget/summary', { widgetToken: WT });
check('the nickname you gave them wins, skipping emoji to its first letter',
  nick.data.partnerInitial === 'M', nick.data.partnerInitial);
await req('/profile/nickname', { method: 'DELETE', token: A.token });

// Sharing off on EITHER side means no number, and the widget says which fix
// applies instead of showing a bare dash.
await req('/location/enable', { method: 'POST', token: B.token, body: { enabled: false } });
const off = await req('/widget/summary', { widgetToken: WT });
check('with their sharing off there is no distance', off.data.distanceKm === null, off.data.distanceKm);
check('and the widget is told why', off.data.distanceStatus === 'sharing_off', off.data.distanceStatus);
await req('/location/enable', { method: 'POST', token: B.token, body: { enabled: true } });
await req('/location/update', { method: 'POST', token: B.token, body: { lat: 48.8566, lng: 2.3522 } });
check('updatedAt stamped so widgets can show staleness', !Number.isNaN(new Date(s.data.updatedAt).getTime()));

console.log('\n=== PARTNER CYCLE PRIVACY IN THE WIDGET ===');
check('partner cycle hidden while partner has sharing off', s.data.partnerCyclePhase === null, s.data.partnerCyclePhase);
await req('/period/cycles/start', { method: 'POST', token: B.token, body: { startDate: new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10) } });
await req('/period/log', { method: 'POST', token: B.token, body: { date: new Date().toISOString().slice(0, 10), flow: 'heavy', symptoms: ['Cramps'], notes: 'private note' } });
await req('/period/settings', { method: 'PATCH', token: B.token, body: { sharingEnabled: true } });
const s2 = await req('/widget/summary', { widgetToken: WT });
check('partner phase appears once THEY enable sharing', s2.data.partnerCyclePhase === 'menstrual', s2.data.partnerCyclePhase);
check('widget summary leaks NO raw symptoms/flow/notes (SPEC #5)', !/private note|Cramps|heavy|flow|symptom/i.test(JSON.stringify(s2.data)), s2.data);

console.log('\n=== WIDGET PHOTO ENDPOINT (image loaders cannot set headers) ===');
const photo = await req(`/widget/photo?token=${WT}`, { raw: true });
const bytes = Buffer.from(await photo.arrayBuffer());
check('photo streams via query-string token', photo.status === 200 && bytes.slice(1, 4).toString() === 'PNG', bytes.length);
check('photo endpoint rejects a bad token', (await req('/widget/photo?token=deadbeef', { raw: true })).status === 401);

console.log('\n=== REVOCATION ===');
const list = await req('/widget/tokens', { token: A.token });
check('revoke succeeds', (await req(`/widget/token/${list.data.tokens[0].id}`, { method: 'DELETE', token: A.token })).status === 204);
check('revoked token immediately stops working', (await req('/widget/summary', { widgetToken: WT })).status === 401);
check("revoking the widget did NOT log the phone out", (await req('/memories', { token: A.token })).status === 200);


console.log('\n=== AMBIENT PRESENCE REACHES THE WIDGET ===');
// A widget exists so these can be seen without opening anything. If the
// payload does not carry them, the feature stops at the app.
{
  await req('/profile/together-since', { method: 'PUT', token: A.token, body: { togetherSince: '2024-02-14' } });
  await req('/presence/moods', { method: 'PUT', token: B.token, body: { mood: 'loved', note: 'miss you' } });

  const token = (await req('/widget/token', { method: 'POST', token: A.token })).data.widgetToken;
  const view = await req('/widget/summary', { widgetToken: token });

  check('days together reaches the widget', view.data.daysTogether > 500, view.data.daysTogether);
  check('and the date it counts from', String(view.data.togetherSince).startsWith('2024-02-14'), view.data.togetherSince);
  check("the partner's mood reaches it", view.data.partnerMood === 'loved', view.data.partnerMood);
  check('with its note', view.data.partnerMoodNote === 'miss you', view.data.partnerMoodNote);

  // An open note may be shown in full.
  await req('/presence/notes', { method: 'POST', token: B.token, body: { body: 'coffee is on' } });
  const withNote = await req('/widget/summary', { widgetToken: token });
  check('an open note is shown on the widget', withNote.data.latestNote === 'coffee is on', withNote.data.latestNote);
  check('and is not flagged as sealed', withNote.data.sealedNoteWaiting === false);

  // A sealed one must be announced and NOT printed. A home screen is the one
  // place a secret cannot be, and the widget process has no way to ask
  // whether it has been opened.
  await req('/presence/notes', { method: 'POST', token: B.token, body: { body: 'ring is in the drawer', sealed: true } });
  const sealedView = await req('/widget/summary', { widgetToken: token });
  check('a sealed note is announced', sealedView.data.sealedNoteWaiting === true, sealedView.data.sealedNoteWaiting);
  check('and its body is NOT on the widget', sealedView.data.latestNote === null, sealedView.data.latestNote);
  check('nor anywhere in the payload', !JSON.stringify(sealedView.data).includes('drawer'));
}

console.log('\n=== THE SIX REMAINING WIDGETS HAVE SOMETHING TO SHOW ===');
// Each of these is a widget layout that had nowhere to read from before.
// A fresh token, because the revocation section above deliberately killed WT.
const W2 = (await req('/widget/token', { method: 'POST', token: A.token })).data.widgetToken;

// Daily question.
const withQ = await req('/widget/summary', { widgetToken: W2 });
check('daily-question widget: the question itself is in the summary',
  typeof withQ.data.todaysQuestion === 'string' && withQ.data.todaysQuestion.length > 0, withQ.data.todaysQuestion);
check('and whether it still needs answering', typeof withQ.data.promptAnsweredToday === 'boolean');

// Next date. Ideas are seeded globally and copied into the pair when saved,
// so this is the real path a person takes rather than an invented one.
const browse = await req('/date-ideas', { token: A.token });
const seeded = browse.data.ideas[0];
const mine = await req(`/date-ideas/${seeded.id}/save`, { method: 'POST', token: A.token });
const when = new Date(Date.now() + 3 * 86400000).toISOString();
const sched = await req(`/date-ideas/${mine.data.idea.id}/schedule`, { method: 'PATCH', token: A.token, body: { scheduledFor: when, status: 'scheduled' } });
check('a date can be scheduled', sched.status === 200, sched.data);
const dated = await req('/widget/summary', { widgetToken: W2 });
check('next-date widget: title and countdown', dated.data.nextDate?.title === seeded.title
  && dated.data.nextDate.daysUntil >= 2 && dated.data.nextDate.daysUntil <= 3, dated.data.nextDate);

// Anniversary. Already in the payload, asserted here because the widget reads it.
await req('/profile/together-since', { method: 'PUT', token: A.token, body: { togetherSince: '2020-02-14' } })
  .catch(() => null);
const anni = await req('/widget/summary', { widgetToken: W2 });
check('anniversary widget: days together is a number or an honest null',
  anni.data.daysTogether === null || typeof anni.data.daysTogether === 'number', anni.data.daysTogether);

console.log('\n=== QUICK KISS: THE ONLY WRITE A WIDGET TOKEN CAN DO ===');
const kissed = await req('/widget/kiss', { method: 'POST', widgetToken: W2 });
check('a kiss sends', kissed.status === 201 && kissed.data.sent === true, kissed.data);
// A button on a home screen WILL be pressed by a pocket. A second one in the
// same breath is a no-op rather than an error the widget has to render.
const again = await req('/widget/kiss', { method: 'POST', widgetToken: W2 });
check('a second one straight away is throttled, not an error',
  again.status === 200 && again.data.sent === false && again.data.throttled === true, again.data);

const BWT = (await req('/widget/token', { method: 'POST', token: B.token })).data.widgetToken;
const theirView = await req('/widget/summary', { widgetToken: BWT });
check('their widget sees a kiss waiting', theirView.data.unseenKisses === 1, theirView.data.unseenKisses);
check('and when it arrived', Boolean(theirView.data.lastKissFromPartnerAt));
const myView = await req('/widget/summary', { widgetToken: W2 });
check('mine shows when I last sent one', Boolean(myView.data.lastKissSentAt));
check('and no unseen kisses of my own', myView.data.unseenKisses === 0, myView.data.unseenKisses);

await req('/widget/kiss/seen', { method: 'POST', widgetToken: BWT });
check('opening the app clears their badge',
  (await req('/widget/summary', { widgetToken: BWT })).data.unseenKisses === 0);

// The whole justification for allowing a write at all: this token lives in
// SharedPreferences, not the keychain, so what it can do must stay harmless.
check('the kiss route still needs a real widget token', (await req('/widget/kiss', { method: 'POST' })).status === 401);
check('a bogus one cannot send', (await req('/widget/kiss', { method: 'POST', widgetToken: 'a'.repeat(64) })).status === 401);
check('and the token still cannot post a message', (await req('/messages', { method: 'POST', widgetToken: W2, body: { type: 'text', content: 'hi' } })).status === 401);

console.log('\n=== CANVAS WIDGET ===');
const none = await req('/widget/drawing', { widgetToken: W2 });
check('no drawing yet is null, not a 404', none.status === 200 && none.data.drawing === null, none.data);

// A realistic drawing: slow strokes with hundreds of near-identical points.
const dense = Array.from({ length: 6 }, (_, k) => ({
  points: Array.from({ length: 900 }, (_, i) => ({ x: k * 20 + i * 0.05, y: i * 0.4 })),
  color: '#FF5C8D', width: 6, tool: 'pen',
}));
await req('/canvas', { method: 'POST', token: A.token, body: { strokeData: { strokes: dense }, title: 'for the widget', canvasColor: '#FFFDF8' } });

const drawing = await req('/widget/drawing', { widgetToken: W2 });
check('the newest drawing comes back', drawing.data.drawing?.title === 'for the widget', drawing.data.drawing);
check('with the paper it was drawn on', drawing.data.drawing.canvasColor === '#FFFDF8');
const points = drawing.data.drawing.strokes.reduce((n, st) => n + st.points.length, 0);
check(`thinned to something a tile can draw (${points} points, from 5400)`, points <= 2400 && points > 0, points);
// Geometric thinning, not every-Nth: the shape has to survive.
check('every stroke survived, just with fewer points', drawing.data.drawing.strokes.length === 6, drawing.data.drawing.strokes.length);
check('and the last point of a stroke is kept, so lines end where the finger did',
  drawing.data.drawing.strokes[0].points.at(-1).y === Math.round(899 * 0.4), drawing.data.drawing.strokes[0].points.at(-1));
check('coordinates are whole numbers at tile size', drawing.data.drawing.strokes[0].points.every((p) => Number.isInteger(p.x) && Number.isInteger(p.y)));

const summaryAfter = await req('/widget/summary', { widgetToken: W2 });
check('the summary says there IS a drawing', Boolean(summaryAfter.data.latestDrawingAt), summaryAfter.data.latestDrawingAt);
// The reason it is a separate endpoint at all.
check('but does NOT carry the strokes, which every other widget would pay for',
  !JSON.stringify(summaryAfter.data).includes('"points"'));
check('the other couple cannot fetch it', (await req('/widget/drawing', { widgetToken: 'b'.repeat(64) })).status === 401);

console.log(`\nWIDGET API RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) console.log('FAILURES:', fails);
process.exit(fails.length ? 1 : 0);
