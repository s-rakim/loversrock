// The two mascots on THIS phone, kept in step with the server.
//
// Anything that draws a mascot calls this so it re-renders when the pictures
// arrive or change. The pictures themselves live in the store in
// assets/mascot; this fills it from GET /profile, keeps a copy on the phone
// so a cold start shows the right pictures straight away, and refetches when
// the other phone says a mascot changed.
import { useEffect, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  apiFetch, connectSocket, getAccessToken, getSocket, hasCachedAccessToken, mediaUrl,
} from '../services/api';
import { refreshWidgets } from '../services/widgetBridge';
import {
  getMascotState, setMascotOwners, setMascotPictures, setMascotResolver, subscribeMascotOwners,
} from '../assets/mascot';

const CACHE_KEY = 'loversrock.mascots';
// Often enough to notice a change the socket missed, rarely enough that a
// screen full of mascots is not a burst of /profile calls.
const REFRESH_MS = 5 * 60 * 1000;

// Built at render time, not stored: the URL carries the access token, which
// rotates. Before the token is in memory there is no usable URL at all, so
// the character is drawn for that moment rather than showing a broken image.
setMascotResolver((key) => (hasCachedAccessToken() ? mediaUrl(key) : null));

let cacheRead = false;
let lastFetch = 0;
let inFlight = null;

/** Adopt what the server said, and remember it for the next cold start. */
export function adoptMascots(profile) {
  const side = profile?.me?.mascotArt;
  if (side === 'a' || side === 'b') setMascotOwners(side);
  const pictures = { me: profile?.me?.mascot || null, partner: profile?.partner?.mascot || null };
  setMascotPictures(pictures);
  AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ side, pictures })).catch(() => {});
}

/** Ask the server again now, e.g. right after an upload. */
export function refreshMascotOwners() {
  if (inFlight) return inFlight;
  lastFetch = Date.now();
  inFlight = apiFetch('/profile')
    .then(adoptMascots)
    // Signed out or offline: keep what we have, and let the next mount retry.
    .catch(() => { lastFetch = 0; })
    .finally(() => { inFlight = null; });
  return inFlight;
}

export default function useMascotOwners() {
  const state = useSyncExternalStore(subscribeMascotOwners, getMascotState);

  useEffect(() => {
    if (!cacheRead) {
      cacheRead = true;
      AsyncStorage.getItem(CACHE_KEY)
        .then((raw) => {
          // Only if the server has not already answered in the meantime.
          if (!raw || lastFetch !== 0) return;
          const cached = JSON.parse(raw);
          if (cached.side) setMascotOwners(cached.side);
          if (cached.pictures) setMascotPictures(cached.pictures);
        })
        .catch(() => {});
    }
    if (Date.now() - lastFetch > REFRESH_MS) {
      getAccessToken().then((token) => { if (token) refreshMascotOwners(); }).catch(() => {});
    }

    // The other phone uploading or removing a picture. Their widget and ours
    // both show it, so the widgets refresh too.
    //
    // Only once somebody is signed in. The loading and login screens draw a
    // mascot too, and opening the live connection with no token there is
    // refused and retried in a loop for nothing.
    let cancelled = false;
    const onChanged = () => { refreshMascotOwners().then(() => refreshWidgets()); };
    getAccessToken()
      .then((token) => (token && !cancelled ? connectSocket() : null))
      .then((socket) => { if (socket && !cancelled) socket.on('mascot:changed', onChanged); })
      .catch(() => {});
    return () => { cancelled = true; getSocket()?.off('mascot:changed', onChanged); };
  }, []);

  return state;
}
