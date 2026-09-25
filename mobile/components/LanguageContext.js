// The language the app is in.
//
// Three states, not two: 'system' follows the phone, and an explicit code
// overrides it. Without the first, somebody who changes their phone to Spanish
// is stuck in whatever this app guessed on the day they installed it.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  CATALOGUES, DEFAULT_LANGUAGE, LANGUAGES, deviceLanguage, plural, translate,
} from '../i18n';

const KEY = 'language';
const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  // 'system' or a code. Starts at 'system' so the first render is already in
  // the right language rather than flashing English and then switching.
  const [preference, setPreferenceState] = useState('system');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((saved) => {
        if (saved === 'system' || CATALOGUES[saved]) setPreferenceState(saved);
      })
      .catch(() => {})
      .finally(() => setHydrated(true));
  }, []);

  const setPreference = useCallback((next) => {
    setPreferenceState(next);
    AsyncStorage.setItem(KEY, next).catch(() => {});
  }, []);

  const language = preference === 'system' ? deviceLanguage() : preference;

  const value = useMemo(() => ({
    language,
    preference,
    setPreference,
    languages: LANGUAGES,
    hydrated,
    // Bound to the current language so a screen writes t('home.greeting')
    // rather than translate(language, 'home.greeting').
    t: (key, vars) => translate(language, key, vars),
    tPlural: (key, count, vars) => plural(language, key, count, vars),
  }), [language, preference, setPreference, hydrated]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/**
 * Falls back to English rather than throwing when there is no provider.
 *
 * A missing provider is a bug, but it is a bug that should show English text
 * rather than a white screen — this hook is called from every screen in the
 * app, including ones a test renders on their own.
 */
export function useLanguage() {
  return useContext(LanguageContext) || {
    language: DEFAULT_LANGUAGE,
    preference: 'system',
    setPreference: () => {},
    languages: LANGUAGES,
    hydrated: true,
    t: (key, vars) => translate(DEFAULT_LANGUAGE, key, vars),
    tPlural: (key, count, vars) => plural(DEFAULT_LANGUAGE, key, count, vars),
  };
}
