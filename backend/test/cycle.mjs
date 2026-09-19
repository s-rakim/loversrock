// Exercises the expanded cycle tracker: the full daily log, the analysis gate,
// and above all the per-category sharing boundary from docs/SPEC.md #5.
const API = 'http://localhost:4000';
const stamp = Date.now();
let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${JSON.stringify(d)}`); } };

async function req(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${API}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const signup = async (name) => {
  const u = { email: `cyc-${name}${stamp}@t.dev`, password: 'pw123456', name };
  const r = await req('/auth/signup', { method: 'POST', body: u });
  return { ...u, token: r.data.accessToken, id: r.data.user.id };
};

const OWNER = await signup('Owner');
const PARTNER = await signup('Partner');
const invite = await req('/auth/invite', { method: 'POST', token: OWNER.token, body: { deviceTimezone: 'UTC' } });
await req('/auth/invite/accept', { method: 'POST', token: PARTNER.token, body: { inviteCode: invite.data.inviteCode, deviceTimezone: 'UTC' } });

const today = new Date().toISOString().slice(0, 10);
const day = (o) => new Date(Date.now() + o * 86400000).toISOString().slice(0, 10);

console.log('=== FULL DAILY LOG ===');
const full = await req('/period/log', { method: 'POST', token: OWNER.token, body: {
  date: today, flow: 'disaster', symptoms: ['Cramps', 'Headache'], moods: ['Anxious', 'Tired'],
  notes: 'rough one', energy: 'low',
  intercourse: { protected: false, orgasm: true, times: 2 },
  medicine: ['Ibuprofen'], breastSelfExam: true, ovulationTest: 'negative',
  pregnancyTest: 'faint', cervicalMucus: 'egg_white', weightKg: 61.4, temperatureC: 36.7, waterMl: 1500,
}});
check('every field accepted', full.status === 200, full.data);
const log = full.data.log;
check('flow "disaster" is allowed', log.flow === 'disaster', log.flow);
check('symptoms stored as an array', Array.isArray(log.symptoms) && log.symptoms.length === 2);
check('moods stored separately from legacy mood', Array.isArray(log.moods) && log.moods.length === 2);
check('intercourse stored as an object', log.intercourse && log.intercourse.times === 2, log.intercourse);
check('numeric fields kept', Number(log.weight_kg) === 61.4 && Number(log.temperature_c) === 36.7);
check('water stored', log.water_ml === 1500);
check('cervical mucus stored', log.cervical_mucus === 'egg_white');

console.log('\n=== PARTIAL SAVES DO NOT WIPE THE DAY ===');
const waterOnly = await req('/period/log', { method: 'POST', token: OWNER.token, body: { date: today, waterMl: 1800 } });
check('water updated', waterOnly.data.log.water_ml === 1800);
check('symptoms survived a water-only save', Array.isArray(waterOnly.data.log.symptoms) && waterOnly.data.log.symptoms.length === 2, waterOnly.data.log.symptoms);
check('energy survived', waterOnly.data.log.energy === 'low');
check('notes survived', waterOnly.data.log.notes === 'rough one');

console.log('\n=== VALIDATION ===');
const bad = async (body) => (await req('/period/log', { method: 'POST', token: OWNER.token, body: { date: today, ...body } })).status;
check('bad flow rejected', await bad({ flow: 'torrential' }) === 400);
check('bad energy rejected', await bad({ energy: 'sleepy' }) === 400);
check('bad pregnancy test rejected', await bad({ pregnancyTest: 'maybe' }) === 400);
check('bad mucus rejected', await bad({ cervicalMucus: 'slippery' }) === 400);
check('non-array symptoms rejected', await bad({ symptoms: 'cramps' }) === 400);
check('absurd weight rejected', await bad({ weightKg: 900 }) === 400);
check('absurd temperature rejected', await bad({ temperatureC: 12 }) === 400);
check('missing date rejected', (await req('/period/log', { method: 'POST', token: OWNER.token, body: { flow: 'light' } })).status === 400);

console.log('\n=== ANALYSIS GATE ===');
let pred = await req('/period/predictions', { token: OWNER.token });
check('starts locked', pred.data.analysisUnlocked === false, pred.data.cyclesLogged);
// Each period has to be ended before the next can start - the route refuses a
// second open cycle, which is the correct behaviour and how it works in use.
for (const offset of [-84, -56, -28]) {
  const started = await req('/period/cycles/start', { method: 'POST', token: OWNER.token, body: { startDate: day(offset) } });
  await req(`/period/cycles/${started.data.cycle.id}/end`, { method: 'POST', token: OWNER.token, body: { endDate: day(offset + 4) } });
}
check('a second open period is refused',
  (await req('/period/cycles/start', { method: 'POST', token: OWNER.token, body: { startDate: day(-10) } })).status === 201
  && (await req('/period/cycles/start', { method: 'POST', token: OWNER.token, body: { startDate: day(-9) } })).status === 409);
pred = await req('/period/predictions', { token: OWNER.token });
check('unlocks at three logged periods', pred.data.analysisUnlocked === true, pred.data.cyclesLogged);
check('cycle count reported', pred.data.cyclesLogged >= 3, pred.data.cyclesLogged);

console.log('\n=== SHARING DEFAULTS ARE CONSERVATIVE ===');
const sharing = await req('/period/sharing', { token: OWNER.token });
check('phase shared by default', sharing.data.categories.share_phase === true);
for (const key of ['share_symptoms', 'share_mood', 'share_flow', 'share_sex_drive', 'share_notes']) {
  check(`${key} defaults to false`, sharing.data.categories[key] === false, sharing.data.categories[key]);
}
check('master switch defaults off', sharing.data.sharingEnabled === false);

console.log('\n=== PARTNER SEES NOTHING UNTIL THE MASTER SWITCH IS ON ===');
let view = await req('/period/partner', { token: PARTNER.token });
check('master switch off hides everything', view.data.sharingEnabled === false && view.data.predictions === null, view.data);

await req('/period/sharing', { method: 'PATCH', token: OWNER.token, body: { sharingEnabled: true } });
view = await req('/period/partner', { token: PARTNER.token });
check('phase appears once enabled', view.data.sharingEnabled === true && view.data.predictions !== null);
check('symptoms still hidden', !view.data.today || view.data.today.symptoms === undefined, view.data.today);
check('notes still hidden', !view.data.today || view.data.today.notes === undefined);

console.log('\n=== PER-CATEGORY OPT IN ===');
await req('/period/sharing', { method: 'PATCH', token: OWNER.token, body: { share_symptoms: true } });
view = await req('/period/partner', { token: PARTNER.token });
check('symptoms appear when switched on', Array.isArray(view.data.today?.symptoms), view.data.today);
check('mood still hidden', view.data.today?.moods === undefined, view.data.today);
check('notes still hidden', view.data.today?.notes === undefined);
check('flow still hidden', view.data.today?.flow === undefined);

await req('/period/sharing', { method: 'PATCH', token: OWNER.token, body: { share_sex_drive: true } });
view = await req('/period/partner', { token: PARTNER.token });
check('sex drive exposes only that it was logged', view.data.today?.sexDriveLogged === true);
check('raw intercourse detail never leaves', JSON.stringify(view.data).includes('orgasm') === false, view.data.today);
check('protection detail never leaves', JSON.stringify(view.data).includes('protected') === false);

console.log('\n=== REVOCATION IS IMMEDIATE ===');
await req('/period/sharing', { method: 'PATCH', token: OWNER.token, body: { share_symptoms: false } });
view = await req('/period/partner', { token: PARTNER.token });
check('symptoms disappear again', view.data.today?.symptoms === undefined, view.data.today);

await req('/period/sharing', { method: 'PATCH', token: OWNER.token, body: { sharingEnabled: false } });
view = await req('/period/partner', { token: PARTNER.token });
check('master switch off overrides every category', view.data.sharingEnabled === false && view.data.today === null, view.data);

console.log('\n=== PARTNER MODE IS READ ONLY ===');
check('partner cannot write the owner log',
  (await req('/period/log', { method: 'POST', token: PARTNER.token, body: { date: today, flow: 'heavy' } })).data.log.user_id === PARTNER.id);
check('partner cannot read the owner raw log',
  (await req(`/period/log/${today}`, { token: PARTNER.token })).data.log?.notes !== 'rough one');
check('partner cannot flip the owner switches',
  (await req('/period/sharing', { method: 'PATCH', token: PARTNER.token, body: { share_notes: true } })).data.categories.user_id === PARTNER.id);
check('unknown category rejected',
  (await req('/period/sharing', { method: 'PATCH', token: OWNER.token, body: { share_everything: true } })).status === 400);
check('non-boolean category rejected',
  (await req('/period/sharing', { method: 'PATCH', token: OWNER.token, body: { share_mood: 'yes' } })).status === 400);

console.log('\n=== SEX DRIVE, MOMENT AND THE CALENDAR PAYLOAD ===');
// The UI writes these from the daily log sheet and the Add Mood grid; the
// partner cards read them back, so both halves need to hold.
await req('/period/sharing', { method: 'PATCH', token: OWNER.token, body: {
  sharingEnabled: true, share_phase: true, share_sex_drive: true, share_mood: true,
}});
const drive = await req('/period/log', { method: 'POST', token: OWNER.token, body: {
  date: today, sexDrive: 'low', moment: 'feeling_low',
}});
check('sexDrive and moment accepted', drive.status === 200, drive.data);
check('sexDrive stored', drive.data.log.sex_drive === 'low', drive.data.log.sex_drive);
check('moment stored', drive.data.log.moment === 'feeling_low', drive.data.log.moment);
check('a partial save did not blank the flow set earlier',
  drive.data.log.flow === 'disaster', drive.data.log.flow);
check('an invalid sexDrive is rejected',
  (await req('/period/log', { method: 'POST', token: OWNER.token, body: { date: today, sexDrive: 'enormous' } })).status === 400);

view = await req('/period/partner', { token: PARTNER.token });
check('partner sees the sex drive level', view.data.today.sexDrive === 'low', view.data.today);
check('partner sees the moment', view.data.today.moment === 'feeling_low', view.data.today);

await req('/period/sharing', { method: 'PATCH', token: OWNER.token, body: { share_sex_drive: false } });
view = await req('/period/partner', { token: PARTNER.token });
check('sex drive hidden again the moment it is switched off',
  view.data.today.sexDrive === undefined && view.data.today.sexDriveLogged === undefined, view.data.today);

await req('/period/sharing', { method: 'PATCH', token: OWNER.token, body: { share_mood: false } });
view = await req('/period/partner', { token: PARTNER.token });
check('moment hidden with the mood switch', view.data.today?.moment === undefined, view.data.today);

const month = today.slice(0, 7);
const cal = await req(`/period/calendar?month=${month}`, { token: OWNER.token });
const dayRow = cal.data.logs.find((l) => String(l.date).slice(0, 10) === today);
check('calendar returns the day', Boolean(dayRow), cal.data.logs);
check('calendar carries moods for the grid', Array.isArray(dayRow.moods), dayRow);
check('calendar flags intercourse without detailing it',
  dayRow.hasIntercourse === true && dayRow.intercourse === undefined, dayRow);
check('calendar flags a note without its text',
  dayRow.hasNotes === true && dayRow.notes === undefined, dayRow);

console.log(`\nCYCLE RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
process.exit(0);
