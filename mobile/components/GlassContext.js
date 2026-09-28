import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_GLASS_INTENSITY } from '../theme';

const STORAGE_KEY = 'loversrock_glass_intensity';
const SCALE_KEY = 'loversrock_bar_scale';

/** How big the bottom bar can be made, as a multiple of its designed size. */
export const BAR_SCALE = { min: 0.8, max: 1.3, step: 0.05, default: 1 };
const clampScale = (v) => Math.min(BAR_SCALE.max, Math.max(BAR_SCALE.min, Number(v) || BAR_SCALE.default));

const GlassContext = createContext({
  intensity: DEFAULT_GLASS_INTENSITY,
  setIntensity: () => {},
  barScale: BAR_SCALE.default,
  setBarScale: () => {},
});

// Persists the bottom tab bar's liquid-glass blur intensity (0-100) and its
// size across launches, and shares them with the Settings sliders that
// adjust them. Both are this phone's own: a bigger bar is about your thumbs.
export function GlassProvider({ children }) {
  const [intensity, setIntensityState] = useState(DEFAULT_GLASS_INTENSITY);
  const [barScale, setBarScaleState] = useState(BAR_SCALE.default);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored !== null) setIntensityState(Number(stored));
    }).catch(() => {});
    AsyncStorage.getItem(SCALE_KEY).then((stored) => {
      if (stored !== null) setBarScaleState(clampScale(stored));
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

  const value = useMemo(() => ({ intensity, setIntensity, barScale, setBarScale }), [intensity, barScale]);

  return <GlassContext.Provider value={value}>{children}</GlassContext.Provider>;
}

export function useGlass() {
  return useContext(GlassContext);
}
