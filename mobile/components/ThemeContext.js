import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Appearance, AccessibilityInfo, useWindowDimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  lightColors, darkColors, makeFont, gradientForCategory,
  ACCENTS, ACCENT_NAMES, DEFAULT_ACCENT, withAccent,
  BACKGROUND_SPEEDS, MIN_BACKGROUND_INTENSITY, MAX_BACKGROUND_INTENSITY,
} from '../theme';
import { apiFetch } from '../services/api';

const STORAGE_KEY = 'loversrock_theme_preference';
const MOTION_KEY = 'loversrock_reduce_motion';
const ACCENT_KEY = 'loversrock_accent';
const BG_INTENSITY_KEY = 'loversrock_background_intensity';
const BG_SPEED_KEY = 'loversrock_background_speed';
const TEXT_SCALE_KEY = 'loversrock_text_scale';

export { ACCENTS, ACCENT_NAMES, BACKGROUND_SPEEDS };

/** In-app nudge on top of the phone's own font-size setting. */
export const TEXT_SCALES = [
  { id: 'small', label: 'Small', factor: 0.9 },
  { id: 'default', label: 'Default', factor: 1 },
  { id: 'large', label: 'Large', factor: 1.15 },
  { id: 'larger', label: 'Larger', factor: 1.3 },
];

/** 'system' follows the OS live; 'light'/'dark' pin it. */
export const THEME_PREFERENCES = ['system', 'light', 'dark'];

const ThemeContext = createContext(null);

/**
 * The background dims, it never brightens.
 *
 * Every contrast figure in test/theme.mjs is measured at the palette's own
 * blobOpacity. Allowing a slider above 1 would let the app ship a setting
 * that drops its own body text to 3.95:1.
 */
const clampIntensity = (value) =>
  Math.min(MAX_BACKGROUND_INTENSITY, Math.max(MIN_BACKGROUND_INTENSITY, Number(value) || 1));

export function ThemeProvider({ children }) {
  const [preference, setPreferenceState] = useState('system');
  const [systemScheme, setSystemScheme] = useState(() => Appearance.getColorScheme() || 'light');
  const [hydrated, setHydrated] = useState(false);
  // 'system' defers to the OS accessibility setting; true/false override it.
  const [motionPreference, setMotionPreferenceState] = useState('system');
  const [systemReduceMotion, setSystemReduceMotion] = useState(false);
  const [accentName, setAccentState] = useState(DEFAULT_ACCENT);
  const [backgroundIntensity, setBackgroundIntensityState] = useState(1);
  const [backgroundSpeed, setBackgroundSpeedState] = useState('gentle');
  const [textScale, setTextScaleState] = useState('default');

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
    AsyncStorage.multiGet([ACCENT_KEY, BG_INTENSITY_KEY, BG_SPEED_KEY, TEXT_SCALE_KEY])
      .then((entries) => {
        if (cancelled) return;
        const saved = Object.fromEntries(entries);
        if (ACCENT_NAMES.includes(saved[ACCENT_KEY])) setAccentState(saved[ACCENT_KEY]);
        const intensity = Number(saved[BG_INTENSITY_KEY]);
        if (Number.isFinite(intensity)) setBackgroundIntensityState(clampIntensity(intensity));
        if (saved[BG_SPEED_KEY] in BACKGROUND_SPEEDS) setBackgroundSpeedState(saved[BG_SPEED_KEY]);
        if (TEXT_SCALES.some((t) => t.id === saved[TEXT_SCALE_KEY])) setTextScaleState(saved[TEXT_SCALE_KEY]);
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

  const setAccent = useCallback(async (next) => {
    if (!ACCENT_NAMES.includes(next)) return;
    setAccentState(next);
    try { await AsyncStorage.setItem(ACCENT_KEY, next); } catch { /* session-only */ }
  }, []);

  // The state moves on every step so the background previews under your
  // thumb; the write waits until you stop, so one drag is one write rather
  // than fifteen.
  const intensityWrite = useRef(null);
  const setBackgroundIntensity = useCallback((next) => {
    const value = clampIntensity(next);
    setBackgroundIntensityState(value);
    clearTimeout(intensityWrite.current);
    intensityWrite.current = setTimeout(() => {
      AsyncStorage.setItem(BG_INTENSITY_KEY, String(value)).catch(() => { /* session-only */ });
    }, 400);
  }, []);

  useEffect(() => () => clearTimeout(intensityWrite.current), []);

  const setBackgroundSpeed = useCallback(async (next) => {
    if (!(next in BACKGROUND_SPEEDS)) return;
    setBackgroundSpeedState(next);
    try { await AsyncStorage.setItem(BG_SPEED_KEY, next); } catch { /* session-only */ }
  }, []);

  const setTextScale = useCallback(async (next) => {
    if (!TEXT_SCALES.some((t) => t.id === next)) return;
    setTextScaleState(next);
    try { await AsyncStorage.setItem(TEXT_SCALE_KEY, next); } catch { /* session-only */ }
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
    const base = isDark ? darkColors : lightColors;
    const colors = withAccent(base, accentName, isDark);
    // Kept as two separate multipliers on purpose — see makeFont. RN already
    // applies the phone's fontScale to fontSize; the in-app nudge it does not
    // know about, so that one has to be handed over explicitly.
    const textFactor = TEXT_SCALES.find((t) => t.id === textScale)?.factor ?? 1;
    return {
      colors,
      font: makeFont(colors, fontScale, textFactor),
      accentName,
      setAccent,
      backgroundIntensity,
      setBackgroundIntensity,
      backgroundSpeed,
      setBackgroundSpeed,
      textScale,
      setTextScale,
      // Exposed so a screen sizing its own one-off text can keep its leading
      // in step rather than being the one line that stays cramped.
      fontScale,
      textFactor,
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
  }, [isDark, scheme, preference, setPreference, reduceMotion, motionPreference, setMotionPreference,
    hydrated, fontScale, accentName, setAccent, backgroundIntensity, setBackgroundIntensity,
    backgroundSpeed, setBackgroundSpeed, textScale, setTextScale]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme() must be used inside <ThemeProvider>');
  return ctx;
}
