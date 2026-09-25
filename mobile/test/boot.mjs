// Does the app boot at all?
//
// Written after a build that installed and then showed nothing but white.
// App.js had
//
//     <Stack.Screen name="PhotoHistory" component={PhotoHistoryScreen} ... />
//
// with no import for PhotoHistoryScreen: the import went when the photo wall
// moved into PhotoSectionScreen, the route it fed stayed. That is a
// ReferenceError thrown while rendering the root, and React answers a throw
// during render by unmounting the whole tree — so there is no red box, no
// message, no partial UI. Just white, which is the least informative failure
// this app can produce.
//
// test/imports.mjs catches that particular shape statically. This catches the
// general one: it evaluates every module in the app for real and renders the
// root, so anything that throws on the way up — a bad destructure, a context
// read before its provider, a module-level call to something that is not
// there — fails here instead of on a phone.
//
// It renders TWICE. Almost every gate in this app is
// `const [loading] = useState(true)`, so a single pass only ever executes
// loading states; the second pass inverts boolean initialisers so the screen
// you actually end up looking at gets executed too. The white screen lived
// behind exactly such a gate.
//
// Everything outside the app — react-native, and every package — is a
// stand-in. The stand-ins pass their children through rather than returning
// null, which matters more than it sounds: SafeAreaProvider and
// NavigationContainer both come from packages, and a stand-in that renders
// nothing stops the walk above everything worth testing.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const babel = require('@babel/core');
const React = require('react');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const cache = new Map();
const host = (n) => n;
const rn = new Proxy({}, {
  get: (_t, p) => {
    const k = String(p);
    if (k === 'StyleSheet') return { create: (s) => s, absoluteFill: {}, flatten: (s) => s, hairlineWidth: 1, compose: (a) => a };
    if (k === 'Dimensions') return { get: () => ({ width: 390, height: 844 }), addEventListener: () => ({ remove() {} }) };
    if (k === 'Platform') return { OS: 'android', select: (o) => o.android ?? o.default, Version: 34 };
    if (k === 'Animated') return new Proxy({}, { get: (_x, q) => {
      const s = String(q);
      const AnimatedValue = class {
        constructor(v) { this.v = v; }
        setValue() {} setOffset() {} flattenOffset() {} extractOffset() {}
        interpolate() { return new AnimatedValue(0); }
        addListener() { return 1; } removeListener() {} removeAllListeners() {}
        stopAnimation(cb) { cb && cb(this.v); } resetAnimation() {}
      };
      if (s === 'Value') return AnimatedValue;
      // x and y have to be real Animated.Values, not {}: the swipe deck does
      // pan.x.interpolate(...) and a bare object fails on the test's own stub
      // rather than on the app.
      if (s === 'ValueXY') return class {
        constructor(v) { this.x = new AnimatedValue(v?.x ?? 0); this.y = new AnimatedValue(v?.y ?? 0); }
        setValue() {} setOffset() {} flattenOffset() {} extractOffset() {}
        getLayout() { return { left: this.x, top: this.y }; }
        getTranslateTransform() { return [{ translateX: this.x }, { translateY: this.y }]; }
        addListener() { return 1; } removeListener() {} removeAllListeners() {}
        stopAnimation() {} resetAnimation() {}
      };
      if (['timing','spring','decay','parallel','sequence','stagger','loop','delay','event'].includes(s)) return () => ({ start(cb){ cb && cb({finished:true}); }, stop(){}, reset(){} });
      if (s === 'add' || s === 'subtract' || s === 'multiply' || s === 'divide' || s === 'modulo') return () => ({ interpolate: () => ({}) });
      if (s === 'createAnimatedComponent') return (c) => c;
      return host(`Animated.${s}`);
    }});
    if (k === 'PanResponder') return { create: () => ({ panHandlers: {} }) };
    if (k === 'Alert') return { alert() {} };
    if (k === 'Keyboard') return { addListener: () => ({ remove() {} }), dismiss() {} };
    if (k === 'AppState') return { addEventListener: () => ({ remove() {} }), currentState: 'active' };
    if (k === 'Appearance') return { getColorScheme: () => 'light', addChangeListener: () => ({ remove() {} }) };
    if (k === 'AccessibilityInfo') return { isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove() {} }) };
    if (k === 'InteractionManager') return { runAfterInteractions: (f) => { f && f(); return { cancel(){} }; } };
    if (k === 'NativeModules') return {};
    if (k === 'Linking') return { addEventListener: () => ({ remove() {} }), getInitialURL: async () => null, openURL: async () => {} };
    if (k === 'Share') return { share: async () => ({}) };
    if (k === 'Vibration') return { vibrate() {} };
    if (k === 'LayoutAnimation') return { configureNext() {}, Presets: {} };
    if (k === 'UIManager') return { setLayoutAnimationEnabledExperimental() {} };
    if (k === 'PixelRatio') return { get: () => 3, roundToNearestPixel: (n) => n, getFontScale: () => 1 };
    if (k === 'I18nManager') return { isRTL: false };
    if (k === 'useWindowDimensions') return () => ({ width: 390, height: 844 });
    if (k === 'useColorScheme') return () => 'light';
    return host(k);
  },
});

// Two passes. `flip` inverts every boolean useState initialiser, which is a
// blunt instrument and exactly the right one here: almost every gate in this
// app is `const [loading, setLoading] = useState(true)`, and rendering only
// the initial state means the screen you actually end up looking at is never
// executed. The white screen lived behind one of those gates.
let flip = false;
const hooks = {
  useState: (v) => {
    const initial = typeof v === 'function' ? v() : v;
    return [flip && typeof initial === 'boolean' ? !initial : initial, () => {}];
  },
  useRef: (v) => ({ current: v, stopAnimation() {}, setValue() {} }),
  useEffect: () => {}, useLayoutEffect: () => {},
  useMemo: (f) => f(), useCallback: (f) => f,
  // Real provider values, tracked by the walker below. Returning {} here
  // instead would mean every useTheme() in the app destructures undefined,
  // and the test would fail on its own stub rather than on the app.
  useContext: (c) => {
    if (provided.has(c)) return provided.get(c);
    return c && c._currentValue !== undefined ? c._currentValue : {};
  },
  useReducer: (r, i) => [i, () => {}],
  useImperativeHandle: () => {}, useDebugValue: () => {},
};
const reactStub = { ...React, ...hooks };

function load(rel) {
  if (cache.has(rel)) return cache.get(rel);
  const file = path.join(root, rel);
  const { code } = babel.transformSync(fs.readFileSync(file, 'utf8'), {
    filename: file,
    presets: [['@babel/preset-env', { targets: { node: 'current' } }], ['@babel/preset-react', { runtime: 'classic' }]],
    babelrc: false, configFile: false,
  });
  const mod = { exports: {} };
  cache.set(rel, mod.exports);
  const req = (id) => {
    if (id === 'react') return reactStub;
    if (id === 'react-native') return rn;
    if (id.startsWith('.')) {
      if (/\.(png|jpe?g|gif|webp|svg|json|ttf|otf|mp3|wav)$/i.test(id)) {
        const f = path.join(root, path.dirname(rel), id);
        if (id.endsWith('.json')) return JSON.parse(fs.readFileSync(f, 'utf8'));
        return { __asset: true, uri: id, width: 600, height: 990 };
      }
      const resolved = path.join(path.dirname(rel), id);
      if (fs.existsSync(path.join(root, resolved)) && fs.statSync(path.join(root, resolved)).isFile()) return load(resolved);
      if (fs.existsSync(path.join(root, `${resolved}.js`))) return load(`${resolved}.js`);
      if (fs.existsSync(path.join(root, resolved, 'index.js'))) return load(path.join(resolved, 'index.js'));
      throw new Error(`cannot resolve ${id} from ${rel}`);
    }
    return ghost(id);
  };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, req);
  cache.set(rel, mod.exports);
  return mod.exports;
}

// Anything not in the app and not react-native becomes a recursive stand-in:
// callable (so `Notifications.setNotificationHandler(...)` works), indexable
// to any depth (so `Notifications.AndroidImportance.HIGH` works), and usable
// as a component type (so <BlurView> renders).
function ghost(name) {
  const fn = function Ghost() { return null; };
  fn.displayName = name;
  return new Proxy(fn, {
    get: (t, p) => {
      const k = String(p);
      if (k === '__esModule') return true;
      if (k === 'displayName' || k === 'name') return name;
      if (p === Symbol.toPrimitive || k === 'toString') return () => name;
      // Array-destructured hooks are everywhere in this codebase
      // (`const [permission, request] = useCameraPermissions()`), so a
      // stand-in has to be iterable or the test fails on itself.
      if (p === Symbol.iterator) {
        return function* iterate() { for (let i = 0; i < 4; i += 1) yield ghost(`${name}[${i}]`); };
      }
      if (k === 'prototype') return t.prototype;
      if (k === 'then') return undefined;   // must not look like a promise
      return ghost(`${name}.${k}`);
    },
    // Rendering children rather than null is the whole difference between a
    // smoke test and a no-op: SafeAreaProvider, NavigationContainer and every
    // other provider in the tree comes from a package, and a stand-in that
    // returns null stops the walk at the first one — which is above
    // everything worth testing.
    apply: (_t, _this, args) => {
      const props = args[0];
      // Called as a component with children: be a provider and pass them
      // through, or the walk stops at SafeAreaProvider and never reaches the
      // app. Called as a factory (createNativeStackNavigator()): hand back
      // another stand-in, so `Stack.Navigator` is something rather than null.
      if (props && typeof props === 'object' && props.children !== undefined) return props.children;
      return ghost(`${name}()`);
    },
    construct: () => ({}),
  });
}

// What each context is currently providing, as the walk descends.
const provided = new Map();

// Every screen the walk has executed, so the test can say how much of the
// app it actually covered rather than just "no exception".
const screens = [];

const navStub = {
  navigate() {}, push() {}, goBack() {}, replace() {}, popToTop() {},
  setOptions() {}, setParams() {}, dispatch() {}, reset() {},
  addListener: () => () => {},
  removeListener() {},
  isFocused: () => true,
  canGoBack: () => true,
  getParent: () => navStub,
  getState: () => ({ index: 0, routes: [] }),
};

function render(el, depth = 0) {
  if (el === null || el === undefined || typeof el !== 'object') return;
  if (Array.isArray(el)) { el.forEach((e) => render(e, depth)); return; }
  if (depth > 60) return;
  const { type, props } = el;

  // <Stack.Screen component={LoginScreen} /> hands the screen over as a
  // PROP, so a walk that only follows children never executes a single
  // screen in the app — which is most of it. This has to come BEFORE the
  // function branch below, because Stack.Screen is itself a stand-in
  // function and that branch would swallow the element whole.
  if (typeof props?.component === 'function') {
    screens.push(props.name || props.component.displayName || props.component.name || 'anon');
    render(React.createElement(props.component, {
      navigation: navStub,
      route: { key: `${props.name}-1`, name: props.name || 'Screen', params: {} },
    }), depth + 1);
    return;
  }

  if (typeof type === 'function') {
    const out = type.prototype?.isReactComponent ? new type(props).render() : type(props);
    render(out, depth + 1);
    return;
  }

  // <SomeContext.Provider value={...}> — remember the value for the subtree,
  // then put back whatever was there, since a context can be nested.
  const context = type && typeof type === 'object' ? type._context : null;
  if (context) {
    const had = provided.has(context);
    const previous = provided.get(context);
    provided.set(context, props.value);
    if (props?.children) render(props.children, depth + 1);
    if (had) provided.set(context, previous); else provided.delete(context);
    return;
  }

  if (props?.children) render(props.children, depth + 1);
}

const App = load('App.js').default;
console.log('=== THE APP BOOTS ===');
let failures = 0;
for (const [label, value] of [['as it first paints', false], ['once its gates have resolved', true]]) {
  flip = value;
  cache.clear();
  screens.length = 0;
  try {
    render(React.createElement(load('App.js').default, {}));
    console.log(`  PASS  the app boots ${label} (${screens.length} screens rendered)`);
  } catch (e) {
    failures += 1;
    console.log(`  FAIL  the app boots ${label} :: ${e.name}: ${e.message}`);
    console.log(`        after rendering ${screens.length}: ${screens.slice(-6).join(' → ')}`);
  }
}
console.log(`\nBOOT RESULT — PASSED: ${2 - failures}  FAILED: ${failures}`);
process.exit(failures ? 1 : 0);
