// Renders components for real, in node, with the native bits stubbed.
//
// Written because of a bug the other suites could not have caught. Icon had
//
//     function Icon({ color = colors.accent, ... }) {
//       const { colors } = useTheme();
//
// which parses, lints and reads fine, and throws at render: default
// parameters are evaluated in their own scope before the body, so `colors`
// was still in its temporal dead zone. Half the app's icons crashed with
// "Property 'colors' doesn't exist" and nothing static could see it.
//
// The lesson generalised: a component that is never executed is not tested.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const babel = require('@babel/core');
const React = require('react');

let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${d ?? ''}`); } };

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// A minimal renderer: walk the element tree and call every function
// component, which is all that is needed to trip a TDZ error, a bad
// destructure, or a missing import.
function render(element, depth = 0) {
  if (element === null || element === undefined || typeof element !== 'object') return;
  if (Array.isArray(element)) { element.forEach((e) => render(e, depth)); return; }
  if (depth > 12) return;   // guard against a component that renders itself

  const { type, props } = element;
  if (typeof type === 'function') {
    const out = type.prototype?.isReactComponent
      ? new type(props).render()
      : type(props);
    render(out, depth + 1);
    return;
  }
  if (props?.children) render(props.children, depth + 1);
}

/** Loads a component module with react-native and friends stubbed out. */
function load(relative, extraStubs = {}) {
  const file = path.join(root, relative);
  const { code } = babel.transformSync(fs.readFileSync(file, 'utf8'), {
    filename: file,
    presets: [
      ['@babel/preset-env', { targets: { node: 'current' } }],
      ['@babel/preset-react', { runtime: 'classic' }],
    ],
    babelrc: false, configFile: false,
  });

  const host = (name) => name;   // host components render as plain strings
  const rn = {
    View: host('View'), Text: host('Text'), Pressable: host('Pressable'),
    Image: host('Image'), ScrollView: host('ScrollView'), TextInput: host('TextInput'),
    ActivityIndicator: host('ActivityIndicator'), FlatList: host('FlatList'),
    Switch: host('Switch'), Animated: { View: host('Animated.View'), Text: host('Animated.Text'), Value: class { constructor(v) { this.v = v; } setValue() {} interpolate() { return this; } }, timing: () => ({ start() {} }), spring: () => ({ start() {} }), parallel: () => ({ start() {} }), sequence: () => ({ start() {} }), loop: () => ({ start() {}, stop() {} }) },
    StyleSheet: { create: (s) => s, absoluteFill: {}, flatten: (s) => s },
    Dimensions: { get: () => ({ width: 390, height: 844 }) },
    Platform: { OS: 'android', select: (o) => o.android },
    Alert: { alert() {} },
    AppState: { addEventListener: () => ({ remove() {} }), currentState: 'active' },
    PanResponder: { create: () => ({ panHandlers: {} }) },
    Appearance: { getColorScheme: () => 'light', addChangeListener: () => ({ remove() {} }) },
    AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove() {} }) },
  };

  const module_ = { exports: {} };
  const fakeRequire = (id) => {
    if (id === 'react') return React;
    if (id === 'react-native') return rn;
    if (extraStubs[id]) return extraStubs[id];
    if (id.startsWith('.')) {
      // Resolve sibling modules through the same loader.
      const resolved = path.join(path.dirname(relative), id);
      return load(resolved.endsWith('.js') ? resolved : `${resolved}.js`, extraStubs);
    }
    // Anything else (vector icons, svg, gradients) becomes a host component.
    return new Proxy(() => null, {
      get: (_t, prop) => (prop === '__esModule' ? false : host(String(prop))),
      apply: () => null,
    });
  };
  new Function('module', 'exports', 'require', code)(module_, module_.exports, fakeRequire);
  return module_.exports;
}

console.log('=== ICON RENDERS IN EVERY SHAPE IT IS USED ===');
// A stub theme with the same keys the real one exposes.
const colors = {
  accent: '#FF5C8D', accentSoft: '#FCE1E6', accentPink: '#FF5C8D',
  accentIndigo: '#4B1FD1', surface: '#fff', surfaceAlt: '#eee', border: '#ddd',
  text: '#111', textPrimary: '#111', textSecondary: '#666', textMuted: '#666',
  danger: '#D9455B', success: '#3FA372', gold: '#D9A441', background: '#fff',
};
const themeStub = {
  useTheme: () => ({ colors, font: { body: {}, muted: {}, h1: {}, h2: {}, h3: {} }, isDark: false, reduceMotion: true }),
};

const motionStub = {
  // MorphButton uses useRef, and this walker calls components directly
  // rather than through React's dispatcher, so hooks are unavailable. The
  // wrapper is not what is under test here.
  MorphButton: ({ children }) => children,
  FadeInUp: ({ children }) => children,
  Pop: ({ children }) => children,
};
const Icon = load('components/Icon.js', {
  './ThemeContext': themeStub,
  './Motion': motionStub,
}).default;

// These are the exact prop shapes used across the app. The first one is the
// case that was crashing: no colour given at all.
const shapes = [
  ['no props but a name', { name: 'heart-outline' }],
  ['chip with no colours', { name: 'navigate-outline', chip: true, chipSize: 36 }],
  ['size only', { name: 'settings-outline', size: 18 }],
  // THE ONE THAT BROKE PAIRING: a colour was passed, but chipColor was not,
  // so its default still evaluated `colors` and threw. Passing `color`
  // looked like enough and was not.
  ['colour passed but NOT chipColor', { name: 'share-social-outline', size: 16, color: '#FF5C8D' }],
  ['explicit colour', { name: 'flame', color: '#123456' }],
  ['explicit chipColor only', { name: 'brush-outline', chip: true, chipColor: '#eeeeee' }],
  ['both colours', { name: 'star', color: '#fff', chipColor: '#000' }],
  ['with onPress', { name: 'close', onPress: () => {} }],
  ['chip + onPress + no colours', { name: 'add', chip: true, onPress: () => {} }],
];

for (const [label, props] of shapes) {
  let error = null;
  try { render(React.createElement(Icon, props)); } catch (err) { error = err; }
  check(`Icon: ${label}`, error === null, error && `${error.name}: ${error.message}`);
}

console.log('\n=== THE EXACT BUG DOES NOT COME BACK ===');
const iconSource = fs.readFileSync(path.join(root, 'components', 'Icon.js'), 'utf8');
const params = iconSource.slice(iconSource.indexOf('export default function Icon('),
  iconSource.indexOf(') {', iconSource.indexOf('export default function Icon(')));
check('no parameter default reads from `colors`', !/=\s*colors\./.test(params), params.replace(/\n/g, ' '));
check('colours are still defaulted somewhere', /colors\.accent/.test(iconSource));

console.log('\n=== NO COMPONENT DEFAULTS A PARAMETER FROM A HOOK RESULT ===');
// The general form of the trap, across the whole tree.
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : (e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));
const files = [...walk(path.join(root, 'app')), ...walk(path.join(root, 'components'))];

const offenders = [];
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/function\s+\w+\s*\(\s*\{([^}]*)\}\s*\)\s*\{/g)) {
    const paramText = m.group?.(1) ?? m[1];
    const body = src.slice(m.index + m[0].length, m.index + m[0].length + 900);
    for (const name of new Set([...paramText.matchAll(/=\s*([A-Za-z_$][\w$]*)\s*[.[]/g)].map((x) => x[1]))) {
      const declaredInBody = new RegExp(`\\b(?:const|let)\\s*(?:\\{[^}]*\\b${name}\\b|${name}\\b)`).test(body);
      if (declaredInBody) offenders.push(`${path.relative(root, file)} (${name})`);
    }
  }
}
check(`none across ${files.length} files`, offenders.length === 0, offenders.join(', '));

console.log('\n=== THE SCREEN THAT REPORTED IT ===');
// Pairing is where it surfaced: "Could not generate invite / Property
// 'colors' doesn't exist" was this crash, caught and shown as the API error.
const pairing = fs.readFileSync(path.join(root, 'app', 'PairingScreen.js'), 'utf8');
// Pairing DOES pass `color`, which is why the first guess at this bug was
// wrong. What it does not pass is chipColor - and that default was enough
// to throw on its own.
const icons = [...pairing.matchAll(/<Icon\s[^>]*\/>/g)].map((m) => m[0]);
const missingChipColor = icons.filter((t) => !t.includes('chipColor='));
check('PairingScreen renders an Icon without chipColor, which is what threw',
  missingChipColor.length > 0, icons.join(' | '));
check('and it does pass color, so passing a colour was never the fix',
  missingChipColor.some((t) => t.includes('color=')), missingChipColor.join(' | '));

console.log(`\nRENDER RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
