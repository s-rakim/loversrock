import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_GLASS_INTENSITY } from '../theme';

const STORAGE_KEY = 'loversrock_glass_intensity';
const SCALE_KEY = 'loversrock_bar_scale';
const BACKDROP_KEY = 'loversrock_backdrop';

/**
 * What is behind every screen: the lava lamp (the app's own look, and the
 * default), the live Golden Gate sky that follows the clock, or its timelapse.
 */
export const BACKDROPS = [
  { id: 'lava', label: 'Lava lamp' },
  { id: 'sky', label: 'Live sky' },
  { id: 'timelapse', label: 'Timelapse' },
];
export const DEFAULT_BACKDROP = 'lava';
const isBackdrop = (v) => BACKDROPS.some((b) => b.id === v);

/** How big the bottom bar can be made, as a multiple of its designed size. */
export const BAR_SCALE = { min: 0.8, max: 1.3, step: 0.05, default: 1 };
const clampScale = (v) => Math.min(BAR_SCALE.max, Math.max(BAR_SCALE.min, Number(v) || BAR_SCALE.default));

const GlassContext = createContext({
  intensity: DEFAULT_GLASS_INTENSITY,
  setIntensity: () => {},
  barScale: BAR_SCALE.default,
  setBarScale: () => {},
  backdrop: DEFAULT_BACKDROP,
  setBackdrop: () => {},
});

// Persists the bottom tab bar's liquid-glass blur intensity (0-100), its
// size and the background choice across launches, and shares them with the
// Settings controls that change them. All are this phone's own: a bigger bar
// is about your thumbs, a background about your taste.
export function GlassProvider({ children }) {
  const [intensity, setIntensityState] = useState(DEFAULT_GLASS_INTENSITY);
  const [barScale, setBarScaleState] = useState(BAR_SCALE.default);
  const [backdrop, setBackdropState] = useState(DEFAULT_BACKDROP);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored !== null) setIntensityState(Number(stored));
    }).catch(() => {});
    AsyncStorage.getItem(SCALE_KEY).then((stored) => {
      if (stored !== null) setBarScaleState(clampScale(stored));
    }).catch(() => {});
    AsyncStorage.getItem(BACKDROP_KEY).then((stored) => {
      if (isBackdrop(stored)) setBackdropState(stored);
    }).catch(() => {});
  }, []);

  function setIntensity(value) {
    setIntensityState(value);
    AsyncStorage.setItem(STORAGE_KEY, String(value)).catch(() => {});
  }

  function setBarScale(value) {
    const v = clampScale(value);
    setBarScaleState(v);
    AsyncStorage.setItem(SCALE_KEY, String(v)).catch(() => {});
  }

  function setBackdrop(value) {
    if (!isBackdrop(value)) return;
    setBackdropState(value);
    AsyncStorage.setItem(BACKDROP_KEY, value).catch(() => {});
  }

  const value = useMemo(
    () => ({ intensity, setIntensity, barScale, setBarScale, backdrop, setBackdrop }),
    [intensity, barScale, backdrop]
  );

  return <GlassContext.Provider value={value}>{children}</GlassContext.Provider>;
}

export function useGlass() {
  return useContext(GlassContext);
}
