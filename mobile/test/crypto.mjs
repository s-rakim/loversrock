// The encryption itself, exercised rather than assumed.
//
// This is the one part of the app where "it looks right" is worth nothing.
// A bug here does not throw or render oddly — it produces something that
// still moves through the system while providing none of what it claims.
// So: real keys, real ciphertext, and checks that the failures fail.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const babel = require('@babel/core');
const nodeCrypto = require('node:crypto');

let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${d ?? ''}`); } };

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

/** Loads services/crypto.js with the two native modules stubbed. */
function loadCrypto(store) {
  const file = path.join(root, 'services', 'crypto.js');
  const { code } = babel.transformSync(fs.readFileSync(file, 'utf8'), {
    filename: file,
    presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
    babelrc: false, configFile: false,
  });

  const stubs = {
    'expo-secure-store': {
      getItemAsync: async (k) => (k in store ? store[k] : null),
      setItemAsync: async (k, v) => { store[k] = v; },
      deleteItemAsync: async (k) => { delete store[k]; },
    },
    // The real thing is the platform CSPRNG; node's is the same guarantee.
    'expo-crypto': {
      getRandomBytes: (n) => new Uint8Array(nodeCrypto.randomBytes(n)),
      CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
      digestStringAsync: async (_alg, value) =>
        nodeCrypto.createHash('sha256').update(value).digest('hex'),
    },
  };

  const module_ = { exports: {} };
  const fakeRequire = (id) => stubs[id] || require(id);
  new Function('module', 'exports', 'require', code)(module_, module_.exports, fakeRequire);
  return module_.exports;
}

const anaStore = {};
const benStore = {};
const ana = loadCrypto(anaStore);
const ben = loadCrypto(benStore);

console.log('=== KEYS ARE GENERATED ONCE AND KEPT IN THE KEYCHAIN ===');
const anaKeys = await ana.getKeyPair();
check('a keypair is created', anaKeys.publicKeyBase64?.length > 0, anaKeys.publicKeyBase64);
check('the private key is stored', Boolean(anaStore.loversrock_e2ee_secret_key));
check('and it is NOT the public key', anaStore.loversrock_e2ee_secret_key !== anaStore.loversrock_e2ee_public_key);
const again = await ana.getKeyPair();
check('asking twice returns the same key, not a new one',
  again.publicKeyBase64 === anaKeys.publicKeyBase64);

const benKeys = await ben.getKeyPair();
check('the two devices have different keys', benKeys.publicKeyBase64 !== anaKeys.publicKeyBase64);

console.log('\n=== A MESSAGE SURVIVES THE ROUND TRIP ===');
const secret = 'meet me at the usual place at 8 ❤️';
const sealed = await ana.encryptFor(benKeys.publicKeyBase64, secret);
check('it is marked as encrypted', ana.isEncrypted(sealed), sealed.slice(0, 20));
check('the plaintext is nowhere in the ciphertext', !sealed.includes('usual place'), sealed);
check('nor is any recognisable word of it', !/meet|place/i.test(sealed));

const opened = await ben.decryptFrom(anaKeys.publicKeyBase64, sealed);
check('the partner can read it', opened === secret, opened);
check('including the emoji, so UTF-8 survives', opened.endsWith('❤️'));

console.log('\n=== AND THE SENDER CAN STILL READ THEIR OWN ===');
// box is symmetric across the pair, which is what lets a sent message stay
// readable without keeping a plaintext copy anywhere.
const ownedBySender = await ana.decryptFrom(benKeys.publicKeyBase64, sealed);
check('their own sent message opens on their own device', ownedBySender === secret, ownedBySender);

console.log('\n=== NOBODY ELSE CAN ===');
const evesStore = {};
const eve = loadCrypto(evesStore);
const eveKeys = await eve.getKeyPair();
const byEve = await eve.decryptFrom(anaKeys.publicKeyBase64, sealed);
check('a third party with their own keys gets nothing', byEve === null, byEve);
// The server has every public key — that is the point of publishing them.
const withPublicKeysOnly = await eve.decryptFrom(benKeys.publicKeyBase64, sealed);
check('knowing both public keys is not enough', withPublicKeysOnly === null, withPublicKeysOnly);

console.log('\n=== TAMPERING IS DETECTED, NOT DECRYPTED ===');
// Poly1305 is what makes this true: a modified ciphertext fails to open
// rather than opening as something the modifier chose.
const body = sealed.slice(ana.CIPHER_PREFIX.length);
const bytes = Buffer.from(body, 'base64');
bytes[bytes.length - 3] ^= 0x01;         // one bit, deep in the ciphertext
const tampered = `${ana.CIPHER_PREFIX}${bytes.toString('base64')}`;
check('a single flipped bit makes it unreadable',
  (await ben.decryptFrom(anaKeys.publicKeyBase64, tampered)) === null);

const nonceBytes = Buffer.from(body, 'base64');
nonceBytes[2] ^= 0x01;                   // and one in the nonce
check('so does touching the nonce',
  (await ben.decryptFrom(anaKeys.publicKeyBase64, `${ana.CIPHER_PREFIX}${nonceBytes.toString('base64')}`)) === null);
check('and truncating it',
  (await ben.decryptFrom(anaKeys.publicKeyBase64, `${ana.CIPHER_PREFIX}${body.slice(0, 20)}`)) === null);

console.log('\n=== NONCES ARE NEVER REUSED ===');
// A repeated nonce under the same key is the classic way a scheme like this
// is broken while still appearing to work.
const seen = new Set();
for (let i = 0; i < 200; i += 1) {
  const c = await ana.encryptFor(benKeys.publicKeyBase64, 'same message every time');
  seen.add(Buffer.from(c.slice(ana.CIPHER_PREFIX.length), 'base64').subarray(0, 24).toString('hex'));
}
check('200 encryptions produced 200 distinct nonces', seen.size === 200, seen.size);
const a1 = await ana.encryptFor(benKeys.publicKeyBase64, 'identical');
const a2 = await ana.encryptFor(benKeys.publicKeyBase64, 'identical');
check('so the same plaintext never produces the same ciphertext', a1 !== a2);

console.log('\n=== OLD PLAINTEXT MESSAGES STILL RENDER ===');
// Every message sent before this existed is sitting in the database as
// plain text. They have to keep working.
check('an unencrypted message passes straight through',
  (await ben.decryptFrom(anaKeys.publicKeyBase64, 'hello from before')) === 'hello from before');
check('and is not claimed to be encrypted', ana.isEncrypted('hello from before') === false);
check('null and undefined do not throw',
  (await ben.decryptFrom(anaKeys.publicKeyBase64, null)) === null
  && (await ben.decryptFrom(anaKeys.publicKeyBase64, undefined)) === undefined);

console.log('\n=== THE SAFETY NUMBER ===');
const mine = await ana.safetyNumber(anaKeys.publicKeyBase64, benKeys.publicKeyBase64);
const theirs = await ben.safetyNumber(benKeys.publicKeyBase64, anaKeys.publicKeyBase64);
check('both phones compute the same number', JSON.stringify(mine) === JSON.stringify(theirs), { mine, theirs });
check('it is twelve groups of five digits',
  mine.length === 12 && mine.every((g) => /^\d{5}$/.test(g)), mine);

// If a server handed one side a key it made up, the numbers would differ —
// which is the entire point of reading them to each other.
const impostor = await ana.safetyNumber(anaKeys.publicKeyBase64, eveKeys.publicKeyBase64);
check('a substituted key changes it', JSON.stringify(impostor) !== JSON.stringify(mine));
check('and a missing key yields nothing rather than a false match',
  (await ana.safetyNumber(anaKeys.publicKeyBase64, null)) === null);

console.log('\n=== ENCRYPTING WITHOUT A PARTNER KEY IS AN ERROR, NOT A NO-OP ===');
// Quietly sending plaintext because a key was missing is the worst possible
// failure here: it looks identical to success.
let threw = false;
try { await ana.encryptFor(null, 'secret'); } catch { threw = true; }
check('it refuses rather than sending in the clear', threw);

console.log(`\nCRYPTO RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
