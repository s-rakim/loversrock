// The security audit's fixes, proved against a live backend (npm start) and
// its database: photos only for your own pair, sessions that can be ended,
// limits on guessing, longer invite codes, sign-ups that close once a couple
// is paired, a server that will not start on example secrets, passes into
// the call server, and Fable connections that cannot point at the PC's own
// services.
import 'dotenv/config';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { io as ioClient } from 'socket.io-client';
import { query, pool } from '../src/config/db.js';

const API = process.env.API_URL || 'http://localhost:4000';
const stamp = Date.now();
let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${JSON.stringify(d)?.slice(0, 300)}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(path, { method = 'GET', body, token, base = API } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data, headers: res.headers };
}
const signup = async (name, password = 'pw-long-enough') => {
  const u = { email: `sec-${name}${stamp}@t.dev`, password, name };
  const r = await req('/auth/signup', { method: 'POST', body: u });
  return { ...u, token: r.data?.accessToken, refresh: r.data?.refreshToken, media: r.data?.mediaToken, id: r.data?.user?.id, status: r.status, error: r.data?.error };
};
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

console.log('=== PASSWORDS ===');
const short = await signup('Short', 'abc');
check('a password under 8 characters is refused at sign-up', short.status === 400 && /at least 8/.test(short.error), short);

const A = await signup('Ana');
const B = await signup('Ben');
const C = await signup('Cal');
check('sign-up hands out a photo-only token alongside the others', Boolean(A.media) && A.media !== A.token, A.media?.slice(0, 12));

console.log('\n=== INVITE CODES ===');
const invite = await req('/auth/invite', { method: 'POST', token: A.token, body: { deviceTimezone: 'UTC' } });
check('ten characters, shown in two fives', /^[A-HJ-KM-NP-Z2-9]{5}-[A-HJ-KM-NP-Z2-9]{5}$/.test(invite.data.inviteCode), invite.data);
check('good for a day, not a week', Math.round((new Date(invite.data.expiresAt) - Date.now()) / 3600000) === 24);
let limited = null;
for (let i = 0; i < 12; i++) {
  const r = await req('/auth/invite/accept', { method: 'POST', token: C.token, body: { inviteCode: `ZZZZZ-ZZZ${String(i).padStart(2, '2')}` } });
  if (r.status === 429) { limited = { i, r }; break; }
}
check('guessing codes is stopped after 10 wrong ones', limited?.i === 10 && /wrong invite codes/.test(limited.r.data.error) && Number(limited.r.headers.get('retry-after')) > 0, limited?.i);
const typed = invite.data.inviteCode.replace('-', ' ').toLowerCase();
const accepted = await req('/auth/invite/accept', { method: 'POST', token: B.token, body: { inviteCode: typed } });
check('the code works typed in lower case, with a space for the dash', accepted.status === 200, accepted.data);
const pairId = accepted.data?.pair?.id;

console.log('\n=== PHOTOS: YOUR OWN PAIR ONLY ===');
const mem = await req('/memories', { method: 'POST', token: A.token, body: { image: PNG, caption: 'ours' } });
const key = mem.data?.memory?.image_url;
check('a real picture uploads', mem.status === 201 && /^memories\//.test(key), mem.data);
const fake = await req('/memories', { method: 'POST', token: A.token, body: { image: `data:image/png;base64,${Buffer.from('<html><script>alert(1)</script></html>').toString('base64')}` } });
check('a file that only claims to be a picture is refused', fake.status === 400, fake.data);
const viaMt = await fetch(`${API}/media/${key}?mt=${encodeURIComponent(B.media)}`);
check('your partner opens it with the photo-only token', viaMt.status === 200 && /^image\/png/.test(viaMt.headers.get('content-type')), viaMt.status);
check('  served with nosniff', viaMt.headers.get('x-content-type-options') === 'nosniff');
const stranger = await fetch(`${API}/media/${key}?token=${encodeURIComponent(C.token)}`);
check('a signed-in stranger gets nothing (it was an image before)', stranger.status === 404, stranger.status);
const strangerHeader = await fetch(`${API}/media/${key}`, { headers: { Authorization: `Bearer ${C.token}` } });
check('  with the token in the header too', strangerHeader.status === 404, strangerHeader.status);
const mtAsLogin = await req('/profile', { token: B.media });
check('the photo-only token opens no API', mtAsLogin.status === 401, mtAsLogin.status);
const traversal = await fetch(`${API}/media/memories/${pairId}/../../etc/passwd?mt=${encodeURIComponent(B.media)}`);
check('a key with ../ in it is refused', traversal.status === 404 || traversal.status === 400, traversal.status);

console.log('\n=== THE CALL SERVER: A PASS PER ROOM ===');
const { rows: [callRow] } = await query(
  `INSERT INTO call_sessions (pair_id, caller_id, callee_id, kind, status) VALUES ($1, $2, $3, 'voice', 'ended') RETURNING id`,
  [pairId, A.id, B.id]
);
const sfu = await req(`/calls/sfu-pass?room=call-${callRow.id}`, { token: B.token });
const [expiry, sig] = String(sfu.data?.pass || '').split('.');
const want = process.env.CALLS_SECRET
  ? crypto.createHmac('sha256', process.env.CALLS_SECRET).update(`join:call-${callRow.id}:${expiry}`).digest('base64url') : null;
check('a pass for your own call, signed for that room', sfu.status === 200 && (process.env.CALLS_SECRET ? sig === want : sfu.data.pass === null), sfu.data);
check('none for a call that is not yours', (await req(`/calls/sfu-pass?room=call-${crypto.randomUUID()}`, { token: B.token })).status === 404);
check('none for a room that is not a call or a self-test', (await req('/calls/sfu-pass?room=anything', { token: B.token })).status === 400);
check('a Diagnostics self-test room gets one', (await req('/calls/sfu-pass?room=selftest-r123', { token: B.token })).status === 200);

console.log('\n=== FABLE CANNOT BE AIMED AT THE PC ITSELF ===');
const aimed = await req('/fable/connections/Sneaky', { method: 'PUT', token: A.token, body: { baseURL: 'http://postgres:5432/v1' } });
check('a connection to the database is refused', aimed.status === 400 && /own services/.test(aimed.data.error), aimed.data);
const aimedPort = await req('/fable/connections/Sneaky', { method: 'PUT', token: A.token, body: { baseURL: 'http://host.docker.internal:9000/v1' } });
check('  or to photo storage by port', aimedPort.status === 400, aimedPort.data);
const ollama = await req('/fable/connections/Ollama', { method: 'PUT', token: A.token, body: { baseURL: 'http://host.docker.internal:11434/v1' } });
check('  while Ollama on the PC is fine', ollama.status === 200, ollama.data);

console.log('\n=== SESSIONS THAT CAN BE ENDED ===');
const login = await req('/auth/login', { method: 'POST', body: { email: A.email, password: A.password } });
const r1 = login.data.refreshToken;
const rot = await req('/auth/refresh', { method: 'POST', body: { refreshToken: r1 } });
check('a refresh hands out a new set', rot.status === 200 && rot.data.refreshToken !== r1 && rot.data.mediaToken, rot.status);
const again = await req('/auth/refresh', { method: 'POST', body: { refreshToken: r1 } });
check('the replaced one still works for a minute (two screens refreshing at once)', again.status === 200, again.status);
await query("UPDATE refresh_tokens SET rotated_at = now() - interval '5 minutes' WHERE user_id = $1 AND rotated_at IS NOT NULL", [A.id]);
const stale = await req('/auth/refresh', { method: 'POST', body: { refreshToken: r1 } });
check('after that, a replaced one is refused', stale.status === 401, stale);
const r2 = rot.data.refreshToken;
await req('/auth/logout', { method: 'POST', body: { refreshToken: r2 } });
check('logging out ends that sign-in on the server', (await req('/auth/refresh', { method: 'POST', body: { refreshToken: r2 } })).status === 401);

const other = await req('/auth/login', { method: 'POST', body: { email: A.email, password: A.password } });
await sleep(1100); // a password change ends tokens issued before that second
check('a new password under 8 characters is refused', (await req('/auth/password', { method: 'POST', token: A.token, body: { currentPassword: A.password, newPassword: 'short' } })).status === 400);
check('the current password has to be right', (await req('/auth/password', { method: 'POST', token: A.token, body: { currentPassword: 'nope-nope-nope', newPassword: 'a-new-password-1' } })).status === 401);
const changed = await req('/auth/password', { method: 'POST', token: A.token, body: { currentPassword: A.password, newPassword: 'a-new-password-1' } });
check('changing it works, and this phone gets fresh tokens', changed.status === 200 && changed.data.accessToken, changed.status);
check('  every other sign-in is ended: its refresh token', (await req('/auth/refresh', { method: 'POST', body: { refreshToken: other.data.refreshToken } })).status === 401);
check('  and its access token, at once', (await req('/profile', { token: other.data.accessToken })).status === 401);
check('  and its photo token', (await fetch(`${API}/media/${key}?mt=${encodeURIComponent(A.media)}`)).status === 401);
check('  while the fresh ones work', (await req('/profile', { token: changed.data.accessToken })).status === 200);
check('  and the old password no longer signs in', (await req('/auth/login', { method: 'POST', body: { email: A.email, password: A.password } })).status === 401);
const A2 = { ...A, token: changed.data.accessToken, password: 'a-new-password-1' };

console.log('\n=== GUESSING PASSWORDS ===');
let lockedAt = null;
for (let i = 0; i < 10; i++) {
  const r = await req('/auth/login', { method: 'POST', body: { email: C.email, password: `wrong-${i}` } });
  if (r.status === 429) { lockedAt = i; break; }
}
check('8 wrong passwords, then the account is held for a while', lockedAt === 8, lockedAt);
const evenRight = await req('/auth/login', { method: 'POST', body: { email: C.email, password: C.password } });
check('  even the right one waits it out', evenRight.status === 429 && /wrong passwords/.test(evenRight.data.error), evenRight.status);
const ghost = await req('/auth/login', { method: 'POST', body: { email: `nobody-${stamp}@t.dev`, password: 'whatever-1' } });
check('a wrong email and a wrong password look the same', ghost.status === 401 && ghost.data.error === 'Invalid credentials');

console.log('\n=== UNLINKING CUTS THE LIVE CONNECTION ===');
const sock = ioClient(API, { auth: { token: B.token }, transports: ['websocket'], reconnection: false });
const connected = await new Promise((r) => { sock.on('connect', () => r(true)); sock.on('connect_error', () => r(false)); setTimeout(() => r(false), 4000); });
check('your partner is connected', connected);
const dropped = new Promise((r) => { sock.on('disconnect', (why) => r(why)); setTimeout(() => r(null), 4000); });
const told = new Promise((r) => { sock.on('pair:unlinked', () => r(true)); setTimeout(() => r(false), 4000); });
check('unlinking works', (await req('/auth/unlink', { method: 'POST', token: A2.token })).status === 204);
check('  their phone is told', await told);
check('  and dropped at once, not at its next reconnect', Boolean(await dropped));
sock.close();
const afterUnlink = await fetch(`${API}/media/${key}?mt=${encodeURIComponent(B.media)}`);
check('  and the old pair\'s photos no longer open for them', afterUnlink.status === 404, afterUnlink.status);

console.log('\n=== SIGN-UPS CLOSE ONCE A COUPLE IS PAIRED ===');
// A second backend, with SIGNUPS=auto (the default), against the same
// database, where other pairs exist.
const port = 4000 + 100 + Math.floor(Math.random() * 800);
const other2 = spawn(process.execPath, ['src/server.js'], { env: { ...process.env, PORT: String(port), SIGNUPS: 'auto' }, stdio: 'ignore' });
let up = false;
for (let i = 0; i < 40 && !up; i++) { await sleep(250); up = await fetch(`http://localhost:${port}/health`).then((r) => r.ok, () => false); }
const closed = await req('/auth/signup', { method: 'POST', base: `http://localhost:${port}`, body: { email: `late-${stamp}@t.dev`, password: 'pw-long-enough', name: 'Late' } });
check('a new account is refused, with the reason', closed.status === 403 && /already paired/.test(closed.data.error), closed.data);
other2.kill();

console.log('\n=== NO STARTING ON EXAMPLE SECRETS ===');
const refused = await new Promise((resolve) => {
  let out = '';
  const p = spawn(process.execPath, ['src/server.js'], {
    env: { ...process.env, PORT: String(port + 1), JWT_ACCESS_SECRET: 'change-me-access-secret' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { out += d; });
  p.on('exit', (code) => resolve({ code, out }));
  setTimeout(() => { p.kill(); resolve({ code: 'still running', out }); }, 8000);
});
check('the server refuses to start, and names the secret', refused.code === 1 && /JWT_ACCESS_SECRET is still the example placeholder/.test(refused.out), refused);
check('  and says how to fix it', /node docker\/secure-setup\.mjs/.test(refused.out));

await query('DELETE FROM users WHERE id = ANY($1)', [[A.id, B.id, C.id].filter(Boolean)]);
await pool.end();
console.log(`\nSECURITY RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
fails.forEach((f) => console.log(`  - ${f}`));
process.exit(fails.length ? 1 : 0);
