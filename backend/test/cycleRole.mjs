// Which side of the cycle tracker somebody is on, end to end.
//
// The app showed everyone the same cycle screens and let the server sort it
// out, which meant the person tracking their own cycle could land on the
// partner's read-only view and find nothing they could change. There is
// nothing in an account that reliably says which side somebody is on, so it
// is asked at sign-up and stored.
//
// This is a privacy boundary, not a display preference, which is why the
// checks below care about the CHECK constraint and about null: an account
// with no role must stay null so the app asks, rather than being defaulted
// into 'owner' and quietly handed someone else's health data.
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
const mail = (who) => `role-${who}-${stamp}@example.com`;

section('SIGN-UP CARRIES THE CHOICE');

const owner = await req('/auth/signup', {
  method: 'POST',
  body: { name: 'Owner', email: mail('owner'), password: 'password123', cycleRole: 'owner' },
});
check('an owner can sign up', owner.status === 201, owner.data);
check('and the reply says so', owner.data?.user?.cycleRole === 'owner', owner.data?.user);
check('in camelCase, not the column name',
  owner.data?.user && !('cycle_role' in owner.data.user), Object.keys(owner.data?.user || {}));

const partner = await req('/auth/signup', {
  method: 'POST',
  body: { name: 'Partner', email: mail('partner'), password: 'password123', cycleRole: 'partner' },
});
check('a partner can sign up', partner.status === 201, partner.data);
check('and the reply says so', partner.data?.user?.cycleRole === 'partner', partner.data?.user);

const undecided = await req('/auth/signup', {
  method: 'POST',
  body: { name: 'Undecided', email: mail('undecided'), password: 'password123' },
});
check('signing up without choosing still works', undecided.status === 201, undecided.data);
// This is the important one. A default would have silently made every
// existing account an owner, which is the wrong way to fail on health data.
check('and leaves the role null rather than guessing',
  undecided.data?.user?.cycleRole === null, undecided.data?.user);

const junk = await req('/auth/signup', {
  method: 'POST',
  body: { name: 'Junk', email: mail('junk'), password: 'password123', cycleRole: 'admin' },
});
check('an unknown role is refused', junk.status === 400, junk.data);

section('AND SURVIVES A LOGIN');

const back = await req('/auth/login', {
  method: 'POST',
  body: { email: mail('owner'), password: 'password123' },
});
check('logging back in returns the stored role',
  back.data?.user?.cycleRole === 'owner', back.data?.user);

const token = back.data.accessToken;
const undecidedToken = undecided.data.accessToken;

section('THE PROFILE CARRIES IT TOO');

const profile = await req('/profile', { token });
check('/profile reports the role', profile.data?.me?.cycleRole === 'owner', profile.data?.me);

const blank = await req('/profile', { token: undecidedToken });
check('and reports null for somebody who has not chosen',
  blank.data?.me?.cycleRole === null, blank.data?.me);

section('AND IT CAN BE CHANGED LATER');

const swap = await req('/profile/preferences', {
  method: 'PATCH', token: undecidedToken, body: { cycleRole: 'partner' },
});
check('choosing later is accepted', swap.status === 200, swap.data);
const after = await req('/profile', { token: undecidedToken });
check('and sticks', after.data?.me?.cycleRole === 'partner', after.data?.me);

const swapBack = await req('/profile/preferences', {
  method: 'PATCH', token: undecidedToken, body: { cycleRole: 'owner' },
});
check('switching sides is allowed', swapBack.status === 200, swapBack.data);
const afterSwap = await req('/profile', { token: undecidedToken });
check('and takes effect', afterSwap.data?.me?.cycleRole === 'owner', afterSwap.data?.me);

// "Switch mode" needs to be able to put somebody back to undecided, so the
// app asks again rather than keeping a stale answer.
const cleared = await req('/profile/preferences', {
  method: 'PATCH', token: undecidedToken, body: { cycleRole: null },
});
check('and it can be cleared, so the app asks again', cleared.status === 200, cleared.data);
const afterClear = await req('/profile', { token: undecidedToken });
check('which leaves it null', afterClear.data?.me?.cycleRole === null, afterClear.data?.me);

const badPatch = await req('/profile/preferences', {
  method: 'PATCH', token, body: { cycleRole: 'nonsense' },
});
check('an unknown role is refused here too', badPatch.status === 400, badPatch.data);

// A PATCH that does not mention the role must not wipe it: the theme and the
// wallpaper go through this same endpoint.
const themeOnly = await req('/profile/preferences', {
  method: 'PATCH', token, body: { themePreference: 'dark' },
});
check('changing an unrelated preference is accepted', themeOnly.status === 200, themeOnly.data);
const stillOwner = await req('/profile', { token });
check('and does not clear the role', stillOwner.data?.me?.cycleRole === 'owner', stillOwner.data?.me);

console.log(`\nCYCLE ROLE RESULT — PASSED: ${pass}  FAILED: ${failures.length}`);
if (failures.length) { console.log(failures.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
