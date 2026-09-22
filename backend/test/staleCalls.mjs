// A call that never ended cleanly must not block every call after it.
//
// call_sessions carries a partial unique index — at most one row per pair
// with status 'ringing' or 'connected' — and liveCall() had no time bound at
// all. So a row left at 'ringing' stayed "live" forever, and every later
// POST /calls/start answered 409 "A call is already in progress" for a call
// that ended days ago and nobody was on.
//
// Leaving one behind is easy, and the person hitting this had been doing it
// repeatedly: the caller sat on "Calling…" because the socket was dead, then
// killed the app. No POST /:id/end, row stuck at 'ringing', calling broken
// from then on — including after the socket itself was fixed.
//
// Losing the network between hanging up and the request landing does it too.
import { query } from '../src/config/db.js';

const API = 'http://localhost:4000';
const stamp = Date.now();
let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${JSON.stringify(d)}`); } };

const req = async (p, o = {}) => {
  const res = await fetch(`${API}${p}`, {
    method: o.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}) },
    body: o.body ? JSON.stringify(o.body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const signup = async (n) => {
  const u = { email: `stale-${n}${stamp}@t.dev`, password: 'pw123456', name: n };
  const r = await req('/auth/signup', { method: 'POST', body: u });
  return { ...u, token: r.data.accessToken, id: r.data.user.id };
};

const A = await signup('Ana');
const B = await signup('Ben');
const invite = await req('/auth/invite', { method: 'POST', token: A.token, body: { deviceTimezone: 'UTC' } });
await req('/auth/invite/accept', { method: 'POST', token: B.token, body: { inviteCode: invite.data.inviteCode, deviceTimezone: 'UTC' } });
const { rows: pairRows } = await query(
  `SELECT id FROM pairs WHERE user_a_id = $1 AND unlinked_at IS NULL ORDER BY created_at DESC LIMIT 1`, [A.id]);
const pairId = pairRows[0].id;

console.log('=== A CALL THAT WAS KILLED MID-RING ===');
// Exactly what the app leaves behind when it is force-closed on "Calling…":
// a ringing row, started a while ago, with no ended_at.
await query(
  `INSERT INTO call_sessions (pair_id, caller_id, callee_id, kind, status, started_at)
   VALUES ($1, $2, $3, 'voice', 'ringing', now() - interval '20 minutes')`,
  [pairId, A.id, B.id]
);
const stuck = await query(
  `SELECT status FROM call_sessions WHERE pair_id = $1 AND status = 'ringing'`, [pairId]);
check('the stuck row exists to begin with', stuck.rows.length === 1, stuck.rows);

const afterStuck = await req('/calls/start', { method: 'POST', token: A.token, body: { kind: 'voice' } });
check('a new call is NOT refused because of it', afterStuck.status !== 409,
  { status: afterStuck.status, error: afterStuck.data?.error });
check('it actually starts', afterStuck.status === 201 && Boolean(afterStuck.data?.call?.id), afterStuck.data);

const swept = await query(
  `SELECT status, end_reason FROM call_sessions
    WHERE pair_id = $1 AND started_at < now() - interval '10 minutes'`, [pairId]);
check('and the ghost is retired as missed', swept.rows[0]?.status === 'missed', swept.rows);
check('with a reason that says why', swept.rows[0]?.end_reason === 'expired', swept.rows[0]);

console.log('\n=== A CALL THAT IS GENUINELY RINGING RIGHT NOW STILL WINS ===');
// The sweep must not eat a live call. The one just started is seconds old.
const concurrent = await req('/calls/start', { method: 'POST', token: B.token, body: { kind: 'voice' } });
check('the partner tapping Call gets the existing one, not a rival', concurrent.status === 409, concurrent.status);
check('and is handed the call that is live', concurrent.data?.call?.id === afterStuck.data.call.id, concurrent.data?.call);
check('from their side they are the callee', concurrent.data?.call?.role === 'callee', concurrent.data?.call?.role);

console.log('\n=== AN ABANDONED CONNECTED CALL EVENTUALLY LETS GO TOO ===');
await req(`/calls/${afterStuck.data.call.id}/end`, { method: 'POST', token: A.token, body: { reason: 'hangup' } });
await query(
  `INSERT INTO call_sessions (pair_id, caller_id, callee_id, kind, status, started_at, answered_at)
   VALUES ($1, $2, $3, 'video', 'connected', now() - interval '20 hours', now() - interval '20 hours')`,
  [pairId, A.id, B.id]
);
const afterZombie = await req('/calls/start', { method: 'POST', token: A.token, body: { kind: 'voice' } });
check('a day-old "connected" call does not block calling either',
  afterZombie.status === 201, { status: afterZombie.status, error: afterZombie.data?.error });
const zombie = await query(
  `SELECT status, end_reason FROM call_sessions
    WHERE pair_id = $1 AND kind = 'video' AND started_at < now() - interval '10 hours'`, [pairId]);
check('and it is closed as ended, since it was answered', zombie.rows[0]?.status === 'ended', zombie.rows);

console.log('\n=== A CALL RINGING FOR A FEW SECONDS IS NOT STALE ===');
const live = await req('/calls/current', { token: A.token });
check('the fresh call is still reported as live', Boolean(live.data?.call), live.data);
check('and still ringing', live.data?.call?.status === 'ringing', live.data?.call?.status);
await req(`/calls/${afterZombie.data.call.id}/end`, { method: 'POST', token: A.token, body: { reason: 'hangup' } });

console.log('\n=== AND CALLING WORKS AGAIN AFTERWARDS, REPEATEDLY ===');
for (let i = 0; i < 3; i += 1) {
  const c = await req('/calls/start', { method: 'POST', token: A.token, body: { kind: 'voice' } });
  check(`call ${i + 1} of 3 starts cleanly`, c.status === 201, { status: c.status, error: c.data?.error });
  await req(`/calls/${c.data.call.id}/end`, { method: 'POST', token: A.token, body: { reason: 'hangup' } });
}

console.log(`\nSTALE CALL RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
process.exit(0);
