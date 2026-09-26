// Which mascot picture is you on THIS phone, kept in step with the server.
//
// Anything that draws a mascot calls this so it re-renders when the answer
// arrives or changes. The answer itself lives in assets/mascot (artFor reads
// it), cached on the phone so a cold start shows the right person straight
// away instead of flashing the other one until /profile answers.
import { useEffect, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch } from '../services/api';
import {
  getMascotOwners, setMascotOwners, subscribeMascotOwners,
} from '../assets/mascot';

const CACHE_KEY = 'loversrock.mascotArt';
// Often enough to notice a pairing or a pick made on the other phone, rarely
// enough that a screen full of mascots is not a burst of /profile calls.
const REFRESH_MS = 5 * 60 * 1000;

let cacheRead = false;
let lastFetch = 0;
let inFlight = null;

/** Adopt an answer, and remember it for the next cold start. */
export function adoptMascotArt(mine) {
  if (mine !== 'a' && mine !== 'b') return;
  setMascotOwners(mine);
  AsyncStorage.setItem(CACHE_KEY, mine).catch(() => {});
}

/** Ask the server again now, e.g. right after a pick. */
export function refreshMascotOwners() {
  if (inFlight) return inFlight;
  lastFetch = Date.now();
  inFlight = apiFetch('/profile')
    .then((profile) => adoptMascotArt(profile?.me?.mascotArt))
    // Signed out or offline: keep what we have, and let the next mount retry.
    .catch(() => { lastFetch = 0; })
    .finally(() => { inFlight = null; });
  return inFlight;
}

export default function useMascotOwners() {
  const owners = useSyncExternalStore(subscribeMascotOwners, getMascotOwners);

  useEffect(() => {
    if (!cacheRead) {
      cacheRead = true;
      AsyncStorage.getItem(CACHE_KEY)
        // Only if the server has not already answered in the meantime.
        .then((cached) => { if (cached && lastFetch === 0) setMascotOwners(cached); })
        .catch(() => {});
    }
    if (Date.now() - lastFetch > REFRESH_MS) refreshMascotOwners();
  }, []);

  return owners;
}
