// Kisses, in the app.
//
// The widget is the primary way this gets used — that is the whole point of
// a one-tap button on a home screen — but an app that cannot do the thing its
// own widget does is an odd app, and there has to be somewhere the kiss you
// were sent is acknowledged.
import { useCallback, useEffect, useState } from 'react';
import { apiFetch, onSocketEvent } from '../services/api';

export default function useNudges() {
  const [state, setState] = useState({ theirs: null, mine: null, unseen: 0 });
  const [sending, setSending] = useState(false);

  const load = useCallback(() => apiFetch('/presence/nudges')
    .then(setState)
    .catch(() => {}), []);

  useEffect(() => { load(); }, [load]);

  // Live, because a kiss that shows up four hours later when the app is next
  // opened is not a kiss, it is a log entry.
  useEffect(() => onSocketEvent('nudge:received', () => load()), [load]);

  const send = useCallback(async (kind = 'kiss') => {
    setSending(true);
    try {
      const res = await apiFetch('/presence/nudges', { method: 'POST', body: { kind } });
      await load();
      return res;
    } finally {
      setSending(false);
    }
  }, [load]);

  // Separate from load() on purpose: seeing the badge and clearing it are
  // different events, and clearing on every poll would mean a kiss sent while
  // you had the app open in your pocket was never noticed at all.
  const markSeen = useCallback(() => apiFetch('/presence/nudges/seen', { method: 'POST' })
    .then(() => setState((s) => ({ ...s, unseen: 0 })))
    .catch(() => {}), []);

  return { ...state, send, sending, markSeen, reload: load };
}
