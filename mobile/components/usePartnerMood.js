// Your partner's current mood, kept live.
//
// The mascot wears this, so it has to update without a screen being
// reopened — the moment they change it on their phone, the little character
// on yours changes with it. That is the entire point of the feature: it is a
// signal you receive, not a page you visit.
import { useCallback, useEffect, useState } from 'react';
import { apiFetch, connectSocket, getSocket } from '../services/api';
import { refreshWidgets } from '../services/widgetBridge';

export default function usePartnerMood() {
  const [theirs, setTheirs] = useState(null);
  const [mine, setMine] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => apiFetch('/presence/moods')
    .then((d) => { setTheirs(d.theirs || null); setMine(d.mine || null); })
    .catch(() => {})
    .finally(() => setLoading(false)), []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const socket = await connectSocket();
      if (cancelled) return;
      // The event carries the row, but not whose it is in a form worth
      // trusting for this — reloading is one small request and keeps the two
      // sides of the pair from diverging.
      // The distance widget wears both moods, so it re-fetches too rather
      // than waiting out its 30-minute timer.
      socket.on('mood:changed', () => { load(); refreshWidgets(); });
    })();
    return () => { cancelled = true; getSocket()?.off('mood:changed'); };
  }, [load]);

  const setMyMood = useCallback(async (mood, note) => {
    const { mood: saved } = await apiFetch('/presence/moods', {
      method: 'PUT', body: { mood, note: note || null },
    });
    setMine(saved);
    refreshWidgets();
    return saved;
  }, []);

  return {
    // What the mascot should wear. Theirs, deliberately — see Mascot.js.
    mood: theirs?.mood || null,
    note: theirs?.note || null,
    updatedAt: theirs?.updated_at || null,
    mine,
    setMyMood,
    loading,
    reload: load,
  };
}
