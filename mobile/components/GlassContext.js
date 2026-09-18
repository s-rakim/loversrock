import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_GLASS_INTENSITY } from '../theme';

const STORAGE_KEY = 'loversrock_glass_intensity';

const GlassContext = createContext({
  intensity: DEFAULT_GLASS_INTENSITY,
  setIntensity: () => {},
});

// Persists the bottom tab bar's liquid-glass blur intensity (0-100) across
// launches, and shares it with the SettingsScreen slider that adjusts it.
export function GlassProvider({ children }) {
  const [intensity, setIntensityState] = useState(DEFAULT_GLASS_INTENSITY);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored !== null) setIntensityState(Number(stored));
    });
  }, []);

  function setIntensity(value) {
    setIntensityState(value);
    AsyncStorage.setItem(STORAGE_KEY, String(value)).catch(() => {});
  }

  const value = useMemo(() => ({ intensity, setIntensity }), [intensity]);

  return <GlassContext.Provider value={value}>{children}</GlassContext.Provider>;
}

export function useGlass() {
  return useContext(GlassContext);
}
