// Photos, end to end — upload, store, and actually render.
//
// Written because "the photos can't be shared" turned out to have nothing to
// do with sharing. The upload worked, the object landed in storage, the row
// was returned to both phones, and every single <Image> came back empty.
//
// /media was requireAuth, which reads the Authorization header. An
// <Image source={{ uri }} /> is fetched by the platform's own image loader —
// Fresco on Android, NSURLSession on iOS — and JavaScript never gets to set a
// header on that request. So every photo in the app 401'd: messages,
// memories, the widget preview, photo wallpapers, all of it.
//
// The fix mirrors what the widget endpoints already did: the same access
// token is accepted in the query string. These assertions pin both halves —
// that a signed URL serves real image bytes, and that an unsigned or forged
// one still gets nothing.
import { io } from 'socket.io-client';

const API = 'http://localhost:4000';
const stamp = Date.now();
let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${JSON.stringify(d)}`); } };

// A real 1x1 PNG. The point is that genuine image bytes survive the round
// trip, not that a base64-shaped string does.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function req(path, { method = 'GET', body, token, raw = false, headers = {} } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

const signup = async (name) => {
  const u = { email: `media-${name}${stamp}@t.dev`, password: 'pw123456', name };
  const r = await req('/auth/signup', { method: 'POST', body: u });
  return { ...u, token: r.data.accessToken, id: r.data.user.id };
};

const A = await signup('Ana');
const B = await signup('Ben');
const invite = await req('/auth/invite', { method: 'POST', token: A.token, body: { deviceTimezone: 'UTC' } });
await req('/auth/invite/accept', { method: 'POST', token: B.token, body: { inviteCode: invite.data.inviteCode, deviceTimezone: 'UTC' } });

console.log('=== A SENDS A PHOTO IN THE THREAD ===');
const sent = await req('/messages', { method: 'POST', token: A.token, body: { type: 'photo', image: PNG } });
check('the photo message is accepted', sent.status === 201, sent.data);
const key = sent.data.message?.image_url;
check('a storage key comes back', Boolean(key), sent.data.message);
check('it is typed as a photo', sent.data.message?.type === 'photo');

console.log('\n=== B CAN LOAD THE IMAGE THE WAY AN <Image> WOULD ===');
// This is the exact request React Native makes: a bare GET on the URI, with
// no headers of its own. It used to come back 401.
const asImageLoader = await fetch(`${API}/media/${key}?token=${encodeURIComponent(B.token)}`);
check('a signed media URL is served', asImageLoader.status === 200, asImageLoader.status);
check('and carries an image Content-Type',
  /^image\//.test(asImageLoader.headers.get('content-type') || ''),
  asImageLoader.headers.get('content-type'));
check('the exact stored type comes back, not a guess',
  asImageLoader.headers.get('content-type') === 'image/png',
  asImageLoader.headers.get('content-type'));
const bytes = Buffer.from(await asImageLoader.arrayBuffer());
check('real bytes, not an error page', bytes.length > 0 && bytes.slice(0, 8).equals(PNG_MAGIC),
  bytes.slice(0, 16).toString('hex'));
check('it is cacheable, so scrolling does not refetch every photo',
  /max-age=\d+/.test(asImageLoader.headers.get('cache-control') || ''),
  asImageLoader.headers.get('cache-control'));

console.log('\n=== THE HEADER STILL WORKS, AND IS STILL PREFERRED ===');
const viaHeader = await req(`/media/${key}`, { token: A.token, raw: true });
check('an ordinary API client can use the Authorization header', viaHeader.status === 200, viaHeader.status);
// A good header beats a bad query string: the header is checked first.
const goodHeaderBadQuery = await fetch(`${API}/media/${key}?token=rubbish`, {
  headers: { Authorization: `Bearer ${A.token}` },
});
check('the header wins when both are present', goodHeaderBadQuery.status === 200, goodHeaderBadQuery.status);

console.log('\n=== AND IT IS STILL AUTHENTICATED ===');
check('no credential at all gets nothing', (await req(`/media/${key}`)).status === 401);
check('a made-up token gets nothing',
  (await fetch(`${API}/media/${key}?token=not-a-real-token`)).status === 401);
check('a refresh token is not an access token',
  (await fetch(`${API}/media/${key}?token=${encodeURIComponent((await req('/auth/login', { method: 'POST', body: { email: A.email, password: A.password } })).data.refreshToken)}`)).status === 401);
check('a missing object is a 404, not a 500',
  (await fetch(`${API}/media/messages/nope/does-not-exist.png?token=${encodeURIComponent(A.token)}`)).status === 404);

console.log('\n=== MEMORIES AND WIDGET PHOTOS LOAD THE SAME WAY ===');
const memory = await req('/memories', {
  method: 'POST', token: A.token, body: { image: PNG, caption: 'us' },
});
check('a memory uploads', memory.status === 201, memory.data);
const memKey = memory.data.memory?.image_url;
const memRes = await fetch(`${API}/media/${memKey}?token=${encodeURIComponent(B.token)}`);
check('the partner can load it', memRes.status === 200, memRes.status);
check('as an image', /^image\//.test(memRes.headers.get('content-type') || ''),
  memRes.headers.get('content-type'));

const drop = await req('/widget-photos', { method: 'POST', token: B.token, body: { image: PNG, caption: 'hi' } });
const dropRes = await fetch(`${API}/media/${drop.data.widgetPhoto.image_url}?token=${encodeURIComponent(A.token)}`);
check('a widget photo loads in the app too', dropRes.status === 200, dropRes.status);

console.log('\n=== THE SENDER GETS THEIR OWN MESSAGE BACK OVER THE SOCKET ===');
// Not a bug — the sender's other devices need it, and so does a phone that
// reconnected mid-send. It is the reason the client merges by id instead of
// appending: this echo plus the POST response is what made every message the
// sender wrote appear twice.
const socket = io(API, { auth: { token: A.token }, transports: ['websocket'] });
await new Promise((resolve) => socket.on('connect', resolve));

const echoed = [];
socket.on('message:new', ({ message }) => echoed.push(message));

const own = await req('/messages', { method: 'POST', token: A.token, body: { type: 'text', content: `echo-${stamp}` } });
await new Promise((r) => setTimeout(r, 400));

const mine = echoed.filter((m) => m.id === own.data.message.id);
check('the sender is echoed their own message', mine.length === 1, echoed.map((m) => m.content));
check('and it is byte-identical to what the POST returned',
  mine[0]?.content === own.data.message.content && mine[0]?.id === own.data.message.id);
check('which is exactly one message, delivered twice by two routes',
  mine.length === 1 && own.data.message.id === mine[0].id);

socket.close();

console.log(`\nMEDIA RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
process.exit(0);
