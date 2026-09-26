// The partner's calendar, and what it is allowed to contain.
//
// The partner's Calendar tab used to read GET /period/calendar — the CALLER's
// own cycle — so it showed an empty month with buttons offering to log into
// it. GET /period/partner/calendar builds the owner's month from what the
// owner chose to share, field by field, server-side.
//
// The checks that matter most here are the negative ones: notes text and the
// intercourse record must never appear, whatever is switched on, and nothing
// at all may appear while sharing is off.
const API = 'http://localhost:4000';

let pass = 0;
const failures = [];
const section = (n) => console.log(`\n=== ${n} ===`);
function check(name, cond, detail) {
  if (cond) { pass += 1; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ''}`); }
}
async function req(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* 204 */ }
  return { status: res.status, data };
}

const stamp = Date.now();
async function account(who, cycleRole) {
  const r = await req('/auth/signup', {
    method: 'POST',
    body: { name: who, email: `pcal-${who}-${stamp}@example.com`, password: 'password123', cycleRole },
  });
  return r.data.accessToken;
}

const owner = await account('owner', 'owner');
const partner = await account('partner', 'partner');
const month = new Date().toISOString().slice(0, 7);
const day = `${month}-02`;

section('UNPAIRED');
const lonely = await req(`/period/partner/calendar?month=${month}`, { token: partner });
check('an unpaired account gets no partner calendar', lonely.status === 403, lonely);

const invite = await req('/auth/invite', { method: 'POST', token: owner, body: { deviceTimezone: 'UTC' } });
const accept = await req('/auth/invite/accept', {
  method: 'POST', token: partner, body: { inviteCode: invite.data.inviteCode },
});
check('the two pair up', accept.status === 200 || accept.status === 201, accept.data);

// The owner's record, including the things that must never cross over.
await req('/period/cycles/start', { method: 'POST', token: owner, body: { startDate: day } });
await req('/period/log', {
  method: 'POST',
  token: owner,
  body: {
    date: day, flow: 'heavy', symptoms: ['Cramps'], mood: 'Irritable',
    notes: 'PRIVATE-NOTE-TEXT', sexDrive: 'high',
    intercourse: { protected: true, orgasm: true, count: 2 },
  },
});

section('SHARING OFF');
const off = await req(`/period/partner/calendar?month=${month}`, { token: partner });
check('it answers', off.status === 200, off);
check('and says sharing is off', off.data?.sharingEnabled === false, off.data);
check('with no cycles, no days and no predictions',
  off.data?.cycles?.length === 0 && off.data?.logs?.length === 0 && off.data?.predictions === null, off.data);

section('SHARING ON, DEFAULTS — PHASE ONLY');
await req('/period/settings', { method: 'PATCH', token: owner, body: { sharingEnabled: true } });
const phase = await req(`/period/partner/calendar?month=${month}`, { token: partner });
check('the cycle is visible', phase.data?.cycles?.length === 1, phase.data?.cycles);
check('and so are the predictions', Boolean(phase.data?.predictions), phase.data?.predictions);
check('but no daily detail at all', phase.data?.logs?.length === 0, phase.data?.logs);

section('EVERYTHING SWITCHED ON');
await req('/period/sharing', {
  method: 'PATCH',
  token: owner,
  body: {
    share_phase: true, share_flow: true, share_symptoms: true,
    share_mood: true, share_sex_drive: true, share_notes: true,
  },
});
const all = await req(`/period/partner/calendar?month=${month}`, { token: partner });
const shown = all.data?.logs?.[0] || {};
check('the day is there', all.data?.logs?.length === 1, all.data?.logs);
check('with flow, symptoms and mood',
  shown.flow === 'heavy' && shown.symptoms?.includes('Cramps') && shown.mood === 'Irritable', shown);
check('and the sex-drive level', shown.sexDrive === 'high', shown);

// Even with everything on, these do not cross.
const raw = JSON.stringify(all.data);
check('notes are only ever "there is a note" — the text never leaves the server',
  shown.hasNotes === true && !raw.includes('PRIVATE-NOTE-TEXT'), shown);
check('and activity is a yes/no, never the record itself',
  shown.hasIntercourse === true && !('intercourse' in shown) && !raw.includes('orgasm'), shown);

section('SWITCHED BACK OFF, ONE AT A TIME');
await req('/period/sharing', {
  method: 'PATCH', token: owner,
  body: { share_flow: false, share_symptoms: false, share_mood: false, share_sex_drive: false, share_notes: false },
});
const narrow = await req(`/period/partner/calendar?month=${month}`, { token: partner });
check('turning the categories off removes the daily detail', narrow.data?.logs?.length === 0, narrow.data?.logs);

await req('/period/sharing', { method: 'PATCH', token: owner, body: { share_flow: true } });
const flowOnly = await req(`/period/partner/calendar?month=${month}`, { token: partner });
const f = flowOnly.data?.logs?.[0] || {};
check('one category on shows that category', f.flow === 'heavy', f);
check('and nothing else', !('symptoms' in f) && !('mood' in f) && !('moods' in f) && !('sexDrive' in f) && !('hasNotes' in f), f);

await req('/period/sharing', { method: 'PATCH', token: owner, body: { share_phase: false } });
const noPhase = await req(`/period/partner/calendar?month=${month}`, { token: partner });
check('phase off hides the cycle and the predictions',
  noPhase.data?.cycles?.length === 0 && noPhase.data?.predictions === null, noPhase.data);

section('AND IT IS NOT A WAY INTO THE PARTNER\'S OWN RECORD');
// The owner asking for the partner calendar gets the PARTNER's record, which
// is empty and unshared — not their own reflected back.
const reverse = await req(`/period/partner/calendar?month=${month}`, { token: owner });
check('it is keyed to the other person, not the caller',
  reverse.status === 200 && reverse.data?.sharingEnabled === false, reverse.data);

const bad = await req('/period/partner/calendar?month=2026-9', { token: partner });
check('a malformed month is refused', bad.status === 400, bad.data);

console.log(`\nPARTNER CALENDAR RESULT — PASSED: ${pass}  FAILED: ${failures.length}`);
if (failures.length) { console.log(failures.map((x) => `  - ${x}`).join('\n')); process.exit(1); }
