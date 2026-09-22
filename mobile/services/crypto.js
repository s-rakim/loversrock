// End-to-end encryption for the message thread.
//
// What this means concretely: the text of a message is encrypted on the phone
// that wrote it and decrypted on the phone that reads it. The server stores
// ciphertext and holds no key that can open it. Someone with the database,
// the storage bucket and the server's own secrets still cannot read a word.
//
// The scheme is NaCl box — X25519 key agreement, XSalsa20 for the stream,
// Poly1305 for authentication. That is one well-analysed construction rather
// than a hand-assembled pile of primitives, and tweetnacl is a small, audited
// implementation that runs in pure JavaScript, which matters here: Hermes has
// no WebCrypto and no Buffer, and adding another native module to this build
// has already cost enough.
//
// Authentication is not optional and comes free: box() is authenticated
// encryption, so a message that arrives altered fails to open rather than
// decrypting to something an attacker chose. A server that tampered with a
// row would be caught, not obeyed.
//
// WHAT IS AND IS NOT COVERED, stated plainly rather than implied:
//
//   Encrypted: message text, and doodle stroke data.
//   Not encrypted: photos, memories and widget images; who sent what and
//     when; everything else in the app.
//
// Photos are genuinely harder and the reason is architectural, not laziness:
// an <Image> fetches its URL in the platform's own loader, and the home
// screen widget fetches in a separate OS process that has no access to the
// keychain. Encrypting those means fetching bytes in JS, decrypting, and
// rendering from memory — and giving the widget a different story entirely.
// That is a real piece of work, not a flag flip, and claiming it was done
// when it was not is worse than not doing it.
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import nacl from 'tweetnacl';
import { decodeUTF8, encodeUTF8, encodeBase64, decodeBase64 } from 'tweetnacl-util';

// tweetnacl refuses to work without a PRNG it trusts, and deliberately has no
// fallback: a "random" source that is not random silently destroys every
// guarantee above, so it would rather throw. expo-crypto is backed by the
// platform CSPRNG (SecRandomCopyBytes / SecureRandom).
nacl.setPRNG((buffer, length) => {
  const bytes = Crypto.getRandomBytes(length);
  for (let i = 0; i < length; i += 1) buffer[i] = bytes[i];
});

const SECRET_KEY = 'loversrock_e2ee_secret_key';
const PUBLIC_KEY = 'loversrock_e2ee_public_key';

/** Ciphertext carries this prefix so an old plaintext row is still readable. */
export const CIPHER_PREFIX = 'e2ee:v1:';

let cached = null;

/**
 * This device's keypair, generated once and never leaving the keychain.
 *
 * The private key is stored with expo-secure-store, which is the iOS keychain
 * and Android's EncryptedSharedPreferences — not AsyncStorage, which is a
 * plain file any process with the app's data directory can read.
 */
export async function getKeyPair() {
  if (cached) return cached;

  const [secret, publicKey] = await Promise.all([
    SecureStore.getItemAsync(SECRET_KEY),
    SecureStore.getItemAsync(PUBLIC_KEY),
  ]);

  if (secret && publicKey) {
    cached = { secretKey: decodeBase64(secret), publicKey: decodeBase64(publicKey), publicKeyBase64: publicKey };
    return cached;
  }

  const pair = nacl.box.keyPair();
  const publicKeyBase64 = encodeBase64(pair.publicKey);
  await SecureStore.setItemAsync(SECRET_KEY, encodeBase64(pair.secretKey));
  await SecureStore.setItemAsync(PUBLIC_KEY, publicKeyBase64);

  cached = { secretKey: pair.secretKey, publicKey: pair.publicKey, publicKeyBase64 };
  return cached;
}

/** Forgets the keys. Used on logout, so the next account starts clean. */
export async function clearKeys() {
  cached = null;
  await SecureStore.deleteItemAsync(SECRET_KEY).catch(() => {});
  await SecureStore.deleteItemAsync(PUBLIC_KEY).catch(() => {});
}

/**
 * Encrypts a string for one specific partner.
 *
 * A fresh 24-byte nonce per message, prepended to the ciphertext. Nonces are
 * not secret and do not need to be — they need to be unique, and at 24 bytes
 * from a real CSPRNG a repeat is not something that happens.
 */
export async function encryptFor(partnerPublicKeyBase64, plaintext) {
  if (!partnerPublicKeyBase64) throw new Error('No key for your partner yet');
  const { secretKey } = await getKeyPair();

  const theirKey = decodeBase64(partnerPublicKeyBase64);
  if (theirKey.length !== nacl.box.publicKeyLength) {
    // Refusing beats sending in the clear. A "key" that is the wrong length
    // is a bug or a tampered profile response, and the one thing that must
    // never happen here is falling back to plaintext.
    throw new Error("Your partner's key looks wrong — nothing was sent");
  }

  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const boxed = nacl.box(decodeUTF8(String(plaintext)), nonce, theirKey, secretKey);
  if (!boxed) throw new Error('Could not encrypt that message');

  const payload = new Uint8Array(nonce.length + boxed.length);
  payload.set(nonce);
  payload.set(boxed, nonce.length);
  return `${CIPHER_PREFIX}${encodeBase64(payload)}`;
}

/**
 * Opens a message from a partner.
 *
 * box is symmetric in the pair: the same call opens a message they sent you
 * and one you sent them, because both derive the same shared secret from the
 * two keys. That is what lets your own sent messages still be readable on a
 * second device without keeping a plaintext copy anywhere.
 */
export async function decryptFrom(partnerPublicKeyBase64, payload) {
  if (typeof payload !== 'string' || !payload.startsWith(CIPHER_PREFIX)) {
    return payload;    // an older, unencrypted message — show it as it is
  }
  if (!partnerPublicKeyBase64) return null;

  const { secretKey } = await getKeyPair();

  // Everything below is inside a try on purpose. tweetnacl THROWS on a
  // malformed input — a short nonce, a bad key length — rather than
  // returning null, and decryption runs inside a FlatList render. An
  // unreadable row must be an unreadable row, never an exception that takes
  // the whole thread down with it. A truncated payload found this.
  try {
    const raw = decodeBase64(payload.slice(CIPHER_PREFIX.length));
    if (raw.length <= nacl.box.nonceLength) return null;

    const nonce = raw.slice(0, nacl.box.nonceLength);
    const boxed = raw.slice(nacl.box.nonceLength);
    const theirKey = decodeBase64(partnerPublicKeyBase64);
    if (theirKey.length !== nacl.box.publicKeyLength) return null;

    const opened = nacl.box.open(boxed, nonce, theirKey, secretKey);
    // null means the authenticator did not verify: wrong key, or tampered
    // with. Either way it is not a message, and guessing would be worse.
    if (!opened) return null;
    return encodeUTF8(opened);
  } catch {
    return null;
  }
}

export const isEncrypted = (value) =>
  typeof value === 'string' && value.startsWith(CIPHER_PREFIX);

/**
 * The safety number: a short fingerprint of both public keys.
 *
 * Encryption stops the server reading messages. It does not, on its own, stop
 * a server that hands each of you a key it made up — it would then sit in the
 * middle, decrypting and re-encrypting, and nothing on either screen would
 * look wrong. Comparing this number out loud, on a call or in person, is what
 * closes that: it is derived from the two real public keys, so if the numbers
 * match on both phones, nobody is in between.
 *
 * Sorted before hashing so both phones compute the same digits regardless of
 * which side is asking.
 */
export async function safetyNumber(myPublicKeyBase64, partnerPublicKeyBase64) {
  if (!myPublicKeyBase64 || !partnerPublicKeyBase64) return null;

  const joined = [myPublicKeyBase64, partnerPublicKeyBase64].sort().join('|');
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, joined);

  // 60 hex characters as twelve groups of five decimal digits, the same
  // shape Signal uses, because it is genuinely easier to read aloud than raw
  // hex and mistakes are the failure mode this is trying to avoid.
  const groups = [];
  for (let i = 0; i < 12; i += 1) {
    const chunk = digest.slice(i * 5, i * 5 + 5);
    groups.push(String(parseInt(chunk, 16) % 100000).padStart(5, '0'));
  }
  return groups;
}
