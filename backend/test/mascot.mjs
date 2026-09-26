// Uploaded mascots: each person's own picture, replacing the preset artwork.
// Runs against a live server (npm start) with storage (test/local-s3.js).
const API = 'http://localhost:4000';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const JPG_THUMB = PNG.replace('image/png', 'image/jpeg');
const stamp = Date.now();
let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${JSON.stringify(d)}`); } };

async function req(path, { method = 'GET', body, token, widgetToken, headers = {}, raw = false } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(widgetToken ? { 'X-Widget-Token': widgetToken } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

const A = { email: `m-a${stamp}@t.dev`, password: 'pw123456', name: 'MascotA' };
const B = { email: `m-b${stamp}@t.dev`, password: 'pw123456', name: 'MascotB' };
for (const u of [A, B]) u.token = (await req('/auth/signup', { method: 'POST', body: u })).data.accessToken;
const WT = (await req('/widget/token', { method: 'POST', token: A.token, body: {} })).data.widgetToken;

console.log('=== NO MASCOT TO START WITH ===');
let prof = (await req('/profile', { token: A.token })).data;
check('a new account has no mascot (the app draws the wardrobe character)', prof.me.mascot === null, prof.me);

console.log('\n=== UPLOAD ===');
check('image and thumb are both required', (await req('/profile/mascot', { method: 'PUT', token: A.token, body: { image: PNG, width: 1, height: 1 } })).status === 400);
check('the size must be real numbers', (await req('/profile/mascot', { method: 'PUT', token: A.token, body: { image: PNG, thumb: PNG, width: 0, height: '5' } })).status === 400);
check('a non-image is refused', (await req('/profile/mascot', { method: 'PUT', token: A.token, body: { image: 'hello', thumb: PNG, width: 1, height: 1 } })).status === 400);
const huge = `data:image/jpeg;base64,${'A'.repeat(9 * 1024 * 1024)}`;
check('a camera original that skipped the resize is refused', (await req('/profile/mascot', { method: 'PUT', token: A.token, body: { image: huge, thumb: PNG, width: 1, height: 1 } })).status === 413);
check('uploading needs you to be signed in', (await req('/profile/mascot', { method: 'PUT', body: { image: PNG, thumb: PNG, width: 1, height: 1 } })).status === 401);

const up = await req('/profile/mascot', { method: 'PUT', token: A.token, body: { image: PNG, thumb: JPG_THUMB, width: 400, height: 900 } });
check('a mascot uploads', up.status === 200 && up.data.mascot.key.startsWith('mascots/') && up.data.mascot.width === 400, up.data);
const firstKey = up.data.mascot.key;
prof = (await req('/profile', { token: A.token })).data;
check('/profile returns it with its size, before the image has loaded', prof.me.mascot?.key === firstKey && prof.me.mascot.height === 900, prof.me.mascot);
check('it works before pairing', prof.paired === false);
check('and the picture itself is served', (await req(`/media/${firstKey}?token=${A.token}`, { raw: true })).status === 200);

console.log('\n=== THE PARTNER SEES IT ===');
const inv = await req('/auth/invite', { method: 'POST', token: A.token, body: { deviceTimezone: 'UTC' } });
await req('/auth/invite/accept', { method: 'POST', token: B.token, body: { inviteCode: inv.data.inviteCode } });
const theirs = (await req('/profile', { token: B.token })).data;
check("the partner's /profile carries my mascot", theirs.partner.mascot?.key === firstKey, theirs.partner);
check('and they have none of their own yet', theirs.me.mascot === null);
check('and can load the picture', (await req(`/media/${firstKey}?token=${B.token}`, { raw: true })).status === 200);

console.log('\n=== THE WIDGET ===');
let s = (await req('/widget/summary', { widgetToken: WT })).data;
check('the summary says when my mascot last changed', typeof s.myMascotAt === 'string' && s.partnerMascotAt === null, [s.myMascotAt, s.partnerMascotAt]);
const img = await req('/widget/mascot/me', { widgetToken: WT, raw: true });
const etag = img.headers.get('etag');
check('the widget downloads the small copy', img.status === 200 && /^image\//.test(img.headers.get('content-type')) && Boolean(etag), [img.status, img.headers.get('content-type'), etag]);
check('and an unchanged picture is a 304, not a re-download',
  (await req('/widget/mascot/me', { widgetToken: WT, headers: { 'If-None-Match': etag }, raw: true })).status === 304);
check("the partner's is a 404 while they have none", (await req('/widget/mascot/partner', { widgetToken: WT, raw: true })).status === 404);
check('anything but me/partner is refused', (await req('/widget/mascot/other', { widgetToken: WT, raw: true })).status === 400);
check('it needs the widget token', (await req('/widget/mascot/me', { raw: true })).status === 401);

await req('/profile/mascot', { method: 'PUT', token: B.token, body: { image: PNG, thumb: PNG, width: 300, height: 300 } });
s = (await req('/widget/summary', { widgetToken: WT })).data;
check("once they upload, the summary has theirs too", typeof s.partnerMascotAt === 'string', s.partnerMascotAt);
check('and the widget can fetch it', (await req('/widget/mascot/partner', { widgetToken: WT, raw: true })).status === 200);

console.log('\n=== REPLACE AND REMOVE ===');
await new Promise((r) => setTimeout(r, 20));
const again = await req('/profile/mascot', { method: 'PUT', token: A.token, body: { image: PNG, thumb: PNG, width: 500, height: 1000 } });
check('uploading again replaces it', again.status === 200 && again.data.mascot.key !== firstKey && again.data.mascot.width === 500);
check('and the old picture is deleted, not left in storage', (await req(`/media/${firstKey}?token=${A.token}`, { raw: true })).status === 404);
check('and the widget sees a new version',
  (await req('/widget/mascot/me', { widgetToken: WT, headers: { 'If-None-Match': etag }, raw: true })).status === 200);

check('removing it works', (await req('/profile/mascot', { method: 'DELETE', token: A.token })).status === 204);
prof = (await req('/profile', { token: A.token })).data;
check('the app goes back to the drawn character', prof.me.mascot === null, prof.me.mascot);
check('the stored picture is gone', (await req(`/media/${again.data.mascot.key}?token=${A.token}`, { raw: true })).status === 404);
s = (await req('/widget/summary', { widgetToken: WT })).data;
check('the widget is told there is none', s.myMascotAt === null, s.myMascotAt);
check('and a fetch is a 404', (await req('/widget/mascot/me', { widgetToken: WT, raw: true })).status === 404);
check("removing only touched my own - theirs is still there", (await req('/profile', { token: B.token })).data.me.mascot !== null);

console.log(`\nMASCOT RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log('FAILURES:', fails); process.exit(1); }
