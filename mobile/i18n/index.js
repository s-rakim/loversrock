// Language.
//
// Hand-rolled rather than i18next, because what this app needs is a lookup
// with a fallback and an interpolation, and the library that does that in
// 40 lines is not worth 60kB and a plugin ecosystem. What the library would
// buy — plurals, dates, RTL — is here in the two forms this app actually uses
// and no more.
//
// THE RULES, because getting any of them wrong is silent:
//
//   * A missing key falls back to English, never to a blank string and never
//     to the key itself. A screen showing `home.greeting` is worse than one
//     showing English.
//   * The catalogue is checked in a test: every key in every language must
//     exist in English, and vice versa. A half-translated language is a
//     screen with holes in it, and nothing at runtime can tell you that.
//   * Interpolation is `{name}`, and an unfilled placeholder is left visible
//     rather than blanked — a visible {name} gets reported, a silent gap
//     does not.
import { getLocales } from 'expo-localization';
import en from './en';
import es from './es';
import fr from './fr';

export const CATALOGUES = { en, es, fr };

export const LANGUAGES = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'es', label: 'Spanish', native: 'Español' },
  { code: 'fr', label: 'French', native: 'Français' },
];

export const DEFAULT_LANGUAGE = 'en';

/**
 * The language the OS is set to, if we have it.
 *
 * `getLocales()` returns things like `en-GB` and `pt-BR`; we match on the base
 * tag, so a device set to Mexican Spanish gets Spanish rather than English.
 */
export function deviceLanguage() {
  try {
    for (const locale of getLocales() || []) {
      const base = String(locale?.languageCode || locale?.languageTag || '').slice(0, 2).toLowerCase();
      if (CATALOGUES[base]) return base;
    }
  } catch {
    // Localization is a native module; on a JS-only test run it is absent.
  }
  return DEFAULT_LANGUAGE;
}

/** Follows a dotted path into an object without throwing on a missing branch. */
function lookup(catalogue, key) {
  let node = catalogue;
  for (const part of key.split('.')) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/**
 * @param key   a dotted path, e.g. 'home.greeting'
 * @param vars  values for any {placeholders}
 */
export function translate(language, key, vars) {
  const text = lookup(CATALOGUES[language] || {}, key)
    // English, never the raw key. A screen showing `home.greeting` is worse
    // than one showing English to somebody who asked for Spanish.
    ?? lookup(CATALOGUES[DEFAULT_LANGUAGE], key)
    ?? key;

  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name) => (
    // An unfilled placeholder stays visible. A visible {name} gets reported;
    // a silent gap does not.
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole
  ));
}

/**
 * The one plural rule this app needs.
 *
 * English, Spanish and French all split at exactly one — which is not true of
 * every language, and the day a language that needs more arrives, this is the
 * function that changes rather than every call site.
 */
export function plural(language, key, count, vars) {
  return translate(language, `${key}.${count === 1 ? 'one' : 'other'}`, { count, ...vars });
}
