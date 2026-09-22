// The server's half of end-to-end encryption: publishing public keys, and
// storing ciphertext it cannot read.
//
// The point of these assertions is not that encryption "works" — that is
// mobile/test/crypto.mjs, against the real primitives. The point is that the
// SERVER never ends up holding plaintext, and cannot be talked into handing
// someone a key that is not their partner's.
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
  const u = { email: `e2ee-${n}${stamp}@t.dev`, password: 'pw123456', name: n };
  const r = await req('/auth/signup', { method: 'POST', body: u });
  return { ...u, token: r.data.accessToken, id: r.data.user.id };
};

// Two real 32-byte Curve25519-shaped public keys, base64.
const keyOf = (seed) => Buffer.from(Array.from({ length: 32 }, (_, i) => (seed * 31 + i * 7) % 256)).toString('base64');
const ANA_KEY = keyOf(3);
const BEN_KEY = keyOf(11);

const A = await signup('Ana');
const B = await signup('Ben');
const C = await signup('Cal');
const invite = await req('/auth/invite', { method: 'POST', token: A.token, body: { deviceTimezone: 'UTC' } });
await req('/auth/invite/accept', { method: 'POST', token: B.token, body: { inviteCode: invite.data.inviteCode, deviceTimezone: 'UTC' } });

console.log('=== PUBLISHING A PUBLIC KEY ===');
const published = await req('/profile/keys', { method: 'PUT', token: A.token, body: { publicKey: ANA_KEY } });
check('a valid key is accepted', published.status === 200, published.data);
check('and echoed back', published.data.publicKey === ANA_KEY);
await req('/profile/keys', { method: 'PUT', token: B.token, body: { publicKey: BEN_KEY } });

check('junk is refused', (await req('/profile/keys', { method: 'PUT', token: A.token, body: { publicKey: 'nope' } })).status === 400);
check('so is an empty key', (await req('/profile/keys', { method: 'PUT', token: A.token, body: {} })).status === 400);
check('and one of the wrong length',
  (await req('/profile/keys', { method: 'PUT', token: A.token, body: { publicKey: Buffer.alloc(16).toString('base64') } })).status === 400);
check('a rejected key does not overwrite the good one',
  (await req('/profile', { token: A.token })).data.me.publicKey === ANA_KEY);

console.log('\n=== EACH PARTNER GETS THE OTHER’S KEY ===');
const anaView = await req('/profile', { token: A.token });
check('Ana sees her own key', anaView.data.me.publicKey === ANA_KEY, anaView.data.me.publicKey);
check("and Ben's", anaView.data.partner.publicKey === BEN_KEY, anaView.data.partner.publicKey);
const benView = await req('/profile', { token: B.token });
check('and the same holds in reverse',
  benView.data.me.publicKey === BEN_KEY && benView.data.partner.publicKey === ANA_KEY);

console.log('\n=== A KEY CAN ONLY BE PUBLISHED FOR YOURSELF ===');
// The user id comes from the token, never the body — otherwise anyone could
// publish a key as their target and read their mail.
await req('/profile/keys', { method: 'PUT', token: C.token, body: { publicKey: keyOf(77), userId: A.id } });
check("a stranger cannot overwrite someone else's key",
  (await req('/profile', { token: A.token })).data.me.publicKey === ANA_KEY);
check('and their own key does not leak into this pair',
  (await req('/profile', { token: A.token })).data.partner.publicKey === BEN_KEY);

console.log('\n=== THE SERVER STORES CIPHERTEXT AND KNOWS IT ===');
const CIPHER = 'e2ee:v1:d2hhdGV2ZXJ0aGlzaXNpdGlzbm90cmVhZGFibGU=';
const sent = await req('/messages', {
  method: 'POST', token: A.token, body: { type: 'text', content: CIPHER, encrypted: true },
});
check('an encrypted message is accepted', sent.status === 201, sent.data);
check('and flagged as encrypted', sent.data.message.encrypted === true, sent.data.message.encrypted);

const { rows } = await query('SELECT content, encrypted FROM messages WHERE id = $1', [sent.data.message.id]);
check('the database row holds the ciphertext verbatim', rows[0].content === CIPHER, rows[0].content);
check('and nothing resembling plaintext', !/whatever|readable/i.test(rows[0].content));
check('the flag is persisted, not inferred', rows[0].encrypted === true);

console.log('\n=== OLD PLAINTEXT MESSAGES ARE STILL ALLOWED ===');
// Every message sent before this existed is plaintext, and a pair that has
// not exchanged keys yet still has to be able to talk.
const plain = await req('/messages', { method: 'POST', token: A.token, body: { type: 'text', content: 'hello in the clear' } });
check('an unencrypted message still sends', plain.status === 201, plain.data);
check('and is marked as not encrypted', plain.data.message.encrypted === false, plain.data.message.encrypted);

const thread = await req('/messages', { token: B.token });
const both = thread.data.messages.filter((m) => [sent.data.message.id, plain.data.message.id].includes(m.id));
check('both kinds come back in one thread', both.length === 2, both.length);
check('each carrying its own flag',
  both.find((m) => m.id === sent.data.message.id).encrypted === true
  && both.find((m) => m.id === plain.data.message.id).encrypted === false);

console.log('\n=== AN ENCRYPTED DOODLE NEEDS NO STROKE COLUMN ===');
// Sealed strokes travel in `content`; stroke_data stays null because the
// server has nothing it could put there.
const doodle = await req('/messages', {
  method: 'POST', token: A.token, body: { type: 'doodle', content: CIPHER, encrypted: true },
});
check('it is accepted without strokeData', doodle.status === 201, doodle.data);
check('and stroke_data is left empty', doodle.data.message.stroke_data === null, doodle.data.message.stroke_data);
check('an unencrypted doodle still requires strokes',
  (await req('/messages', { method: 'POST', token: A.token, body: { type: 'doodle' } })).status === 400);

console.log('\n=== A STRANGER SEES NONE OF IT ===');
check('outside the pair, the thread is closed', (await req('/messages', { token: C.token })).status === 403);
const cView = await req('/profile', { token: C.token });
check('and they get no partner key at all', !cView.data.partner, cView.data.partner);

console.log(`\nE2EE SERVER RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
process.exit(0);
