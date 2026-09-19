// Exercises the nickname feature: setting what you call each other, reading
// both directions, validation, and the boundary that matters most — that a
// nickname is attached to a pairing and cannot survive into a new one
// (docs/SPEC.md #6).
const API = 'http://localhost:4000';
const stamp = Date.now();
let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${JSON.stringify(d)}`); } };

async function req(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

const signup = async (name) => {
  const u = { email: `nick-${name}${stamp}@t.dev`, password: 'pw123456', name };
  const res = await req('/auth/signup', { method: 'POST', body: u });
  return { ...u, token: res.data.accessToken, id: res.data.user.id };
};

const pairUp = async (a, b) => {
  const invite = await req('/auth/invite', { method: 'POST', token: a.token, body: { deviceTimezone: 'Europe/London' } });
  return req('/auth/invite/accept', {
    method: 'POST', token: b.token,
    body: { inviteCode: invite.data.inviteCode, deviceTimezone: 'Europe/London' },
  });
};

const A = await signup('Ada');
const B = await signup('Bo');

console.log('=== UNPAIRED ===');
const solo = await req('/profile', { token: A.token });
check('profile works before pairing', solo.status === 200 && solo.data.paired === false, solo.data);
check('own name is returned', solo.data.me.name === 'Ada' && solo.data.me.displayName === 'Ada', solo.data.me);
check('partner is null', solo.data.partner === null);
check('setting a nickname unpaired is refused', (await req('/profile/nickname', { method: 'PUT', token: A.token, body: { nickname: 'x' } })).status === 403);
check('profile requires auth', (await req('/profile')).status === 401);

await pairUp(A, B);

console.log('\n=== BEFORE ANY NICKNAME ===');
const fresh = await req('/profile', { token: A.token });
check('paired is true', fresh.data.paired === true);
check('partner real name is visible', fresh.data.partner.name === 'Bo', fresh.data.partner);
check('displayName falls back to the real name', fresh.data.partner.displayName === 'Bo');
check('nickname is null until one is set', fresh.data.partner.nickname === null && fresh.data.me.nickname === null);

console.log('\n=== SETTING ONE ===');
const set = await req('/profile/nickname', { method: 'PUT', token: A.token, body: { nickname: '  Bear  ' } });
check('nickname accepted', set.status === 200, set.data);
check('whitespace is trimmed', set.data.nickname === 'Bear', set.data);

const aSees = await req('/profile', { token: A.token });
check("the setter sees it on their partner", aSees.data.partner.nickname === 'Bear' && aSees.data.partner.displayName === 'Bear', aSees.data.partner);
check('the setter has no nickname of their own yet', aSees.data.me.nickname === null);

const bSees = await req('/profile', { token: B.token });
check('the receiver sees what they are called', bSees.data.me.nickname === 'Bear' && bSees.data.me.displayName === 'Bear', bSees.data.me);
check("the receiver's view of their partner is untouched", bSees.data.partner.nickname === null && bSees.data.partner.displayName === 'Ada', bSees.data.partner);

console.log('\n=== BOTH DIRECTIONS ARE INDEPENDENT ===');
await req('/profile/nickname', { method: 'PUT', token: B.token, body: { nickname: 'Sunshine' } });
const a2 = await req('/profile', { token: A.token });
const b2 = await req('/profile', { token: B.token });
check('A calls B "Bear"', a2.data.partner.displayName === 'Bear');
check('A is called "Sunshine"', a2.data.me.displayName === 'Sunshine');
check('B calls A "Sunshine"', b2.data.partner.displayName === 'Sunshine');
check('B is called "Bear"', b2.data.me.displayName === 'Bear');

console.log('\n=== UPDATING AND CLEARING ===');
await req('/profile/nickname', { method: 'PUT', token: A.token, body: { nickname: 'Bear Cub' } });
check('updating replaces rather than duplicating', (await req('/profile', { token: A.token })).data.partner.nickname === 'Bear Cub');
check('clearing returns 204', (await req('/profile/nickname', { method: 'DELETE', token: A.token })).status === 204);
const cleared = await req('/profile', { token: A.token });
check('cleared nickname falls back to the real name', cleared.data.partner.nickname === null && cleared.data.partner.displayName === 'Bo', cleared.data.partner);
check("clearing mine did not clear theirs", cleared.data.me.displayName === 'Sunshine');
check('clearing twice is harmless', (await req('/profile/nickname', { method: 'DELETE', token: A.token })).status === 204);

console.log('\n=== VALIDATION ===');
const bad = async (body) => (await req('/profile/nickname', { method: 'PUT', token: A.token, body })).status;
check('empty string rejected', await bad({ nickname: '' }) === 400);
check('whitespace-only rejected', await bad({ nickname: '   ' }) === 400);
check('non-string rejected', await bad({ nickname: 42 }) === 400);
check('missing field rejected', await bad({}) === 400);
check('over-long rejected', await bad({ nickname: 'x'.repeat(31) }) === 400);
check('exactly 30 accepted', (await req('/profile/nickname', { method: 'PUT', token: A.token, body: { nickname: 'x'.repeat(30) } })).status === 200);
check('newline rejected', await bad({ nickname: 'Bear\nCub' }) === 400);
check('emoji counted by code point, not byte', (await req('/profile/nickname', { method: 'PUT', token: A.token, body: { nickname: '🐻'.repeat(30) } })).status === 200);

console.log('\n=== SPEC #6: A NICKNAME CANNOT OUTLIVE ITS PAIRING ===');
await req('/profile/nickname', { method: 'PUT', token: A.token, body: { nickname: 'Bear' } });
await req('/auth/unlink', { method: 'POST', token: A.token });
const afterUnlink = await req('/profile', { token: A.token });
check('unlinking drops the pairing', afterUnlink.data.paired === false, afterUnlink.data);
check('and the partner with it', afterUnlink.data.partner === null);

const C = await signup('Cass');
await pairUp(A, C);
const rePaired = await req('/profile', { token: A.token });
check('re-pairing starts from a blank nickname', rePaired.data.partner.nickname === null, rePaired.data.partner);
check('the new partner shows their real name', rePaired.data.partner.displayName === 'Cass', rePaired.data.partner);
check('and no nickname from the old pairing leaks back', rePaired.data.me.nickname === null, rePaired.data.me);

console.log('\n=== CHAT WALLPAPER IS A PERSONAL PREFERENCE ===');
// A fresh pairing: the section above deliberately unlinks A and B, so there
// would be no partner left to check the personal-vs-shared boundary against.
const W1 = await signup('Wren');
const W2 = await signup('Wynn');
const wInvite = await req('/auth/invite', { method: 'POST', token: W1.token, body: { deviceTimezone: 'UTC' } });
await req('/auth/invite/accept', { method: 'POST', token: W2.token, body: { inviteCode: wInvite.data.inviteCode, deviceTimezone: 'UTC' } });
// Personal, not pair-shared: the two of you having different taste in
// backgrounds is not a conflict, and it must not behave like one.
const setPaper = (token, value) =>
  req('/profile/preferences', { method: 'PATCH', token, body: { chatWallpaper: value } });

check('a built-in id is accepted', (await setPaper(W1.token, 'blush')).status === 200);
check('and read back on the profile',
  (await req('/profile', { token: W1.token })).data.me.chatWallpaper === 'blush');
check("it does NOT change the partner's",
  (await req('/profile', { token: W2.token })).data.me.chatWallpaper !== 'blush',
  (await req('/profile', { token: W2.token })).data.me.chatWallpaper);
check("and your wallpaper is not in your partner's view of you",
  (await req('/profile', { token: W2.token })).data.partner.chatWallpaper === null,
  (await req('/profile', { token: W2.token })).data.partner);

await setPaper(W2.token, 'ink');
check('each keeps their own',
  (await req('/profile', { token: W1.token })).data.me.chatWallpaper === 'blush'
  && (await req('/profile', { token: W2.token })).data.me.chatWallpaper === 'ink');

check('one of their own photos is accepted',
  (await setPaper(W1.token, 'photo:memories/abc/123.jpg')).status === 200);
check('and comes back intact',
  (await req('/profile', { token: W1.token })).data.me.chatWallpaper === 'photo:memories/abc/123.jpg');

check('null clears it', (await setPaper(W1.token, null)).status === 200);
check('and it reads back as nothing',
  (await req('/profile', { token: W1.token })).data.me.chatWallpaper === null,
  (await req('/profile', { token: W1.token })).data.me.chatWallpaper);

console.log('\n=== AND IT CANNOT BE POINTED SOMEWHERE ELSE ===');
// The photo form carries a storage key. If that were taken on trust it
// would become a way to make the app load an arbitrary address.
check('an http URL is refused',
  (await setPaper(W1.token, 'photo:http://evil.example/x.jpg')).status === 400);
check('a protocol-relative URL is refused',
  (await setPaper(W1.token, 'photo://evil.example/x.jpg')).status === 400);
check('a traversal attempt is refused',
  (await setPaper(W1.token, 'photo:../../etc/passwd')).status === 400);
check('an empty photo key is refused', (await setPaper(W1.token, 'photo:')).status === 400);
check('a junk id is refused', (await setPaper(W1.token, 'DROP TABLE users')).status === 400);
check('an absurdly long value is refused',
  (await setPaper(W1.token, `photo:${'x'.repeat(400)}`)).status === 400);
check('a non-string is refused', (await setPaper(W1.token, 42)).status === 400);
check('a rejected value leaves the old one alone',
  (await req('/profile', { token: W1.token })).data.me.chatWallpaper === null);

check('setting the theme still works alongside it',
  (await req('/profile/preferences', { method: 'PATCH', token: W1.token,
    body: { themePreference: 'dark', chatWallpaper: 'mint' } })).status === 200);
const both = await req('/profile', { token: W1.token });
check('and both land', both.data.me.themePreference === 'dark' && both.data.me.chatWallpaper === 'mint',
  both.data.me);

console.log(`\nNICKNAME RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
