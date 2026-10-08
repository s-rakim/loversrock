// Which encryption key this phone trusts for your partner.
//
// The server hands out both of your public keys. Encryption stops it reading
// messages, but a server that swapped in a key of its own could sit in the
// middle unseen. Two things close that:
//
//   - the first key seen for your partner is remembered (trust on first use),
//     and a different one later is a warning in the chat, not something used
//     silently: messages stay unsent until you accept it;
//   - the safety number (Settings → Encryption) compares the two real keys:
//     read it out on a call, and if both phones show the same digits, mark it
//     verified. A change after that is a louder warning.
//
// A new key is usually innocent: a reinstall or a new phone makes one. The
// point is that you hear about it.
import AsyncStorage from '@react-native-async-storage/async-storage';

const storageKey = (partnerId) => `loversrock_partner_key:${partnerId}`;

async function read(partnerId) {
  try {
    const raw = await AsyncStorage.getItem(storageKey(partnerId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function write(partnerId, value) {
  try {
    await AsyncStorage.setItem(storageKey(partnerId), JSON.stringify(value));
  } catch {
    /* not remembered: asked about again next time */
  }
}

/**
 * Where this key stands: 'none' (no key yet), 'trusted' (the one remembered),
 * or 'changed' (a different one; `wasVerified` says whether the old one had
 * been checked with the safety number). A first key is remembered and trusted.
 */
export async function checkPartnerKey(partnerId, publicKey) {
  if (!partnerId || !publicKey) return { status: 'none', verified: false };
  const pinned = await read(partnerId);
  if (!pinned?.key) {
    await write(partnerId, { key: publicKey, verified: false, at: Date.now() });
    return { status: 'trusted', verified: false, first: true };
  }
  if (pinned.key === publicKey) return { status: 'trusted', verified: Boolean(pinned.verified) };
  return { status: 'changed', verified: false, wasVerified: Boolean(pinned.verified) };
}

/** Trust this key from now on (after a change). Not verified until compared. */
export async function acceptPartnerKey(partnerId, publicKey) {
  await write(partnerId, { key: publicKey, verified: false, at: Date.now() });
}

/** Both phones showed the same safety number for this key. */
export async function markPartnerKeyVerified(partnerId, publicKey) {
  await write(partnerId, { key: publicKey, verified: true, at: Date.now() });
}
