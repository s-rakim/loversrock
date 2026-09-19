// Checks the theme contract without a device: that both schemes define the
// same tokens, that text meets WCAG AA against what it actually sits on, and
// that no screen has drifted back to importing static colours.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const babel = require('@babel/core');

let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${d ?? ''}`); } };

// theme.js is ESM with JSX-free exports; transpile and eval it.
const src = fs.readFileSync(new URL('../theme.js', import.meta.url), 'utf8');
const { code } = babel.transformSync(src, {
  filename: 'theme.js',
  presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
  babelrc: false, configFile: false,
});
const module_ = { exports: {} };
new Function('module', 'exports', 'require', code)(module_, module_.exports, require);
const { lightColors, darkColors, makeFont, radius, spacing } = module_.exports;

// ---------- colour maths ----------
const parse = (c) => {
  if (c.startsWith('#')) {
    const n = parseInt(c.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  const [r, g, b, a = 1] = m[1].split(',').map(Number);
  return [r, g, b, a];
};
/** Flattens a translucent colour onto its backdrop, as the screen does. */
const over = (fg, bg) => {
  const [r, g, b, a] = parse(fg); const [br, bg_, bb] = parse(bg);
  return [r * a + br * (1 - a), g * a + bg_ * (1 - a), b * a + bb * (1 - a), 1];
};
const luminance = ([r, g, b]) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (fg, bg) => {
  const a = luminance(over(fg, bg)), b = luminance(parse(bg));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

console.log('=== TOKEN PARITY ===');
const lk = Object.keys(lightColors).sort(), dk = Object.keys(darkColors).sort();
check('light and dark define the same tokens', JSON.stringify(lk) === JSON.stringify(dk),
  `only light: ${lk.filter((k) => !dk.includes(k))} | only dark: ${dk.filter((k) => !lk.includes(k))}`);
for (const token of ['background', 'card', 'textPrimary', 'textSecondary', 'accentPink', 'accentIndigo', 'period', 'fertility', 'tabBarActivePill']) {
  check(`both schemes define ${token}`, Boolean(lightColors[token] && darkColors[token]));
}
check('accentPink is the same in both schemes', lightColors.accentPink === darkColors.accentPink);
check('shape language is shared', radius.card === 24 && radius.pill === 999 && spacing.lg === 24);

console.log('\n=== WCAG AA CONTRAST (4.5:1 body text) ===');
for (const [name, colors] of [['light', lightColors], ['dark', darkColors]]) {
  const surfaces = { background: colors.background, card: over(colors.card, colors.background) };
  for (const [sName, surface] of Object.entries(surfaces)) {
    const bg = Array.isArray(surface) ? `rgb(${surface.slice(0, 3).map(Math.round).join(',')})` : surface;
    for (const text of ['textPrimary', 'textSecondary']) {
      const ratio = contrast(colors[text], bg);
      check(`${name}: ${text} on ${sName} >= 4.5 (${ratio.toFixed(2)})`, ratio >= 4.5, ratio.toFixed(2));
    }
  }
}

console.log('\n=== LAVA LAMP TOKENS ===');
for (const [name, colors] of [['light', lightColors], ['dark', darkColors]]) {
  check(`${name}: has a blob palette`, Array.isArray(colors.blobs) && colors.blobs.length >= 3, colors.blobs?.length);
  check(`${name}: blob opacity is sane`, colors.blobOpacity > 0 && colors.blobOpacity <= 1, colors.blobOpacity);
  check(`${name}: background is a two-stop gradient`,
    Array.isArray(colors.backgroundGradient) && colors.backgroundGradient.length === 2, colors.backgroundGradient);
  check(`${name}: surface is translucent so the animation shows through`,
    colors.surface.startsWith('rgba'), colors.surface);
}

console.log('\n=== NO SCREEN IMPORTS STATIC COLOURS ===');
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out); else if (f.endsWith('.js')) out.push(f);
  }
  return out;
};
const root = new URL('..', import.meta.url).pathname;
const screens = [...walk(path.join(root, 'app')), ...walk(path.join(root, 'components'))]
  .filter((f) => !/Motion\.js|GlassContext\.js|ThemeContext\.js/.test(f));
const offenders = screens.filter((f) => {
  const text = fs.readFileSync(f, 'utf8');
  return /import \{[^}]*\b(colors|font)\b[^}]*\} from '[^']*theme'/.test(text);
});
check(`no static colour imports across ${screens.length} screens/components`, offenders.length === 0,
  offenders.map((f) => path.relative(root, f)).join(', '));

const missing = screens.filter((f) => {
  const text = fs.readFileSync(f, 'utf8');
  return /\bcolors\.|(^|[^.\w])font\./.test(text) && !text.includes('useTheme');
});
check('every screen that uses tokens calls useTheme()', missing.length === 0,
  missing.map((f) => path.relative(root, f)).join(', '));

console.log('\n=== BACKGROUND IS NOT PAINTED OVER ===');
const painted = screens.filter((f) => /backgroundColor: colors\.bg\b/.test(fs.readFileSync(f, 'utf8')));
check('no screen paints colors.bg over the lava lamp', painted.length === 0,
  painted.map((f) => path.relative(root, f)).join(', '));

const lava = fs.readFileSync(path.join(root, 'components', 'LavaLamp.js'), 'utf8');
check('blob motion uses the native driver', /useNativeDriver: true/.test(lava));
// Match imports only - the file explains in prose why those libraries are
// not used, and that explanation should not trip the check.
const lavaImports = (lava.match(/^import .*$/gm) || []).join('\n');
check('no Reanimated or Skia imported', !/reanimated|react-native-skia/i.test(lavaImports), lavaImports);
check('animation pauses when backgrounded', /AppState/.test(lava));
check('reduce motion is honoured', /reduceMotion/.test(lava));

const ctx = fs.readFileSync(path.join(root, 'components', 'ThemeContext.js'), 'utf8');
check('reduce motion follows the OS setting', /AccessibilityInfo/.test(ctx));

console.log(`\nTHEME RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
