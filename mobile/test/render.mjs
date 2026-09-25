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
    if (id === 'react') return extraStubs.react || React;
    if (id === 'react-native') return rn;
    if (extraStubs[id]) return extraStubs[id];
    if (id.startsWith('.')) {
      // Resolve sibling modules through the same loader.
      const resolved = path.join(path.dirname(relative), id);
      if (resolved.endsWith('.js')) return load(resolved, extraStubs);
      if (fs.existsSync(path.join(root, `${resolved}.js`))) return load(`${resolved}.js`, extraStubs);
      return load(path.join(resolved, 'index.js'), extraStubs);   // a folder module
    }
    // Anything else (vector icons, svg, gradients) becomes a host component.
    return new Proxy(() => null, {
      // Reported as an ES module so that a file importing BOTH a default and
      // named bindings from it (Character does: Svg plus Path, Circle, Defs)
      // gets host components for all of them rather than undefined.
      get: (_t, prop) => host(String(prop)),
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

console.log('\n=== THE CHARACTER IS SHADED, NOT BROKEN ===');
// `shade()` parses a hex string. Once the figure was given real materials,
// every garment started being filled with a gradient REFERENCE —
// `url(#c1a2b3-top)` — and any sub-component that still called
// `shade(colour, -20)` on that produced `#nannannan`, which renders as
// nothing at all. The fix was to pass the flat hex alongside the gradient;
// this is the test that the two never get confused again.
//
// Hooks are unavailable to this walker (it calls components directly), so
// React's hook API is stubbed out for the modules that use it.
const reactStub = {
  ...React,
  useRef: (v) => ({ current: v, stopAnimation() {}, setValue() {} }),
  useEffect: () => {},
  useMemo: (f) => f(),
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useCallback: (f) => f,
  useContext: () => ({}),
};

const Character = load('components/Character.js', {
  react: reactStub,
  './ThemeContext': themeStub,
}).default;
const CharacterMod = load('components/Character.js', { react: reactStub, './ThemeContext': themeStub });

/** Every fill/stroke the figure paints with, flattened out of the tree. */
function paints(element, out = [], depth = 0) {
  if (element === null || element === undefined || typeof element !== 'object') return out;
  if (Array.isArray(element)) { element.forEach((e) => paints(e, out, depth)); return out; }
  if (depth > 14) return out;
  const { type, props } = element;
  if (typeof type === 'function') { paints(type(props), out, depth + 1); return out; }
  for (const key of ['fill', 'stroke', 'stopColor']) {
    const v = props?.[key];
    if (typeof v === 'string') out.push(v);
  }
  if (props?.children) paints(props.children, out, depth + 1);
  return out;
}

const HAIRS = ['short', 'bald', 'fade', 'afro', 'locs', 'curls', 'long', 'ponytail', 'braids', 'bun'];
const TOPS = ['tee', 'dress', 'tank', 'hoodie', 'jersey', 'shirt', 'longSleeve', 'jumper'];
const BOTTOMS = ['jeans', 'trousers', 'skirt', 'shorts', 'cargo', 'joggers'];
const SHOES = ['sneakers', 'boots', 'slides', 'barefoot'];
const ACCESSORIES = ['none', 'glasses', 'earrings', 'cap', 'beanie', 'chain', 'headphones'];
const MOODS = Object.keys(load('components/Mascot.js', { react: reactStub, './ThemeContext': themeStub }).EXPRESSIONS);

const bad = [];
let combos = 0;
const isPaint = (v) => v === 'none' || v === 'transparent'
  || /^url\(#[A-Za-z0-9-]+\)$/.test(v) || /^#[0-9a-fA-F]{3,8}$/.test(v);

for (const hair of HAIRS) {
  for (const top of TOPS) {
    for (const [i, bottom] of BOTTOMS.entries()) {
      const avatar = {
        skin: Object.keys(CharacterMod.SKINS)[i % 6],
        hair,
        hairColor: Object.keys(CharacterMod.HAIR_COLORS)[i % 9],
        build: ['slim', 'average', 'broad'][i % 3],
        outfit: {
          top: { id: top, color: 'blue', accent: 'red' },
          bottom: { id: bottom, color: 'navy' },
          shoes: { id: SHOES[i % SHOES.length], color: 'white' },
          accessory: { id: ACCESSORIES[i % ACCESSORIES.length], color: 'black' },
        },
      };
      const mood = MOODS[combos % MOODS.length];
      combos++;
      let got;
      try {
        got = paints(React.createElement(Character, { avatar, mood, height: 120 }));
      } catch (err) {
        bad.push(`${hair}/${top}/${bottom} threw ${err.message}`);
        continue;
      }
      for (const v of got) if (!isPaint(v)) bad.push(`${hair}/${top}/${bottom}: ${v}`);
    }
  }
}
check(`every fill across ${combos} outfits is a real colour or gradient`, bad.length === 0, bad.slice(0, 6).join(' | '));

// Junk in, clothed figure out — the same contract the server's normaliser has.
let junkError = null;
try { paints(React.createElement(Character, { avatar: { skin: 'x', hair: 'x', outfit: { top: { id: 'x' } } }, mood: 'x' })); }
catch (err) { junkError = err; }
check('an unknown skin, hair, garment and mood still render', junkError === null, junkError?.message);

console.log('\n=== AND IT IS SIZED BY HEIGHT, NOT WIDTH ===');
const charSource = fs.readFileSync(path.join(root, 'components', 'Character.js'), 'utf8');
check('Character takes a height', /height = \d+/.test(charSource));
check('no `size` prop survives to confuse the aspect ratio', !/\bsize\s*=\s*\d+,/.test(charSource));
const callSites = [...walk(path.join(root, 'app')), ...walk(path.join(root, 'components'))]
  .flatMap((f) => [...fs.readFileSync(f, 'utf8').matchAll(/<Character\s[^>]*\/>/g)].map((m) => m[0]));
check(`all ${callSites.length} call sites pass height`, callSites.length > 0 && callSites.every((t) => /height=/.test(t)), callSites.join(' | '));
check('and none still pass size', !callSites.some((t) => /\ssize=/.test(t)), callSites.join(' | '));

console.log('\n=== THE MASCOT IS LIT, AND TWO OF THEM DO NOT COLLIDE ===');
const Mascot = load('components/Mascot.js', { react: reactStub, './ThemeContext': themeStub }).default;

/** Every prop object in the rendered tree. */
function attrs(element, out = [], depth = 0) {
  if (element === null || element === undefined || typeof element !== 'object') return out;
  if (Array.isArray(element)) { element.forEach((e) => attrs(e, out, depth)); return out; }
  if (depth > 14) return out;
  const { type, props } = element;
  if (typeof type === 'function') { attrs(type(props), out, depth + 1); return out; }
  if (props) out.push(props);
  if (props?.children) attrs(props.children, out, depth + 1);
  return out;
}

const mascotBad = [];
for (const mood of MOODS) {
  let got;
  try { got = attrs(React.createElement(Mascot, { mood, size: 96 })); }
  catch (err) { mascotBad.push(`${mood} threw ${err.message}`); continue; }
  for (const props of got) {
    for (const key of ['fill', 'stroke', 'stopColor']) {
      const v = props[key];
      if (typeof v === 'string' && !isPaint(v)) mascotBad.push(`${mood}: ${key}=${v}`);
    }
  }
}
check(`every mascot mood paints cleanly (${MOODS.length} moods)`, mascotBad.length === 0, mascotBad.slice(0, 6).join(' | '));

// THE COLLISION. Gradient ids are global to the SVG document, so two mascots
// (the loading screen draws a pair) declaring `id="mascotBody"` would leave
// the second one wearing the first one's mood colour. Per-instance ids.
const gradIds = (el) => attrs(el).map((p) => p.id).filter((v) => typeof v === 'string');
const first = gradIds(React.createElement(Mascot, { mood: 'happy' }));
const second = gradIds(React.createElement(Mascot, { mood: 'sad' }));
check('a mascot declares gradient ids at all', first.length >= 4, JSON.stringify(first));
check('and two mascots share none of them',
  first.every((id) => !second.includes(id)), `${first} vs ${second}`);

const charIds1 = gradIds(React.createElement(Character, { avatar: {}, mood: 'happy' }));
const charIds2 = gradIds(React.createElement(Character, { avatar: {}, mood: 'sad' }));
check('two characters share no gradient ids either',
  charIds1.length > 0 && charIds1.every((id) => !charIds2.includes(id)), `${charIds1} vs ${charIds2}`);

// A tired eye is drawn with a lid. It was once drawn at opacity 0, which is
// to say it was not drawn at all and every mood looked equally awake.
const mascotSource = fs.readFileSync(path.join(root, 'components', 'Mascot.js'), 'utf8');
check('nothing in the mascot is drawn at opacity 0', !/opacity=\{0\}/.test(mascotSource));

console.log(`\nRENDER RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
