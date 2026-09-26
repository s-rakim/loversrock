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

/**
 * The pixel size of a JPEG or PNG, read from its header.
 *
 * Needed because Character sizes its box from the artwork's own aspect ratio,
 * and a stub that reports the wrong shape would let a real mismatch through.
 * Twenty lines of header parsing beats a dependency for two formats.
 */
function imageSize(file) {
  if (!fs.existsSync(file)) return [0, 0];
  const buf = fs.readFileSync(file);
  // PNG: IHDR width/height are big-endian at bytes 16 and 20.
  if (buf.slice(1, 4).toString('latin1') === 'PNG') {
    return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  }
  // JPEG: walk the segments to the first start-of-frame, which carries the
  // dimensions. Everything before it is metadata of some length.
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      // SOF0..SOF15, skipping the four that are not frame headers.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return [0, 0];
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
      // An image require() is resolved by Metro into an asset descriptor, not
      // a module. Without this the loader tries to read me-neutral.jpg as
      // JavaScript, which is not a bug in the app.
      if (/\.(png|jpe?g|gif|webp|svg)$/i.test(id)) {
        const file = path.join(root, path.dirname(relative), id);
        const [width, height] = imageSize(file);
        return { __asset: true, uri: id, width, height };
      }
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
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
};

// Art is supplied now, so the real manifest returns a photograph and the
// drawn character is never reached. These two load it with the art switched
// OFF, because the drawing is still what a person with no art of their own
// gets and it still has to be right.
// The hook that fills the mascot store talks to the server and the widget
// bridge; the components under test only need it to hand back the store.
const hookStub = {
  __esModule: true,
  default: () => ({ owners: { me: 'a', partner: 'b' }, pictures: { me: null, partner: null } }),
  refreshMascotOwners: () => Promise.resolve(),
};

const noArt = {
  ART_SETS: {}, PAIR_ART: null,
  artFor: () => null, hasArtFor: () => false, HAS_ART: false,
  headFor: () => ({ cx: 0.5, cy: 0.2, h: 0.36 }),
  getMascotOwners: () => ({ me: 'a', partner: 'b' }),
  subscribeMascotOwners: () => () => {},
  setMascotOwners: () => {},
};
const Character = load('components/Character.js', {
  react: reactStub,
  './ThemeContext': themeStub,
  '../assets/mascot': noArt, './useMascotOwners': hookStub,
}).default;
const CharacterMod = load('components/Character.js', {
  react: reactStub, './ThemeContext': themeStub, '../assets/mascot': noArt, './useMascotOwners': hookStub,
});

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
const MOODS = Object.keys(load('components/Mascot.js', {
  react: reactStub, './ThemeContext': themeStub, '../assets/mascot': noArt, './useMascotOwners': hookStub,
}).EXPRESSIONS);

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
const Mascot = load('components/Mascot.js', {
  react: reactStub, './ThemeContext': themeStub, '../assets/mascot': noArt, './useMascotOwners': hookStub,
}).default;

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

console.log('\n=== SUPPLIED ARTWORK IS USED AS SUPPLIED ===');
// The drawn character is a stand-in for having no art, not a style choice.
// When there is a picture of the actual person, showing a vector
// approximation of them instead would be strictly worse — so art wins, and
// it is drawn with no tint, no recolouring and no clothes painted over it.
const fakeArt = { uri: 'art://me-neutral.jpg', width: 315, height: 760 };
const artStub = {
  ART_SETS: { a: { neutral: fakeArt }, b: { neutral: null } },
  PAIR_ART: null,
  artFor: (mood, who) => (who === 'me' ? fakeArt : null),
  hasArtFor: (who) => who === 'me',
  HAS_ART: true,
  headFor: (who) => (who === 'me' ? { cx: 0.29, cy: 0.17, h: 0.34 } : { cx: 0.75, cy: 0.16, h: 0.34 }),
  getMascotOwners: () => ({ me: 'a', partner: 'b' }),
  subscribeMascotOwners: () => () => {},
  setMascotOwners: () => {},
};
const CharacterArt = load('components/Character.js', {
  react: reactStub,
  './ThemeContext': themeStub,
  '../assets/mascot': artStub, './useMascotOwners': hookStub,
}).default;

const withArt = attrs(React.createElement(CharacterArt, { avatar: {}, mood: 'happy', who: 'me', height: 120 }));
check('a person with art renders their image', withArt.some((p) => p.source === fakeArt), withArt.map((p) => p.source));
check('and nothing is drawn over it', !withArt.some((p) => typeof p.fill === 'string'), withArt.filter((p) => p.fill).length);
// Nothing cropped and nothing stretched. That used to mean `contain`, which
// letterboxed a 0.4-wide crop inside the drawn character's 0.51-wide box with
// dead space down both sides. The box is now sized from the ARTWORK, so
// `cover` fills it exactly and loses nothing — which is the property worth
// asserting rather than the prop that happens to achieve it.
const box = withArt.find((p) => p.style && !Array.isArray(p.style) === false);
const frame = withArt.map((p) => (Array.isArray(p.style) ? p.style : [p.style]))
  .flat().find((st) => st && st.width && st.height);
check('the image box is the artwork\u2019s own shape, so nothing is cropped',
  frame && Math.abs((frame.width / frame.height) - (fakeArt.width / fakeArt.height)) < 0.01,
  frame);
check('and it fills that box rather than letterboxing inside it',
  withArt.some((p) => p.resizeMode === 'cover'), withArt.map((p) => p.resizeMode));
// No tint prop anywhere, because "use it as it is" means exactly that.
check('no tint is applied to it', !withArt.some((p) => p.tintColor), withArt.map((p) => p.tintColor));

const withoutArt = attrs(React.createElement(CharacterArt, { avatar: {}, mood: 'happy', who: 'partner', height: 120 }));
check('a person with NO art still falls back to the drawing',
  !withoutArt.some((p) => p.source) && withoutArt.some((p) => typeof p.fill === 'string'));

// The two characters take identical props, so nothing but `who` can say
// whose artwork a given one is.
const charSrc = fs.readFileSync(path.join(root, 'components', 'Character.js'), 'utf8');
check('Character takes an explicit `who`', /who = 'partner'/.test(charSrc));
const sites = [...walk(path.join(root, 'app')), ...walk(path.join(root, 'components'))]
  .flatMap((f) => [...fs.readFileSync(f, 'utf8').matchAll(/<Character\s[^>]*\/>/g)].map((m) => m[0]));
check(`all ${sites.length} call sites say whose character it is`,
  sites.every((t) => /who="(me|partner)"/.test(t)), sites.join(' | '));

// The wardrobe cannot dress a photograph, and must not claim to.
const wardrobe = fs.readFileSync(path.join(root, 'app', 'WardrobeScreen.js'), 'utf8');
check('the wardrobe says so when art is in use', /hasArtFor\('me'\)/.test(wardrobe));

console.log('\n=== MASCOTS ARE UPLOADED PICTURES, NOT PRESETS ===');
// No preset artwork ships any more: each person uploads their own picture,
// and with none they are drawn. This drives the real store.
const realArt = load('assets/mascot/index.js');
check('the preset pictures are gone from the app bundle',
  !['me-neutral.jpg', 'partner-neutral.jpg', 'pair.jpg'].some((f) => fs.existsSync(path.join(root, 'assets', 'mascot', f))));
check('nothing uploaded means the character is drawn',
  realArt.artFor('neutral', 'me') === null && realArt.artFor('neutral', 'partner') === null && !realArt.hasArtFor('me'));

let heard = 0;
const unsubscribe = realArt.subscribeMascotOwners(() => { heard += 1; });
realArt.setMascotResolver((key) => `https://server/media/${key}?token=t`);
realArt.setMascotPictures({
  me: { key: 'mascots/u1/me.png', width: 400, height: 1000 },
  partner: { key: 'mascots/u2/her.jpg', width: 800, height: 800 },
});
const mine = realArt.artFor('happy', 'me');
check('an upload becomes an image source through /media', mine?.uri === 'https://server/media/mascots/u1/me.png?token=t', mine);
check('  carrying its size, so the frame is right before it loads', mine?.width === 400 && mine?.height === 1000, mine);
check('  whatever the mood', realArt.artFor('sad', 'me')?.uri === mine.uri);
check("  and the partner's is theirs, not mine", realArt.artFor('neutral', 'partner')?.uri.includes('her.jpg'));
check('whatever draws a mascot is told to re-render', heard >= 2, heard);
check('a tall picture is cropped to the head near the top', realArt.headFor('me').cy < 0.3 && realArt.headFor('me').h < 1);
check('a square one is shown whole', realArt.headFor('partner').h === 1);

realArt.setMascotResolver(() => null);
check('with no token yet there is no URL, so it draws instead of showing a broken image', realArt.artFor('neutral', 'me') === null);
realArt.setMascotResolver((key) => `u/${key}`);

const before = heard;
realArt.setMascotPictures({ me: { key: 'mascots/u1/me.png', width: 400, height: 1000 }, partner: { key: 'mascots/u2/her.jpg', width: 800, height: 800 } });
check('the same pictures again change nothing', heard === before, heard - before);
realArt.setMascotPictures({ me: null, partner: { key: 'mascots/u2/her.jpg', width: 800, height: 800 } });
check('removing mine goes back to drawing me', realArt.artFor('neutral', 'me') === null && realArt.artFor('neutral', 'partner') !== null);
realArt.setMascotPictures({ me: { key: 42 }, partner: 'nonsense' });
check('garbage from the server is treated as no picture', !realArt.hasArtFor('me') && !realArt.hasArtFor('partner'));

// Which side each of you stands on in the distance widget.
realArt.setMascotOwners('b');
check('told "you are b", you stand on the left', realArt.mascotArtOf('me') === 'b' && realArt.mascotArtOf('partner') === 'a');
realArt.setMascotOwners('z');
check('a nonsense side changes nothing', realArt.getMascotOwners().me === 'b');
realArt.setMascotOwners('a');
unsubscribe();


console.log('\n=== THE SECTION BAR, WHICH THE BUILD SERVER FOUND MISSING ===');

// PhotoSectionScreen and PlaySectionScreen both imported withSectionBar from
// a file that did not exist. Every static check passed; the first thing that
// noticed was a release build, which failed at
// ':app:createBundleReleaseJsAndAssets' with "node finished with non-zero
// exit value 1" and nothing more specific. test/imports.mjs now catches the
// missing file. This catches the next question, which is whether the thing
// that replaced it actually runs.

const sectionTheme = {
  useTheme: () => ({
    colors: {
      accent: '#d9647f', accentSoft: '#fbe4ea', textMuted: '#8a8189',
      glassBorder: 'rgba(255,255,255,0.4)', iconGlyph: '#8a3550', iconChip: '#fbe4ea',
    },
    font: { muted: { fontSize: 12 } },
    reduceMotion: false,
    isDark: false,
  }),
};

// A glyph map with the outline variants in it, so outlineOf is genuinely
// exercised rather than silently falling back because the stub was empty.
const glyphMap = {};
for (const n of ['brush', 'game-controller', 'grid', 'home', 'chatbubble']) {
  glyphMap[n] = 1;
  glyphMap[`${n}-outline`] = 1;
}

const insetsSeen = [];
const sectionStubs = {
  // The same hook stub the mascot tests use: this walker calls components
  // directly rather than through a reconciler, so real hooks have no
  // dispatcher to attach to.
  react: reactStub,
  './ThemeContext': sectionTheme,
  './GlassContext': { useGlass: () => ({ intensity: 55 }) },
  // Ionicons renders to a marker the walker below can find, rather than to
  // null: the whole point of these three checks is WHICH glyph and colour
  // came out, and a stub that returns nothing discards exactly that.
  '@expo/vector-icons': {
    Ionicons: Object.assign((props) => ({ type: 'Ionicons', props }), { glyphMap }),
  },
  'react-native-safe-area-context': {
    useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
    SafeAreaInsetsContext: {
      Provider: (props) => { insetsSeen.push(props.value); return props.children; },
    },
  },
};

const SectionBarMod = load('components/SectionBar.js', sectionStubs);

/** Every element in a tree whose type matches, with its props. */
function collect(element, wanted, out = [], depth = 0) {
  if (element === null || element === undefined || typeof element !== 'object') return out;
  if (Array.isArray(element)) { element.forEach((e) => collect(e, wanted, out, depth)); return out; }
  if (depth > 14) return out;
  const { type, props } = element;
  if (type === wanted) out.push(props);
  if (typeof type === 'function') { collect(type(props), wanted, out, depth + 1); return out; }
  if (props?.children) collect(props.children, wanted, out, depth + 1);
  return out;
}

// The two real item sets, read off the screens rather than retyped, so this
// keeps testing what actually ships.
const sectionSets = ['PhotoSectionScreen', 'PlaySectionScreen'].map((name) => {
  const src = fs.readFileSync(path.join(root, 'app', `${name}.js`), 'utf8');
  const body = src.match(/const ITEMS = \[([\s\S]*?)\];/)[1];
  const items = [...body.matchAll(/key: '([^']+)', icon: '([^']+)', label: '([^']+)'/g)]
    .map(([, key, icon, label]) => ({ key, icon, label }));
  return { name, items };
});

for (const { name, items } of sectionSets) {
  check(`${name} declares its items`, items.length >= 2, JSON.stringify(items));

  for (const active of items) {
    let error = null;
    let presses = [];
    try {
      const el = React.createElement(SectionBarMod.SectionBar, {
        items, active: active.key, onSelect: (k) => presses.push(k),
      });
      const buttons = collect(el, 'Pressable');
      check(`  ${name}/${active.key}: one button per item`,
        buttons.length === items.length, `${buttons.length} vs ${items.length}`);

      // Pressing the one you are already on must do nothing: navigate() to
      // the current screen pushes a duplicate, and the slide animation makes
      // that very visible.
      buttons.forEach((b) => b.onPress());
      check(`  ${name}/${active.key}: tapping the active item is inert`,
        !presses.includes(active.key), presses.join(','));
      check(`  ${name}/${active.key}: every other item navigates`,
        presses.length === items.length - 1, presses.join(','));
    } catch (e) { error = e; }
    check(`  ${name}/${active.key}: renders`, error === null, error && `${error.name}: ${error.message}`);
  }
}

// The active item has to be distinguishable by more than position.
{
  const { items } = sectionSets[0];
  const el = React.createElement(SectionBarMod.SectionBar, {
    items, active: items[1].key, onSelect: () => {},
  });
  const icons = collect(el, 'Ionicons');
  const accent = icons.filter((i) => i.color === '#d9647f');
  check('exactly one icon is drawn in the accent colour', accent.length === 1, icons.map((i) => i.color).join(' '));
  check('the active icon is the larger one',
    accent[0] && accent[0].size > icons.filter((i) => i.color !== '#d9647f')[0].size,
    icons.map((i) => `${i.name}:${i.size}`).join(' '));
  check('and the inactive ones are drawn as outlines',
    icons.filter((i) => i.name.endsWith('-outline')).length === items.length - 1,
    icons.map((i) => i.name).join(' '));
}

// The reason withSectionBar overrides the inset: without it, a screen that
// pads for the notch pads again below a bar that already cleared it.
{
  insetsSeen.length = 0;
  let receivedProps = null;
  const Screen = (props) => { receivedProps = props; return null; };
  const Wrapped = SectionBarMod.withSectionBar(Screen, sectionSets[0].items, 'Camera');
  const nav = { navigate: () => {} };
  render(React.createElement(Wrapped, { navigation: nav, route: { name: 'Camera' } }));

  check('the wrapped screen is told the notch is already covered',
    insetsSeen.length === 1 && insetsSeen[0].top === 0, JSON.stringify(insetsSeen));
  check('but keeps the bottom inset, which nothing above it covers',
    insetsSeen[0] && insetsSeen[0].bottom === 34, JSON.stringify(insetsSeen[0]));
  check('and still receives its own navigation and route',
    receivedProps?.navigation === nav && receivedProps?.route?.name === 'Camera',
    JSON.stringify(Object.keys(receivedProps || {})));
}

console.log('\n=== THE MOOD PICKER ===');
{
  const bar = fs.readFileSync(path.join(root, 'components', 'MoodBar.js'), 'utf8');
  const mascot = fs.readFileSync(path.join(root, 'components', 'Mascot.js'), 'utf8');
  // Every swatch showed the same photograph — there is only neutral art so
  // far — so eleven moods looked identical, and it was their face while you
  // picked yours.
  check('the swatches are drawn faces, which differ by mood',
    /<Mascot mood=\{id\} size=\{54\} animated=\{false\} drawn \/>/.test(bar));
  check('and Mascot can be asked for one', /drawn = false/.test(mascot) && /drawn \? null : artFor/.test(mascot));
  check('a photograph cannot spill past its square', /overflow: 'hidden'/.test(mascot));
  // colors.surface is a translucent card tint; the Home screen showed through.
  check('the sheet is opaque', /sheet: \{[^}]*backgroundColor: colors\.background/.test(bar));
  // 'They' was being used as a name: "No mood from They yet", "They sees this".
  check('"They" is never used as a name', !/\|\| 'They'/.test(bar) && !/\{who\} sees/.test(bar));
  check('and the picker says whose mascot it is', /sees this on your mascot/.test(bar));
  // A refused save used to vanish — no catch — so tapping a mood before
  // pairing did nothing at all, and the moods looked like decoration.
  check('a refused mood save is caught, not dropped',
    /async function choose[\s\S]*?catch \(err\)[\s\S]*?setPickError/.test(bar));
  check('and before pairing it says why, in the sheet',
    /isUnpaired\(err\)[\s\S]{0,120}sends once you are paired/.test(bar) && /\{pickError \?/.test(bar));
}

console.log(`\nRENDER RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
