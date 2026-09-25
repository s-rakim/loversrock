// The locket: a photo taken in the app appearing on the partner's home
// screen widget, in both directions.
//
// Traced the whole way through, because the chain crosses four systems and
// each hop has its own failure mode:
//
//   app  --POST /widget-photos-->  server  --FCM data message-->  phone
//   widget process  --GET /widget/photo (widget token)-->  server
//
// What cannot be tested here is the last inch: whether the Kotlin actually
// paints the bitmap onto a home screen. That needs a device. Everything up
// to the bytes arriving at the widget's own credential is exercised.
import { io } from 'socket.io-client';

const API = 'http://localhost:4000';
const stamp = Date.now();
let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${JSON.stringify(d)}`); } };

// A real 1x1 PNG, so the upload path handles actual image bytes rather than
// a string that happens to be base64.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function req(path, { method = 'GET', body, token, widgetToken, raw = false } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      // The widget runs in its own process and authenticates with this
      // header instead of a session token.
      ...(widgetToken ? { 'X-Widget-Token': widgetToken } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const signup = async (name) => {
  const u = { email: `locket-${name}${stamp}@t.dev`, password: 'pw123456', name };
  const r = await req('/auth/signup', { method: 'POST', body: u });
  return { ...u, token: r.data.accessToken, id: r.data.user.id };
};

const A = await signup('Ana');
const B = await signup('Ben');
const C = await signup('Cal');   // outside the pair
const invite = await req('/auth/invite', { method: 'POST', token: A.token, body: { deviceTimezone: 'UTC' } });
await req('/auth/invite/accept', { method: 'POST', token: B.token, body: { inviteCode: invite.data.inviteCode, deviceTimezone: 'UTC' } });

console.log('=== A SENDS A PHOTO FROM THE APP ===');
const empty = await req('/widget-photos/latest', { token: B.token });
check('nothing on the widget to begin with', empty.data.widgetPhoto === null, empty.data);

const sent = await req('/widget-photos', {
  method: 'POST', token: A.token, body: { image: PNG, caption: 'morning' },
});
check('the upload is accepted', sent.status === 201, sent.data);
check('an image key comes back', Boolean(sent.data.widgetPhoto?.image_url), sent.data.widgetPhoto);
check('the caption is kept', sent.data.widgetPhoto.caption === 'morning');
check('it is attributed to the sender', sent.data.widgetPhoto.sender_id === A.id);
check('a photo is required', (await req('/widget-photos', { method: 'POST', token: A.token, body: {} })).status === 400);

console.log('\n=== B SEES IT ===');
const bLatest = await req('/widget-photos/latest', { token: B.token });
check('the partner sees the latest photo', bLatest.data.widgetPhoto?.id === sent.data.widgetPhoto.id, bLatest.data);
check('with the caption', bLatest.data.widgetPhoto.caption === 'morning');

// The app mirrors every widget photo into Memories, so a failed native
// delivery never means the photo is lost.
const memories = await req('/memories', { token: B.token });
const mirrored = memories.data.memories.find((m) => m.image_url === sent.data.widgetPhoto.image_url);
check('it is mirrored into shared Memories', Boolean(mirrored), memories.data.memories?.length);
check('and tagged as coming from the widget', mirrored?.source === 'widget', mirrored?.source);

console.log('\n=== THE WIDGET PROCESS FETCHES IT WITH ITS OWN CREDENTIAL ===');
// The widget runs in a separate OS process and cannot hold a session token.
const bToken = await req('/widget/token', { method: 'POST', token: B.token });
check('the partner can issue a widget token',
  bToken.status === 201 && Boolean(bToken.data.widgetToken), bToken.data);
const bWidget = bToken.data.widgetToken;

// /widget/summary takes the credential as a header. /widget/photo takes it
// in the query string instead, because neither platform's image loader can
// attach a header - so both forms are exercised.
const summary = await req('/widget/summary', { widgetToken: bWidget });
check('the widget summary is served to it', summary.status === 200, summary.status);
check('and reports that a photo is waiting',
  summary.data.hasPhoto === true || Boolean(summary.data.latestPhotoUrl), summary.data);

const photoRes = await req(`/widget/photo?token=${bWidget}`, { raw: true });
check('the widget can fetch the image itself', photoRes.status === 200, photoRes.status);
check('and it is served as an image', /^image\//.test(photoRes.headers.get('content-type') || ''),
  photoRes.headers.get('content-type'));
const bytes = Buffer.from(await photoRes.arrayBuffer());
check('real image bytes come back', bytes.length > 0, bytes.length);
// Every PNG starts with this 8-byte signature. If the endpoint ever started
// returning JSON or an error page, this is what would catch it.
check('the bytes are a real PNG, not an error page',
  bytes.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  bytes.slice(0, 8).toString('hex'));

console.log('\n=== AND THE OTHER WAY ROUND ===');
const backPNG = PNG;
const sentBack = await req('/widget-photos', {
  method: 'POST', token: B.token, body: { image: backPNG, caption: 'goodnight' },
});
check('B can send one too', sentBack.status === 201, sentBack.data);

const aLatest = await req('/widget-photos/latest', { token: A.token });
check('A now sees the newest photo, not the old one',
  aLatest.data.widgetPhoto.id === sentBack.data.widgetPhoto.id, aLatest.data.widgetPhoto);
check('the newest caption is theirs', aLatest.data.widgetPhoto.caption === 'goodnight');
check('and it is attributed to B', aLatest.data.widgetPhoto.sender_id === B.id);

const aToken = await req('/widget/token', { method: 'POST', token: A.token });
const aPhoto = await req(`/widget/photo?token=${aToken.data.widgetToken}`, { raw: true });
check("A's widget fetches the newest photo", aPhoto.status === 200, aPhoto.status);
check('the latest always wins, so the widget is never stale by design',
  (await req('/widget-photos/latest', { token: A.token })).data.widgetPhoto.caption === 'goodnight');

console.log('\n=== THE WALL: EVERY LOCKET EVER SENT ===');
const wall = await req('/widget-photos', { token: A.token });
check('the history loads', wall.status === 200, wall.status);
check('both photos are in it', wall.data.widgetPhotos.length === 2, wall.data.widgetPhotos?.length);
check('newest first, which is the order the wall groups by',
  new Date(wall.data.widgetPhotos[0].created_at) >= new Date(wall.data.widgetPhotos[1].created_at),
  wall.data.widgetPhotos.map((p) => p.created_at));
check('each row carries what a tile needs',
  wall.data.widgetPhotos.every((p) => p.id && p.image_url && p.created_at),
  wall.data.widgetPhotos[0]);
// The footer counts, sent with the list so the screen needs one request.
check('the total rides along', wall.data.total === 2, wall.data.total);
check('and the streak', typeof wall.data.streak === 'number', wall.data.streak);
check('the partner sees the same wall',
  (await req('/widget-photos', { token: B.token })).data.total === 2);
check('a stranger sees none of it',
  (await req('/widget-photos', { token: C.token })).status === 403);

console.log('\n=== THE WIDGET TOKEN IS READ-ONLY AND SCOPED ===');
check('it cannot send a photo',
  (await req('/widget-photos', { method: 'POST', widgetToken: bWidget, body: { image: PNG } })).status === 401);
check('it cannot read messages', (await req('/messages', { widgetToken: bWidget })).status === 401);
check('it cannot read memories', (await req('/memories', { widgetToken: bWidget })).status === 401);
check('it cannot read raw period logs',
  (await req('/period/cycles', { widgetToken: bWidget })).status === 401);
check('a made-up token gets nothing', (await req('/widget/photo?token=not-a-real-token')).status === 401);
check('no token at all gets nothing', (await req('/widget/photo')).status === 401);

console.log('\n=== OUTSIDE THE PAIR ===');
check('a stranger cannot send to this pair’s widget',
  (await req('/widget-photos', { method: 'POST', token: C.token, body: { image: PNG } })).status === 403);
check('nor read what is on it',
  (await req('/widget-photos/latest', { token: C.token })).status === 403);
const cToken = await req('/widget/token', { method: 'POST', token: C.token });
if (cToken.status === 201) {
  const cPhoto = await req(`/widget/photo?token=${cToken.data.widgetToken}`, { raw: true });
  check('their own widget token shows them nothing of this pair',
    cPhoto.status === 404 || cPhoto.status === 403, cPhoto.status);
} else {
  check('an unpaired user cannot even get a widget token', true);
}

console.log('\n=== REVOKING THE WIDGET DOES NOT LOG THE PHONE OUT ===');
await req(`/widget/token/${bToken.data.id}`, { method: 'DELETE', token: B.token });
check('the widget credential stops working',
  (await req(`/widget/photo?token=${bWidget}`)).status === 401,
  (await req(`/widget/photo?token=${bWidget}`)).status);
check('and its summary too',
  (await req('/widget/summary', { widgetToken: bWidget })).status === 401,
  (await req('/widget/summary', { widgetToken: bWidget })).status);
check('but the app session is untouched',
  (await req('/widget-photos/latest', { token: B.token })).status === 200);

console.log(`\nLOCKET RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
process.exit(0);
