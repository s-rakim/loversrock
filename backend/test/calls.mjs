// Voice and video calls, against a live stack.
//
// The media itself is peer to peer and cannot be exercised without two real
// devices. Everything the SERVER is responsible for can be, and is: the call
// record and its state machine, the privacy boundary, and above all the
// signalling relay carrying a complete WebRTC handshake between two real
// sockets in the right order.
import { io } from 'socket.io-client';

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
  const u = { email: `call-${name}${stamp}@t.dev`, password: 'pw123456', name };
  const r = await req('/auth/signup', { method: 'POST', body: u });
  return { ...u, token: r.data.accessToken, id: r.data.user.id };
};
const connect = (token) => new Promise((resolve, reject) => {
  const s = io(API, { auth: { token }, transports: ['websocket'] });
  s.on('connect', () => resolve(s));
  s.on('connect_error', reject);
});
/** Waits for one event, with a deadline so a missing relay fails loudly. */
const waitFor = (socket, event, ms = 3000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), ms);
  socket.once(event, (payload) => { clearTimeout(timer); resolve(payload); });
});

const A = await signup('Ana');      // caller
const B = await signup('Ben');      // callee
const C = await signup('Cal');      // outside the pair
const invite = await req('/auth/invite', { method: 'POST', token: A.token, body: { deviceTimezone: 'UTC' } });
await req('/auth/invite/accept', { method: 'POST', token: B.token, body: { inviteCode: invite.data.inviteCode, deviceTimezone: 'UTC' } });

console.log('=== ICE CONFIGURATION ===');
const config = await req('/calls/config', { token: A.token });
check('config is served', config.status === 200, config.data);
check('at least one STUN server', config.data.iceServers?.length > 0, config.data.iceServers);
check('STUN urls look like STUN urls',
  config.data.iceServers[0].urls.every((u) => u.startsWith('stun:')), config.data.iceServers[0]);
check('whether TURN is configured is stated plainly',
  typeof config.data.hasTurn === 'boolean', config.data.hasTurn);
check('no credentials are served when there is no TURN',
  config.data.hasTurn || !JSON.stringify(config.data).includes('credential'), config.data);
check('an unpaired user cannot read call config',
  (await req('/calls/config', { token: C.token })).status === 403);

console.log('\n=== A VOICE CALL, START TO FINISH ===');
let current = await req('/calls/current', { token: A.token });
check('no call to begin with', current.data.call === null, current.data);

const started = await req('/calls/start', { method: 'POST', token: A.token, body: { kind: 'voice' } });
check('the call starts', started.status === 201, started.data);
check('it is ringing', started.data.call.status === 'ringing', started.data.call);
check('the caller is told they are the caller', started.data.call.role === 'caller', started.data.call);

const calleeView = await req('/calls/current', { token: B.token });
check('the callee sees it as incoming', calleeView.data.call.role === 'callee', calleeView.data.call);
check('and it is the same call', calleeView.data.call.id === started.data.call.id);

const second = await req('/calls/start', { method: 'POST', token: B.token, body: { kind: 'voice' } });
check('a second call cannot be started while one is live', second.status === 409, second.data);
check('and the existing one is handed back', second.data.call?.id === started.data.call.id, second.data);

const answered = await req(`/calls/${started.data.call.id}/answer`, { method: 'POST', token: B.token });
check('the callee can answer', answered.status === 200, answered.data);
check('the call is connected', answered.data.call.status === 'connected', answered.data.call);
check('and the answer time is recorded', Boolean(answered.data.call.answeredAt), answered.data.call);

check('the caller cannot answer their own call',
  (await req(`/calls/${started.data.call.id}/answer`, { method: 'POST', token: A.token })).status === 404);

const ended = await req(`/calls/${started.data.call.id}/end`, { method: 'POST', token: A.token, body: { reason: 'hangup' } });
check('hanging up ends it', ended.data.call.status === 'ended', ended.data.call);
check('a duration is computed', typeof ended.data.call.durationSeconds === 'number', ended.data.call);
check('ending twice is harmless',
  (await req(`/calls/${started.data.call.id}/end`, { method: 'POST', token: B.token })).data.call.status === 'ended');
check('and there is no live call afterwards',
  (await req('/calls/current', { token: A.token })).data.call === null);

console.log('\n=== DECLINED AND MISSED ARE DIFFERENT THINGS ===');
const toDecline = await req('/calls/start', { method: 'POST', token: A.token, body: { kind: 'video' } });
const declined = await req(`/calls/${toDecline.data.call.id}/end`, { method: 'POST', token: B.token, body: { reason: 'declined' } });
check('the callee hanging up before answering is a decline',
  declined.data.call.status === 'declined', declined.data.call);

const toMiss = await req('/calls/start', { method: 'POST', token: A.token, body: { kind: 'voice' } });
const missed = await req(`/calls/${toMiss.data.call.id}/end`, { method: 'POST', token: A.token, body: { reason: 'timeout' } });
check('the caller giving up before it is answered is a miss',
  missed.data.call.status === 'missed', missed.data.call);
check('a missed call has no duration', missed.data.call.durationSeconds === null, missed.data.call);

console.log('\n=== HISTORY ===');
const history = await req('/calls/history', { token: B.token });
check('history lists the calls', history.data.calls.length >= 3, history.data.calls.length);
check('newest first',
  new Date(history.data.calls[0].startedAt) >= new Date(history.data.calls[1].startedAt));
check('both kinds are recorded',
  history.data.calls.some((c) => c.kind === 'video') && history.data.calls.some((c) => c.kind === 'voice'));
check('roles are from the reader’s point of view',
  history.data.calls.every((c) => c.role === 'callee'), history.data.calls.map((c) => c.role));
check('no media, no recording, nothing but bookkeeping',
  !JSON.stringify(history.data).match(/sdp|recording|media_url|stream/i), history.data);

console.log('\n=== SOMEONE OUTSIDE THE PAIR ===');
check('cannot start a call', (await req('/calls/start', { method: 'POST', token: C.token, body: { kind: 'voice' } })).status === 403);
check('cannot read history', (await req('/calls/history', { token: C.token })).status === 403);
const live = await req('/calls/start', { method: 'POST', token: A.token, body: { kind: 'voice' } });
check('cannot answer someone else’s call',
  (await req(`/calls/${live.data.call.id}/answer`, { method: 'POST', token: C.token })).status === 403);
check('cannot hang up someone else’s call',
  (await req(`/calls/${live.data.call.id}/end`, { method: 'POST', token: C.token })).status === 403);
await req(`/calls/${live.data.call.id}/end`, { method: 'POST', token: A.token });

console.log('\n=== THE SIGNALLING RELAY CARRIES A REAL HANDSHAKE ===');
const sockA = await connect(A.token);
const sockB = await connect(B.token);
check('both phones connect', sockA.connected && sockB.connected);

// A full WebRTC handshake in the order the browsers/native stacks do it:
// offer -> answer -> trickled candidates from both ends.
const offerHeard = waitFor(sockB, 'call:offer');
// The sender must NOT get their own offer back - socket.to(room) excludes
// the sender, and an echo here would make the caller try to answer itself.
let echoed = false;
sockA.on('call:offer', () => { echoed = true; });
sockA.emit('call:offer', { callId: 'test-call', sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n', kind: 'video' });
const offer = await offerHeard;
check('the offer reaches the other phone', offer.sdp?.startsWith('v=0'), offer);
check('and is stamped with who sent it', offer.fromUserId === A.id, offer);
await new Promise((r) => setTimeout(r, 300));
check('the caller does not receive their own offer back', echoed === false);

const answerHeard = waitFor(sockA, 'call:answer');
sockB.emit('call:answer', { callId: 'test-call', sdp: 'v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\n' });
const answerSdp = await answerHeard;
check('the answer comes back', answerSdp.sdp?.startsWith('v=0'), answerSdp);
check('stamped with the answerer', answerSdp.fromUserId === B.id, answerSdp);

// Trickle ICE: several candidates, each relayed as it is found.
const candidates = [];
sockB.on('call:ice', (p) => candidates.push(p));
for (let i = 0; i < 3; i += 1) {
  sockA.emit('call:ice', { callId: 'test-call', candidate: { candidate: `candidate:${i} 1 udp 2130706431 10.0.0.${i} 5000 typ host`, sdpMLineIndex: 0 } });
}
await new Promise((r) => setTimeout(r, 400));
check('every trickled candidate is relayed', candidates.length === 3, candidates.length);
check('in the order they were sent',
  candidates.every((c, i) => c.candidate.candidate.startsWith(`candidate:${i} `)),
  candidates.map((c) => c.candidate.candidate.slice(0, 12)));

const renegotiated = waitFor(sockB, 'call:renegotiate');
sockA.emit('call:renegotiate', { callId: 'test-call', sdp: 'v=0\r\n', reason: 'voice-to-video' });
check('a voice call can renegotiate to video', Boolean(await renegotiated));

const hangupHeard = waitFor(sockB, 'call:hangup');
sockA.emit('call:hangup', { callId: 'test-call' });
check('hangup is relayed', Boolean(await hangupHeard));

// A phone that dies mid-call must not leave the other end on a frozen frame.
const goneHeard = waitFor(sockB, 'call:peer-gone', 4000);
sockA.disconnect();
const gone = await goneHeard;
check('a dropped socket tells the other end immediately', gone.fromUserId === A.id, gone);

console.log('\n=== SIGNALLING CANNOT CROSS INTO ANOTHER PAIR ===');
const sockC = await connect(C.token).catch((err) => err);
check('an unpaired user cannot even open a socket',
  sockC instanceof Error, sockC instanceof Error ? sockC.message : 'connected');

sockB.disconnect();
if (sockC && !(sockC instanceof Error)) sockC.disconnect();

console.log(`\nCALL RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
process.exit(0);
