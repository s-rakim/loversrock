import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { lightColors, darkColors, makeFont, gradientForCategory } from '../theme';
import { apiFetch } from '../services/api';

const STORAGE_KEY = 'loversrock_theme_preference';

/** 'system' follows the OS live; 'light'/'dark' pin it. */
export const THEME_PREFERENCES = ['system', 'light', 'dark'];

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [preference, setPreferenceState] = useState('system');
  const [systemScheme, setSystemScheme] = useState(() => Appearance.getColorScheme() || 'light');
  const [hydrated, setHydrated] = useState(false);

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
    return () => { cancelled = true; };
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

  const scheme = preference === 'system' ? systemScheme : preference;
  const isDark = scheme === 'dark';

  const value = useMemo(() => {
    const colors = isDark ? darkColors : lightColors;
    return {
      colors,
      font: makeFont(colors),
      scheme,
      isDark,
      preference,
      setPreference,
      hydrated,
      gradientForCategory: (category) => gradientForCategory(category, scheme),
      // react-navigation and expo-status-bar both want the *opposite* word
      // from the scheme in places, so resolve it once here.
      statusBarStyle: isDark ? 'light' : 'dark',
      keyboardAppearance: isDark ? 'dark' : 'light',
    };
  }, [isDark, scheme, preference, setPreference, hydrated]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme() must be used inside <ThemeProvider>');
  return ctx;
}
