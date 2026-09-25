// Both characters, kept live.
//
// Your partner re-dressing theirs has to show up on your phone without the
// app being reopened — otherwise "they see what you put on" is only true
// until the next cold start.
import { useCallback, useEffect, useState } from 'react';
import { apiFetch, connectSocket, getSocket } from '../services/api';

export default function useAvatars() {
  const [avatars, setAvatars] = useState({ mine: null, theirs: null });

  const load = useCallback(() => apiFetch('/presence/avatars')
    .then(setAvatars)
    .catch(() => {}), []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const socket = await connectSocket();
      if (cancelled) return;
      socket.on('avatar:changed', () => load());
    })();
    return () => { cancelled = true; getSocket()?.off('avatar:changed'); };
  }, [load]);

  return { ...avatars, reload: load };
}
