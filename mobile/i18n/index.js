// Lightweight i18n: English, French, Spanish and German. `t('key', { name })`
// interpolates {name}. Missing keys fall back to English, then to the key, so
// a new string never renders blank. The choice is stored on the device and on
// the account (so pushes and the partner's app can use it later).
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import en from './en';
import fr from './fr';
import es from './es';
import de from './de';

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'de', label: 'Deutsch' },
];

const DICTS = { en, fr, es, de };
const STORAGE_KEY = 'loversrock_language';
let current = 'en';

export function translate(key, vars, lang = current) {
  const raw = DICTS[lang]?.[key] ?? en[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`));
}

export const t = (key, vars) => translate(key, vars);

const I18nContext = createContext({ lang: 'en', setLang: () => {}, t });

export function LanguageProvider({ children, onChange }) {
  const [lang, setLangState] = useState('en');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored && DICTS[stored]) {
        current = stored;
        setLangState(stored);
      }
    }).catch(() => {});
  }, []);

  const value = useMemo(() => ({
    lang,
    setLang: (code) => {
      if (!DICTS[code]) return;
      current = code;
      setLangState(code);
      AsyncStorage.setItem(STORAGE_KEY, code).catch(() => {});
      onChange?.(code);
    },
    t: (key, vars) => translate(key, vars, lang),
  }), [lang, onChange]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
