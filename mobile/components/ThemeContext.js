import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { Appearance, AccessibilityInfo, useWindowDimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { lightColors, darkColors, makeFont, gradientForCategory } from '../theme';
import { apiFetch } from '../services/api';

const STORAGE_KEY = 'loversrock_theme_preference';
const MOTION_KEY = 'loversrock_reduce_motion';

/** 'system' follows the OS live; 'light'/'dark' pin it. */
export const THEME_PREFERENCES = ['system', 'light', 'dark'];

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [preference, setPreferenceState] = useState('system');
  const [systemScheme, setSystemScheme] = useState(() => Appearance.getColorScheme() || 'light');
  const [hydrated, setHydrated] = useState(false);
  // 'system' defers to the OS accessibility setting; true/false override it.
  const [motionPreference, setMotionPreferenceState] = useState('system');
  const [systemReduceMotion, setSystemReduceMotion] = useState(false);

  // Restore the saved choice before the first paint that matters. Failing to
  // read storage just means the OS scheme wins, which is the default anyway.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (!cancelled && THEME_PREFERENCES.includes(saved)) setPreferenceState(saved);
      })
      .catch(() => {})
      .finally(() => !cancelled && setHydrated(true));
    AsyncStorage.getItem(MOTION_KEY)
      .then((saved) => {
        if (!cancelled && ['system', 'on', 'off'].includes(saved)) setMotionPreferenceState(saved);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Honour the OS "reduce motion" setting, and keep following it while open.
  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => !cancelled && setSystemReduceMotion(Boolean(enabled)))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setSystemReduceMotion);
    return () => { cancelled = true; sub?.remove?.(); };
  }, []);

  // Follow the OS live, not just at launch — someone flipping their phone to
  // dark mode should see this app follow while it is open.
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemScheme(colorScheme || 'light');
    });
    return () => sub.remove();
  }, []);

  const setPreference = useCallback(async (next) => {
    if (!THEME_PREFERENCES.includes(next)) return;
    setPreferenceState(next);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, next);
    } catch {
      // A storage failure costs persistence, not the current session.
    }
    // Mirror onto the profile so a reinstall or a second device starts in the
    // same theme. Best-effort: never block the UI on the network.
    apiFetch('/profile/preferences', { method: 'PATCH', body: { themePreference: next } }).catch(() => {});
  }, []);

  const setMotionPreference = useCallback(async (next) => {
    if (!['system', 'on', 'off'].includes(next)) return;
    setMotionPreferenceState(next);
    try {
      await AsyncStorage.setItem(MOTION_KEY, next);
    } catch {
      // Persistence is a nicety; the current session still honours the choice.
    }
  }, []);

  const scheme = preference === 'system' ? systemScheme : preference;
  const reduceMotion = motionPreference === 'system' ? systemReduceMotion : motionPreference === 'on';
  const isDark = scheme === 'dark';

  // The phone's own font-size setting. React Native already scales fontSize
  // by it, so makeFont does NOT touch fontSize - it uses this for lineHeight,
  // which RN does not scale. Without that, turning the phone's font size up
  // grows the glyphs while the line spacing stays put and the text closes up.
  const { fontScale } = useWindowDimensions();

  const value = useMemo(() => {
    const colors = isDark ? darkColors : lightColors;
    return {
      colors,
      font: makeFont(colors, fontScale),
      // Exposed so a screen sizing its own one-off text can keep its leading
      // in step rather than being the one line that stays cramped.
      fontScale,
      scheme,
      isDark,
      preference,
      setPreference,
      reduceMotion,
      motionPreference,
      setMotionPreference,
      hydrated,
      gradientForCategory: (category) => gradientForCategory(category, scheme),
      // react-navigation and expo-status-bar both want the *opposite* word
      // from the scheme in places, so resolve it once here.
      statusBarStyle: isDark ? 'light' : 'dark',
      keyboardAppearance: isDark ? 'dark' : 'light',
    };
  }, [isDark, scheme, preference, setPreference, reduceMotion, motionPreference, setMotionPreference, hydrated, fontScale]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme() must be used inside <ThemeProvider>');
  return ctx;
}
