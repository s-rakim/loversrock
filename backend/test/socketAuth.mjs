// The socket's handshake, and what happens when the token behind it is dead.
//
// This is the bug that made calls impossible and live messages stop arriving,
// and it is worth stating precisely because nothing about it was visible:
//
//   * The socket authenticates on handshake with the access token.
//   * That token lives 15 minutes.
//   * The client passed `auth: { token }` — a VALUE, captured once, at first
//     connect.
//   * A socket.io middleware rejection is NOT retryable. The server calls
//     next(new Error('Unauthorized')), the client fires a single
//     connect_error, sets socket.active = false, and stops. Permanently.
//
// So on any app launch more than fifteen minutes after the last one, the
// socket was rejected once and stayed dead for the whole session. Messages
// still POSTed, so the sender saw their own; the partner never saw them
// arrive. A call emitted its SDP offer into a closed socket, the callee never
// rang, and the caller sat on "Calling…" until they killed the app.
//
// The client fix is `auth` as a callback plus an explicit reconnect. This
// exercises the server side of both halves against a real handshake.
import { io } from 'socket.io-client';
import jwt from 'jsonwebtoken';

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
  const u = { email: `sockauth-${n}${stamp}@t.dev`, password: 'pw123456', name: n };
  const r = await req('/auth/signup', { method: 'POST', body: u });
  return { ...u, token: r.data.accessToken, refresh: r.data.refreshToken, id: r.data.user.id };
};
const settle = (ms = 1500) => new Promise((r) => setTimeout(r, ms));

const A = await signup('Ana');
const B = await signup('Ben');
const invite = await req('/auth/invite', { method: 'POST', token: A.token, body: { deviceTimezone: 'UTC' } });
await req('/auth/invite/accept', { method: 'POST', token: B.token, body: { inviteCode: invite.data.inviteCode, deviceTimezone: 'UTC' } });

console.log('=== AN EXPIRED TOKEN IS REJECTED, AND NOT RETRIED BY SOCKET.IO ===');
const expired = jwt.sign({ sub: A.id }, process.env.JWT_ACCESS_SECRET, { expiresIn: '-60s' });

const dead = io(API, { auth: { token: expired }, transports: ['websocket'] });
const deadErrors = [];
let deadConnected = false;
dead.on('connect', () => { deadConnected = true; });
dead.on('connect_error', (e) => deadErrors.push(e.message));
await settle(2500);

check('the handshake is refused', deadConnected === false && deadErrors.length > 0, deadErrors);
// This is the property that made it permanent rather than transient.
check('socket.io gives up for good (active === false)', dead.active === false, dead.active);
check('so a captured token could never recover on its own', dead.connected === false);

console.log('\n=== WHICH IS WHY THE CLIENT MUST SUPPLY A FRESH ONE PER ATTEMPT ===');
// The reconnect path: refresh over REST, then hand the NEW token to the very
// same socket and connect it again. That is what `auth` as a callback does.
const refreshed = await req('/auth/refresh', { method: 'POST', body: { refreshToken: A.refresh } });
check('the refresh token still works after the access token died',
  refreshed.status === 200 && Boolean(refreshed.data.accessToken), refreshed.status);

let token = expired;
const reviving = io(API, {
  // Exactly the shape services/api.js uses: a function, called before every
  // attempt, so a reconnect authenticates with whatever is current.
  auth: (cb) => cb({ token }),
  transports: ['websocket'],
});
const revivingErrors = [];
reviving.on('connect_error', (e) => revivingErrors.push(e.message));
await settle(2000);
check('it is refused while the token is stale', reviving.connected === false, reviving.connected);

token = refreshed.data.accessToken;    // what freshAccessToken() would return
reviving.connect();                    // what the connect_error handler does
await settle(2500);
check('and connects once the callback returns a live token', reviving.connected === true,
  { connected: reviving.connected, errors: revivingErrors });

console.log('\n=== AND A RECOVERED SOCKET IS A FULLY WORKING ONE ===');
// Being connected is not the point; being in the pair room is.
const partner = io(API, { auth: (cb) => cb({ token: B.token }), transports: ['websocket'] });
await new Promise((r) => partner.on('connect', r));

const seen = [];
partner.on('message:new', ({ message }) => seen.push(message));
const sent = await req('/messages', { method: 'POST', token: token, body: { type: 'text', content: `revived-${stamp}` } });
await settle(800);
check('a message sent after the recovery reaches the partner live',
  seen.some((m) => m.id === sent.data.message.id), seen.map((m) => m.content));

// The call handshake, which is the thing that was hanging on "Calling…".
const offers = [];
partner.on('call:offer', (payload) => offers.push(payload));
const call = await req('/calls/start', { method: 'POST', token, body: { kind: 'voice' } });
check('a call can be started', call.status === 201 || call.status === 200, call.data);
reviving.emit('call:offer', { callId: call.data.call.id, kind: 'voice', sdp: 'v=0', type: 'offer' });
await settle(800);
check('and its SDP offer actually reaches the other phone',
  offers.some((o) => o.callId === call.data.call.id), offers);
check('which is what "Calling…" was waiting for and never got', offers.length === 1, offers.length);

console.log('\n=== A TOKEN FOR SOMEONE WHO IS NOT PAIRED IS STILL REFUSED ===');
const C = await signup('Cal');
const lonely = io(API, { auth: (cb) => cb({ token: C.token }), transports: ['websocket'] });
const lonelyErrors = [];
lonely.on('connect_error', (e) => lonelyErrors.push(e.message));
await settle(1500);
check('an unpaired user gets no socket', lonely.connected === false, lonely.connected);
check('and is told why', lonelyErrors.length > 0, lonelyErrors);

[dead, reviving, partner, lonely].forEach((s) => s.close());

console.log(`\nSOCKET AUTH RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
process.exit(0);
