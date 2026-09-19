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

console.log(`\nWIDGET API RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) console.log('FAILURES:', fails);
process.exit(fails.length ? 1 : 0);
