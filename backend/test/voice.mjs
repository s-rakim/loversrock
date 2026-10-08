// Voice notes.
//
// What matters: the partner gets a link that plays WITHOUT a bearer token
// (the Android service that plays it has none), that link opens exactly one
// note for exactly one person, it survives the Range requests an audio player
// makes, and nobody outside the pair can get at the recording.
//
//   node --env-file=.env test/voice.mjs
import crypto from 'crypto';
import { io } from 'socket.io-client';

const API = 'http://localhost:4000';
const stamp = Date.now();
let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${JSON.stringify(d)?.slice(0, 300)}`); } };

const req = async (p, o = {}) => {
  const res = await fetch(`${API}${p}`, {
    method: o.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}),
      ...(o.headers || {}),
    },
    body: o.body ? JSON.stringify(o.body) : undefined,
  });
  return { status: res.status, data: res.status === 204 ? null : await res.json().catch(() => null) };
};
const raw = async (p, headers = {}) => {
  const res = await fetch(`${API}${p}`, { headers });
  return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) };
};
const signup = async (n) => {
  const u = { email: `voice-${n}${stamp}@t.dev`, password: 'pw123456', name: n };
  const r = await req('/auth/signup', { method: 'POST', body: u });
  return { ...u, token: r.data.accessToken, id: r.data.user.id };
};
const pairUp = async (a, b) => {
  const invite = await req('/auth/invite', { method: 'POST', token: a.token, body: { deviceTimezone: 'UTC' } });
  await req('/auth/invite/accept', { method: 'POST', token: b.token, body: { inviteCode: invite.data.inviteCode, deviceTimezone: 'UTC' } });
};

const A = await signup('Ana');
const B = await signup('Ben');
await pairUp(A, B);
const C = await signup('Cal');
const D = await signup('Dee');
await pairUp(C, D);

// Not a real recording — the server stores bytes, it does not decode them —
// but distinct at every offset, so a wrong Range slice cannot pass by luck.
const audio = Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 7 + 3) % 256));

console.log('=== SENDING ===');
const socketB = io(API, { auth: { token: B.token }, transports: ['websocket'] });
const arrived = new Promise((resolve) => socketB.on('voice:new', resolve));
await new Promise((resolve) => socketB.on('connect', resolve));

const sent = await req('/voice', {
  method: 'POST', token: A.token,
  body: { audio: audio.toString('base64'), mimeType: 'audio/mp4', durationMs: 4200 },
});
check('a voice note sends', sent.status === 201, sent.data);
check('it says whether a push went out (none: Firebase is not set up here)', sent.data.pushed === false, sent.data);
check('the sender’s copy is marked as theirs', sent.data.voice.mine === true, sent.data.voice);
const voiceId = sent.data.voice.id;

const event = await Promise.race([arrived, new Promise((r) => setTimeout(() => r(null), 3000))]);
check('the open app hears about it over the socket', event?.voice?.id === voiceId, event);
check('with a link made for the partner, not the sender',
  event?.recipientId === B.id && event?.recipientPath?.includes(`u=${B.id}`), event);
check('and with the sender’s name to show', event?.from === 'Ana', event?.from);
check('and says the open app must play it itself', event?.pushed === false, event?.pushed);
socketB.close();

const bad = await req('/voice', { method: 'POST', token: A.token, body: { audio: audio.toString('base64'), mimeType: 'video/mp4' } });
check('a type that is not audio is refused', bad.status === 400, bad);
const empty = await req('/voice', { method: 'POST', token: A.token, body: { audio: '', mimeType: 'audio/mp4' } });
check('an empty recording is refused', empty.status === 400, empty);
const tiny = await req('/voice', { method: 'POST', token: A.token, body: { audio: 'AAAA', mimeType: 'audio/mp4' } });
check('a recording too short to be one is refused', tiny.status === 400, tiny);
const dataUrl = await req('/voice', {
  method: 'POST', token: A.token,
  body: { audio: `data:audio/aac;base64,${audio.toString('base64')}`, durationMs: 1000 },
});
check('a data URL works too, and its type wins', dataUrl.status === 201 && dataUrl.data.voice.mime_type === 'audio/aac', dataUrl.data);

console.log('\n=== LISTING ===');
const listB = await req('/voice', { token: B.token });
const noteB = listB.data.voiceMessages.find((v) => v.id === voiceId);
check('the partner sees it', Boolean(noteB), listB.data);
check('as not theirs', noteB?.mine === false, noteB);
check('with its length', noteB?.duration_ms === 4200, noteB);
check('newest first', listB.data.voiceMessages[0].id === dataUrl.data.voice.id, listB.data.voiceMessages.map((v) => v.id));
check('unheard so far', noteB?.listened_at === null, noteB);
const listC = await req('/voice', { token: C.token });
check('another couple sees none of it', listC.status === 200 && listC.data.voiceMessages.length === 0, listC.data);
const unpaired = await signup('Solo');
const listSolo = await req('/voice', { token: unpaired.token });
check('and someone unpaired is refused outright', listSolo.status === 403, listSolo);

console.log('\n=== PLAYING, WITH NO TOKEN ===');
const whole = await raw(noteB.path);
check('the partner’s link plays with no bearer token', whole.status === 200, whole.status);
check('every byte of it', whole.bytes.equals(audio), whole.bytes.length);
check('as audio', whole.headers.get('content-type') === 'audio/mp4', whole.headers.get('content-type'));
check('and says it can seek', whole.headers.get('accept-ranges') === 'bytes', whole.headers.get('accept-ranges'));

const heard = await req('/voice', { token: A.token });
check('the sender sees it has been heard', Boolean(heard.data.voiceMessages.find((v) => v.id === voiceId)?.listened_at), heard.data);

const part = await raw(noteB.path, { Range: 'bytes=100-199' });
check('a Range request gets 206', part.status === 206, part.status);
check('and exactly the bytes asked for', part.bytes.equals(audio.subarray(100, 200)), part.bytes.length);
check('with the right Content-Range', part.headers.get('content-range') === `bytes 100-199/${audio.length}`, part.headers.get('content-range'));
const tail = await raw(noteB.path, { Range: 'bytes=-300' });
check('the tail of the file, where an .m4a keeps its index', tail.status === 206 && tail.bytes.equals(audio.subarray(audio.length - 300)), tail.bytes.length);
const open = await raw(noteB.path, { Range: 'bytes=4900-' });
check('an open-ended range runs to the end', open.status === 206 && open.bytes.equals(audio.subarray(4900)), open.bytes.length);
const beyond = await raw(noteB.path, { Range: 'bytes=9000-' });
check('a range past the end is 416, not a crash', beyond.status === 416, beyond.status);

console.log('\n=== THE LINK OPENS ONE NOTE FOR ONE PERSON ===');
const url = new URL(noteB.path, API);
const tampered = new URL(url); tampered.searchParams.set('s', `${url.searchParams.get('s').slice(0, -2)}xx`);
check('a changed signature is refused', (await raw(`${tampered.pathname}${tampered.search}`)).status === 403);
const other = new URL(url); other.searchParams.set('u', C.id);
check('someone else’s id on the partner’s link is refused', (await raw(`${other.pathname}${other.search}`)).status === 403);
const wrongNote = `/voice/${dataUrl.data.voice.id}/audio${url.search}`;
check('the link does not open a different note', (await raw(wrongNote)).status === 403);
const naked = await raw(`/voice/${voiceId}/audio`);
check('no signature at all is refused', naked.status === 403, naked.status);

// A correctly signed link for someone outside the pair — the signature is
// valid, the person is not.
const { purposeKey } = await import('../src/config/secrets.js');
const sign = (id, user, e) => crypto.createHmac('sha256', purposeKey('voice-link'))
  .update(`voice:${id}:${user}:${e}`).digest('base64url');
const future = Math.floor(Date.now() / 1000) + 600;
const outsider = await raw(`/voice/${voiceId}/audio?u=${C.id}&e=${future}&s=${sign(voiceId, C.id, future)}`);
check('a valid link for someone outside the pair finds nothing', outsider.status === 404, outsider.status);
const past = Math.floor(Date.now() / 1000) - 5;
const expired = await raw(`/voice/${voiceId}/audio?u=${B.id}&e=${past}&s=${sign(voiceId, B.id, past)}`);
check('an expired link is refused', expired.status === 403, expired.status);

console.log('\n=== UNSENDING ===');
const notMine = await req(`/voice/${voiceId}`, { method: 'DELETE', token: B.token });
check('the partner cannot unsend what they were sent', notMine.status === 404, notMine);
const gone = await req(`/voice/${voiceId}`, { method: 'DELETE', token: A.token });
check('the sender can', gone.status === 204, gone);
check('and the link stops working', (await raw(noteB.path)).status === 404);
const after = await req('/voice', { token: B.token });
check('and it is gone from the list', !after.data.voiceMessages.some((v) => v.id === voiceId), after.data);

console.log(`\nVOICE RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
process.exit(0);
