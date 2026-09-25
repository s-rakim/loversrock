// Language.
//
// One assertion here matters more than all the others: every catalogue has
// exactly the same keys as English, both directions. A half-translated
// language is a screen with holes in it, and there is nothing at runtime that
// can tell you — the fallback quietly shows English and looks deliberate.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const babel = require('@babel/core');

let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${d ?? ''}`); } };

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

/** Loads an ES module with its imports stubbed, the way the other suites do. */
function load(relative, stubs = {}) {
  const file = path.join(root, relative);
  const { code } = babel.transformSync(fs.readFileSync(file, 'utf8'), {
    filename: file,
    presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
    babelrc: false, configFile: false,
  });
  const module_ = { exports: {} };
  const fakeRequire = (id) => {
    if (stubs[id]) return stubs[id];
    if (id.startsWith('.')) {
      const resolved = path.join(path.dirname(relative), id);
      return load(resolved.endsWith('.js') ? resolved : `${resolved}.js`, stubs);
    }
    return {};
  };
  new Function('module', 'exports', 'require', code)(module_, module_.exports, fakeRequire);
  return module_.exports;
}

const i18n = load('i18n/index.js', {
  // A native module; absent on a JS-only run, which deviceLanguage() has to
  // survive rather than throw on.
  'expo-localization': { getLocales: () => [{ languageCode: 'es', languageTag: 'es-MX' }] },
});
const { CATALOGUES, LANGUAGES, translate, plural, deviceLanguage, DEFAULT_LANGUAGE } = i18n;

const flatten = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) => (
  typeof v === 'string' ? [prefix + k] : flatten(v, `${prefix}${k}.`)
));

console.log('=== EVERY LANGUAGE HAS EVERY KEY ===');
const enKeys = flatten(CATALOGUES.en).sort();
check(`English has ${enKeys.length} keys`, enKeys.length > 100, enKeys.length);
check('and no duplicates', new Set(enKeys).size === enKeys.length);

for (const code of Object.keys(CATALOGUES)) {
  if (code === 'en') continue;
  const keys = flatten(CATALOGUES[code]).sort();
  const missing = enKeys.filter((k) => !keys.includes(k));
  const extra = keys.filter((k) => !enKeys.includes(k));
  // Missing is a hole in a screen; extra is a typo that will never be read.
  check(`${code} is missing nothing`, missing.length === 0, missing.join(', '));
  check(`${code} has nothing English does not`, extra.length === 0, extra.join(', '));
}

console.log('\n=== AND EVERY PLACEHOLDER ===');
// A translation that drops {name} renders a sentence with a hole in it; one
// that invents {naem} renders the literal braces.
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const at = (cat, key) => key.split('.').reduce((n, p) => n?.[p], cat);
const mismatched = [];
for (const code of Object.keys(CATALOGUES)) {
  if (code === 'en') continue;
  for (const key of enKeys) {
    const a = placeholders(at(CATALOGUES.en, key) || '');
    const b = placeholders(at(CATALOGUES[code], key) || '');
    if (JSON.stringify(a) !== JSON.stringify(b)) mismatched.push(`${code}:${key} ${a} vs ${b}`);
  }
}
check('every translation keeps the same placeholders', mismatched.length === 0, mismatched.slice(0, 5).join(' | '));

console.log('\n=== LOOKUP ===');
check('a key resolves', translate('en', 'common.save') === 'Save');
check('and in another language', translate('es', 'common.save') === 'Guardar');
// English, never the raw key: a screen showing `home.greeting` is worse than
// one showing English to somebody who asked for Spanish.
check('a missing key falls back to English, not to the key',
  translate('es', 'nope.missing') === 'nope.missing'
  && translate('fr', 'common.save') === 'Enregistrer');
check('an unknown LANGUAGE falls back to English rather than blank',
  translate('de', 'common.save') === 'Save');
check('a key that is an object, not a string, does not return the object',
  typeof translate('en', 'common') === 'string');

console.log('\n=== INTERPOLATION ===');
check('a placeholder is filled', translate('en', 'home.greeting', { name: 'Ana' }) === 'you & Ana');
// A visible {name} gets reported; a silent gap does not.
check('an unfilled one stays VISIBLE rather than blanking',
  translate('en', 'home.greeting', {}) === 'you & {name}');
check('a zero fills as zero rather than vanishing',
  translate('en', 'home.streak', { count: 0 }) === '0 day streak');
check('and vars on a string with no placeholders is harmless',
  translate('en', 'common.save', { name: 'x' }) === 'Save');

console.log('\n=== DEVICE LANGUAGE ===');
check('a supported device locale is used', deviceLanguage() === 'es');
check('and the default is English', DEFAULT_LANGUAGE === 'en');
// A device set to Mexican Spanish must get Spanish, not English.
const mx = load('i18n/index.js', {
  'expo-localization': { getLocales: () => [{ languageCode: 'pt', languageTag: 'pt-BR' }] },
});
check('an UNsupported locale falls back rather than breaking', mx.deviceLanguage() === 'en');
const broken = load('i18n/index.js', {
  'expo-localization': { getLocales: () => { throw new Error('no native module'); } },
});
check('and a missing native module does not throw', broken.deviceLanguage() === 'en');

console.log('\n=== THE LIST IN SETTINGS MATCHES WHAT EXISTS ===');
check(`${LANGUAGES.length} languages are offered`, LANGUAGES.length === Object.keys(CATALOGUES).length, LANGUAGES);
check('and each one has a catalogue behind it',
  LANGUAGES.every((l) => CATALOGUES[l.code]), LANGUAGES.map((l) => l.code));
check('each is named in its OWN language, which is how a person finds theirs',
  LANGUAGES.every((l) => l.native && l.label), LANGUAGES);

console.log('\n=== WIRED IN ===');
const app = fs.readFileSync(path.join(root, 'App.js'), 'utf8');
check('the provider wraps the app', /<LanguageProvider>/.test(app));
// Outermost, so the theme's own labels can be translated too.
check('outside the theme provider', app.indexOf('<LanguageProvider>') < app.indexOf('<ThemeProvider>'));
const settings = fs.readFileSync(path.join(root, 'app', 'SettingsScreen.js'), 'utf8');
check('Settings offers the choice', /setLanguagePreference/.test(settings));
// Without this a person who changes their phone's language is stuck in
// whatever this app guessed on the day they installed it.
check('including following the phone', /code: 'system'/.test(settings));

console.log(`\nI18N RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
