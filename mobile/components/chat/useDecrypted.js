// The readable body of each message, decrypting the sealed ones in the
// background.
//
// Kept beside the list, never written into it, so plaintext cannot end up
// anywhere it could be persisted. Keyed by the ciphertext itself rather than
// the message id: an edited message is a new ciphertext, so it is decrypted
// again instead of showing what it said before.
import { useCallback, useEffect, useState } from 'react';
import { decryptFrom, isEncrypted } from '../../services/crypto';

/**
 * Returns { textOf, remember }. textOf(message) is its readable body:
 * a string, undefined while decrypting, or null when it cannot be opened
 * (usually: the other phone was reinstalled and has new keys).
 * remember(ciphertext, plaintext) records what this phone just sealed, so
 * its own message shows at once rather than after a round trip.
 */
export default function useDecrypted(messages, partnerKey) {
  const [opened, setOpened] = useState({});

  useEffect(() => {
    let cancelled = false;
    const pending = [...new Set(messages
      .map((m) => m.content)
      .filter((c) => isEncrypted(c) && opened[c] === undefined))];
    if (!pending.length || !partnerKey) return undefined;
    (async () => {
      const next = {};
      for (const cipher of pending) {
        // eslint-disable-next-line no-await-in-loop
        next[cipher] = await decryptFrom(partnerKey, cipher);
      }
      if (!cancelled) setOpened((prev) => ({ ...prev, ...next }));
    })();
    return () => { cancelled = true; };
  }, [messages, partnerKey, opened]);

  const textOf = useCallback((m) => {
    if (!m || m.content == null) return m?.content ?? undefined;
    return isEncrypted(m.content) ? opened[m.content] : m.content;
  }, [opened]);

  const remember = useCallback((cipher, plain) => {
    if (cipher) setOpened((prev) => ({ ...prev, [cipher]: plain }));
  }, []);

  return { textOf, remember };
}
