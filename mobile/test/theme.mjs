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
const {
  lightColors, darkColors, makeFont, lineHeightFor, radius, spacing,
  ACCENT_NAMES, withAccent, MIN_BACKGROUND_INTENSITY, MAX_BACKGROUND_INTENSITY,
  BLOB_PALETTE_NAMES, withBlobs, withCustomAccent, hslToHex, glyphForAccent,
  blobStops,
} = module_.exports;

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

console.log('\n=== CONTRAST OVER THE LAVA LAMP, NOT JUST THE FLAT BACKGROUND ===');
// The check above composites text onto `background` and onto the card over
// `background`. Neither is what a screen actually shows: a blob is usually
// drifting under both. With the old pastel blobs that barely mattered; with
// blobs strong enough to SEE it matters a great deal, and getting it wrong
// means text that is readable in a screenshot and not on a phone.
//
// So: the worst case any pixel can reach — the densest blob at full blob
// opacity, over the darker gradient stop, with and without a card on top.
const paint = (blob, opacity, backdrop) => over(`rgba(${parse(blob).slice(0, 3).join(',')},${opacity})`, backdrop);
const asRgb = (t) => `rgb(${t.slice(0, 3).map(Math.round).join(',')})`;

for (const [name, colors] of [['light', lightColors], ['dark', darkColors]]) {
  const backdrops = [];
  for (const stop of colors.backgroundGradient) {
    for (const blob of colors.blobs) {
      const painted = asRgb(paint(blob, colors.blobOpacity, stop));
      backdrops.push([`blob ${blob}`, painted]);
      backdrops.push([`card over blob ${blob}`, asRgb(over(colors.card, painted))]);
    }
  }

  for (const text of ['textPrimary', 'textSecondary']) {
    const worst = backdrops.reduce((acc, [label, bg]) => {
      const r = contrast(colors[text], bg);
      return r < acc.r ? { r, label } : acc;
    }, { r: Infinity, label: '' });
    check(`${name}: ${text} stays >= 4.5 over any blob (worst ${worst.r.toFixed(2)} on ${worst.label})`,
      worst.r >= 4.5, worst.r.toFixed(2));
  }

  // The icon glyph on its own chip, over a card, over a blob. The default
  // used to be accent on accentSoft, which measured 2.02:1 — pink on pink.
  const chipWorst = backdrops
    .filter(([label]) => label.startsWith('card over'))
    .reduce((acc, [label, bg]) => {
      const chip = asRgb(over(colors.iconChip, bg));
      const r = contrast(colors.iconGlyph, chip);
      return r < acc.r ? { r, label } : acc;
    }, { r: Infinity, label: '' });
  check(`${name}: icon glyph on its chip is >= 4.5 (worst ${chipWorst.r.toFixed(2)})`,
    chipWorst.r >= 4.5, chipWorst.r.toFixed(2));
}

console.log('\n=== THE LAVA LAMP IS ACTUALLY VISIBLE ===');
// The animation was never broken. It was invisible: pale pastels drifting
// over a pale pastel gradient, about 1.05x the background's luminance, which
// is below what an eye picks up on a phone in daylight. Asserting the
// separation is the only way to stop it quietly fading back out.
for (const [name, colors] of [['light', lightColors], ['dark', darkColors]]) {
  for (const blob of colors.blobs) {
    const stop = colors.backgroundGradient[0];
    const painted = asRgb(paint(blob, colors.blobOpacity, stop));
    const separation = contrast(painted, stop);
    check(`${name}: blob ${blob} is distinguishable from the background (${separation.toFixed(2)}x)`,
      separation >= 1.25, separation.toFixed(3));
  }
}

console.log('\n=== ANY COLOUR THE PERSON PICKS IS STILL READABLE ===');
// A free colour picker is a lovely way to ship an unbounded number of
// contrast bugs. The icon shade is not chosen, it is SOLVED: derived from the
// worst backdrop the finished palette can paint, for whatever hue was picked.
//
// Two ways that went wrong while it was being written, both of which this
// sweep catches: pinning HSL lightness instead of luminance (yellow measured
// 3.52:1 while blue sailed past 7:1, because HSL lightness is not
// perceptual), and solving against the lightest backdrop when a DARK glyph is
// bound by the darkest one (2.73:1).
{
  let worstLight = Infinity; let worstDark = Infinity;
  let whereLight = ''; let whereDark = '';

  for (let deg = 0; deg < 360; deg += 15) {
    for (const saturation of [0.25, 0.6, 1]) {
      const accent = hslToHex(deg / 360, saturation, 0.55);
      for (const [scheme, base, isDark] of [['light', lightColors, false], ['dark', darkColors, true]]) {
        for (const palette of BLOB_PALETTE_NAMES) {
          const colors = withCustomAccent(withBlobs(base, palette, isDark), accent, isDark);
          for (const stop of colors.backgroundGradient) {
            for (const blob of colors.blobs) {
              const painted = asRgb(paint(blob, colors.blobOpacity, stop));
              const card = asRgb(over(colors.card, painted));
              const chip = asRgb(over(colors.iconChip, card));
              const r = Math.min(contrast(colors.iconGlyph, card), contrast(colors.iconGlyph, chip));
              if (isDark) {
                if (r < worstDark) { worstDark = r; whereDark = `${accent} on ${palette}`; }
              } else if (r < worstLight) { worstLight = r; whereLight = `${accent} on ${palette}`; }
            }
          }
        }
      }
    }
  }

  check(`light: every custom accent keeps icons >= 4.5 (worst ${worstLight.toFixed(2)}, ${whereLight})`,
    worstLight >= 4.5, worstLight.toFixed(2));
  check(`dark: every custom accent keeps icons >= 4.5 (worst ${worstDark.toFixed(2)}, ${whereDark})`,
    worstDark >= 4.5, worstDark.toFixed(2));
}

console.log('\n=== EVERY BLOB PALETTE STAYS VISIBLE AND READABLE ===');
for (const [scheme, base, isDark] of [['light', lightColors, false], ['dark', darkColors, true]]) {
  for (const palette of BLOB_PALETTE_NAMES) {
    const colors = withBlobs(base, palette, isDark);

    let worstText = Infinity;
    let leastVisible = Infinity;
    for (const stop of colors.backgroundGradient) {
      for (const blob of colors.blobs) {
        const painted = asRgb(paint(blob, colors.blobOpacity, stop));
        leastVisible = Math.min(leastVisible, contrast(painted, stop));
        worstText = Math.min(
          worstText,
          contrast(colors.textSecondary, painted),
          contrast(colors.textSecondary, asRgb(over(colors.card, painted)))
        );
      }
    }
    check(`${scheme}: "${palette}" keeps body text >= 4.5 (${worstText.toFixed(2)})`,
      worstText >= 4.5, worstText.toFixed(2));
    // A palette nobody can see is the bug this whole thing started as.
    check(`${scheme}: "${palette}" is actually visible (${leastVisible.toFixed(2)}x)`,
      leastVisible >= 1.15, leastVisible.toFixed(3));
  }
}

console.log('\n=== EVERY ACCENT PRESET IS READABLE, NOT JUST THE DEFAULT ===');
// A colour picker is a lovely way to ship five new contrast bugs. Each preset
// carries its own per-scheme glyph shade rather than deriving one, and each
// is measured here against the stack an <Icon chip> actually paints.
for (const [scheme, base, isDark] of [['light', lightColors, false], ['dark', darkColors, true]]) {
  for (const name of ACCENT_NAMES) {
    const colors = withAccent(base, name, isDark);
    let worst = Infinity;
    for (const stop of colors.backgroundGradient) {
      for (const blob of colors.blobs) {
        const painted = asRgb(paint(blob, colors.blobOpacity, stop));
        const card = asRgb(over(colors.card, painted));
        worst = Math.min(worst, contrast(colors.iconGlyph, card));
        worst = Math.min(worst, contrast(colors.iconGlyph, asRgb(over(colors.iconChip, card))));
      }
    }
    check(`${scheme}: accent "${name}" icon glyph >= 4.5 (${worst.toFixed(2)})`, worst >= 4.5, worst.toFixed(2));
  }
}

console.log('\n=== THE BACKGROUND SLIDER CANNOT BREAK THE CONTRAST IT IS MEASURED AT ===');
// Every figure above is taken at the palette's own blobOpacity. At 1.3x,
// secondary text measures 3.95:1 — so the control dims and never boosts.
check('intensity is capped at full strength', MAX_BACKGROUND_INTENSITY === 1, MAX_BACKGROUND_INTENSITY);
check('and has a floor, so it cannot be turned off into a flat screen',
  MIN_BACKGROUND_INTENSITY > 0 && MIN_BACKGROUND_INTENSITY < 1, MIN_BACKGROUND_INTENSITY);

console.log('\n=== LAVA LAMP TOKENS ===');
for (const [name, colors] of [['light', lightColors], ['dark', darkColors]]) {
  check(`${name}: has a blob palette`, Array.isArray(colors.blobs) && colors.blobs.length >= 3, colors.blobs?.length);
  check(`${name}: blob opacity is sane`, colors.blobOpacity > 0 && colors.blobOpacity <= 1, colors.blobOpacity);
  check(`${name}: background is a two-stop gradient`,
    Array.isArray(colors.backgroundGradient) && colors.backgroundGradient.length === 2, colors.backgroundGradient);
  check(`${name}: surface is translucent so the animation shows through`,
    colors.surface.startsWith('rgba'), colors.surface);
  // 0.95 is translucent by the letter and opaque to the eye. The lava lamp
  // sat behind cards that hid 95% of it, which is why it read as absent.
  check(`${name}: and translucent enough to matter`,
    parse(colors.surface)[3] <= 0.85, parse(colors.surface)[3]);
  check(`${name}: icons have their own weighted tokens`,
    Boolean(colors.iconGlyph && colors.iconChip && colors.iconChipBorder),
    { iconGlyph: colors.iconGlyph, iconChip: colors.iconChip });
}

console.log('\n=== TEXT FOLLOWS THE PHONE\u2019S FONT SETTING ===');
// React Native scales fontSize by the OS setting on its own but does NOT
// scale lineHeight. Left alone, turning the font size up grows the glyphs
// while the spacing stays put and the text closes up - which is what
// "squeezed" looked like.
const atOne = makeFont(lightColors, 1);
const atLarge = makeFont(lightColors, 1.6);
const STYLES = ['wordmark', 'h1', 'h2', 'h3', 'body', 'muted'];

for (const key of STYLES) {
  check(`${key} sets a lineHeight at all`, typeof atOne[key].lineHeight === 'number', atOne[key]);
  check(`${key} lineHeight grows with the phone setting`,
    atLarge[key].lineHeight > atOne[key].lineHeight,
    { one: atOne[key].lineHeight, large: atLarge[key].lineHeight });
  check(`${key} fontSize is NOT scaled here (RN already does it)`,
    atLarge[key].fontSize === atOne[key].fontSize,
    { one: atOne[key].fontSize, large: atLarge[key].fontSize });
  check(`${key} leaves room for its own glyphs`,
    atOne[key].lineHeight > atOne[key].fontSize,
    { size: atOne[key].fontSize, leading: atOne[key].lineHeight });
  check(`${key} leading is a whole pixel`,
    Number.isInteger(atOne[key].lineHeight), atOne[key].lineHeight);
}

check('leading scales in proportion, not by a constant',
  Math.abs(atLarge.body.lineHeight / atOne.body.lineHeight - 1.6) < 0.08,
  { ratio: atLarge.body.lineHeight / atOne.body.lineHeight });
check('body is more generously spaced than a heading, as running text should be',
  atOne.body.lineHeight / atOne.body.fontSize > atOne.h1.lineHeight / atOne.h1.fontSize,
  { body: atOne.body.lineHeight / atOne.body.fontSize, h1: atOne.h1.lineHeight / atOne.h1.fontSize });
check('the helper for one-off text follows the same rule',
  lineHeightFor(12, 2) === Math.round(12 * 1.4 * 2), lineHeightFor(12, 2));
check('a missing scale defaults to 1 rather than collapsing to zero',
  makeFont(lightColors).body.lineHeight === atOne.body.lineHeight);

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
console.log('\n=== THE PROVIDER ACTUALLY READS THE SETTING ===');
const ctxSource = fs.readFileSync(path.join(root, 'components', 'ThemeContext.js'), 'utf8');
check('it reads fontScale from the OS', /useWindowDimensions\(\)/.test(ctxSource));
check('and passes it to makeFont', /makeFont\(colors,\s*fontScale\b/.test(ctxSource));
// Two multipliers, not one. RN scales fontSize by the PHONE's setting on its
// own, so passing that to fontSize would square it; the app's own Small/Large
// control it knows nothing about, so that one must reach fontSize directly.
// Collapsing them would make "Large" change line spacing and nothing else.
check('the in-app text scale is passed separately from the OS one',
  /makeFont\(colors,\s*fontScale,\s*textFactor\)/.test(ctxSource),
  ctxSource.match(/makeFont\([^)]*\)/)?.[0]);
const fontSmall = makeFont(lightColors, 1, 1);
const fontLarge = makeFont(lightColors, 1, 1.3);
check('picking a larger text size actually grows the glyphs',
  fontLarge.body.fontSize > fontSmall.body.fontSize,
  { small: fontSmall.body.fontSize, large: fontLarge.body.fontSize });
check('and its leading grows with them',
  fontLarge.body.lineHeight > fontSmall.body.lineHeight);
const fontOsLarge = makeFont(lightColors, 1.5, 1);
check('the phone setting still moves leading only, since RN owns fontSize',
  fontOsLarge.body.fontSize === fontSmall.body.fontSize
    && fontOsLarge.body.lineHeight > fontSmall.body.lineHeight,
  { fontSize: fontOsLarge.body.fontSize, lineHeight: fontOsLarge.body.lineHeight });
check('fontScale is in the memo deps, or the font would freeze at the first value',
  /\}, \[[^\]]*fontScale[^\]]*\]/.test(ctxSource));
check('and it is exposed for one-off text', /^\s*fontScale,$/m.test(ctxSource));

console.log('\n=== NOTHING PINS A LINE HEIGHT BEHIND THE SCALE\u2019S BACK ===');
// A hard-coded lineHeight cannot scale, so it is the one thing that goes
// cramped at a large setting while everything around it breathes.
const pinned = [];
for (const f of screens) {
  const text = fs.readFileSync(f, 'utf8');
  for (const m of text.matchAll(/lineHeight:\s*(\d+)\b/g)) {
    pinned.push(`${path.relative(root, f)}: lineHeight ${m[1]}`);
  }
}
check('no literal lineHeight left in any screen', pinned.length === 0, pinned.join(', '));


check(`no static colour imports across ${screens.length} screens/components`, offenders.length === 0,
  offenders.map((f) => path.relative(root, f)).join(', '));

const missing = screens.filter((f) => {
  const text = fs.readFileSync(f, 'utf8');
  // `look.colors.x` is somebody's own data, not the theme's colours.
  return /(^|[^.\w])colors\.|(^|[^.\w])font\./.test(text) && !text.includes('useTheme');
});
check('every screen that uses tokens calls useTheme()', missing.length === 0,
  missing.map((f) => path.relative(root, f)).join(', '));

console.log('\n=== BACKGROUND IS NOT PAINTED OVER ===');
const painted = screens.filter((f) => /backgroundColor: colors\.bg\b/.test(fs.readFileSync(f, 'utf8')));
check('no screen paints colors.bg over the lava lamp', painted.length === 0,
  painted.map((f) => path.relative(root, f)).join(', '));

const lava = fs.readFileSync(path.join(root, 'components', 'LavaLamp.js'), 'utf8');
check('blob motion uses the native driver', /useNativeDriver: true/.test(lava));

console.log('\n=== NOTHING PAINTS OVER THE LIVE BACKGROUND ===');
// The lava lamp sits behind the whole navigator. A screen that gives its
// container an opaque backgroundColor hides it for that screen, and the only
// way that gets noticed is somebody saying the background "isn't constant".
{
  // Walked inline: the shared helper is declared further down this file.
  const listScreens = (dir, out = []) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) listScreens(full, out);
      else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out;
  };
  const screens = listScreens(path.join(root, 'app'));
  const opaque = [];
  for (const file of screens) {
    const src = fs.readFileSync(file, 'utf8');
    // The root style of a screen: the one that also carries flex: 1.
    for (const m of src.matchAll(/\b(container|root|screen)\s*:\s*\{([^}]*)\}/g)) {
      const body = m[2];
      if (!/flex:\s*1/.test(body)) continue;
      const colour = body.match(/backgroundColor:\s*([^,}]+)/);
      if (!colour) continue;                       // no background at all is fine
      if (/transparent/.test(colour[1])) continue; // explicitly transparent is fine
      opaque.push(`${path.relative(root, file)} -> ${colour[1].trim()}`);
    }
  }
  // CallScreen is the deliberate exception: a full-screen video call is not a
  // place for a drifting background behind the remote camera.
  const unexpected = opaque.filter((entry) => !entry.includes('CallScreen'));
  check(`no screen paints over the lava lamp (${screens.length} screens)`,
    unexpected.length === 0, unexpected.join(', '));
}

const lavaSource = fs.readFileSync(path.join(root, 'components', 'LavaLamp.js'), 'utf8');
check('the lava lamp clamps it rather than trusting the caller',
  /Math\.min\(1,\s*Math\.max\(/.test(lavaSource));
check('and applies it to the blob opacity',
  /blobOpacity\s*\*\s*intensity/.test(lavaSource));
check('drift speed multiplies each blob period, keeping them out of sync',
  /spec\.period\s*\*\s*speedFactor/.test(lavaSource));

// Match imports only - the file explains in prose why those libraries are
// not used, and that explanation should not trip the check.
const lavaImports = (lava.match(/^import .*$/gm) || []).join('\n');
check('no Reanimated or Skia imported', !/reanimated|react-native-skia/i.test(lavaImports), lavaImports);
check('animation pauses when backgrounded', /AppState/.test(lava));
check('reduce motion is honoured', /reduceMotion/.test(lava));

const ctx = fs.readFileSync(path.join(root, 'components', 'ThemeContext.js'), 'utf8');
check('reduce motion follows the OS setting', /AccessibilityInfo/.test(ctx));

console.log('\n=== THE BLOB EDGE IS A SETTING, NOT A HARDCODED OPINION ===');
// The stops used to be 0/55/100% in the component, which is one person's view
// of how blurry a lava lamp should be, with no way to disagree.
{
  const soft = blobStops(0);
  const hard = blobStops(1);

  check('the softest setting starts fading almost at once', soft.core === 0, soft);
  check('and the hardest holds colour nearly to the rim', hard.core >= 70, hard);
  check('the mid stop moves outward with it', hard.mid > soft.mid, { soft, hard });
  check('and gets more opaque, so the edge is an edge rather than a later gradient',
    hard.midAlpha > soft.midAlpha, { soft: soft.midAlpha, hard: hard.midAlpha });

  // Monotonic, or dragging the slider would move the edge backwards somewhere
  // in the middle.
  let monotonic = true;
  let previous = blobStops(0);
  for (let d = 0.05; d <= 1.0001; d += 0.05) {
    const here = blobStops(d);
    if (here.core < previous.core || here.mid < previous.mid) monotonic = false;
    previous = here;
  }
  check('every step of the slider moves the edge outward', monotonic);

  // The rim must stay transparent at every setting: a circle this large with
  // a hard cut at 100% has nothing to anti-alias against and shimmers while
  // it drifts.
  let inside = true;
  for (let d = 0; d <= 1.0001; d += 0.1) {
    const here = blobStops(d);
    if (here.mid >= 100 || here.core >= here.mid) inside = false;
  }
  check('and the outermost stop always stays inside the rim', inside);

  // 0 is a real value, not a missing one. `Number(0) || default` is the
  // default, which would have made the bottom of the slider snap back.
  check('zero is honoured rather than treated as unset',
    blobStops(0).core === 0 && blobStops(undefined).core > 0,
    { zero: blobStops(0), unset: blobStops(undefined) });
  check('and nonsense falls back instead of producing NaN',
    Number.isFinite(blobStops('nope').core), blobStops('nope'));
}

console.log('\n=== AND THE LAVA RISES AGAINST GRAVITY, NOT THE SCREEN ===');
{
  const lamp = fs.readFileSync(path.join(root, 'components', 'LavaLamp.js'), 'utf8');
  const hook = fs.readFileSync(path.join(root, 'components', 'useGravity.js'), 'utf8');

  check('the field is oriented by a gravity reading', /useGravity\(/.test(lamp));
  check('travel is built from that direction and its perpendicular',
    /perp = \{ x: -up\.y, y: up\.x \}/.test(lamp), lamp.match(/const perp = [^;]*/)?.[0]);

  // Reducing to the old behaviour when upright is what makes this a
  // generalisation rather than a rewrite: up is (0,-1), perpendicular is
  // (1,0), so the ranges come out as the old across/up pair.
  const up = { x: 0, y: -1 };
  const perp = { x: -up.y, y: up.x };
  const spec = { driftX: 0.18, driftY: 0.1 };
  const span = 100;
  const vecX = (up.x * spec.driftY + perp.x * spec.driftX) * span;
  const vecY = (up.y * spec.driftY + perp.y * spec.driftX) * span;
  check('held upright it reduces to the plain vertical field',
    Math.abs(vecX - spec.driftX * span) < 1e-9 && Math.abs(vecY + spec.driftY * span) < 1e-9,
    { vecX, vecY });

  // Turned on its side, the rise has to follow.
  const side = { x: -1, y: 0 };
  const sidePerp = { x: -side.y, y: side.x };
  const sideX = (side.x * spec.driftY + sidePerp.x * spec.driftX) * span;
  const sideY = (side.y * spec.driftY + sidePerp.y * spec.driftX) * span;
  // up = (-1, 0) puts real-up at screen-left, so the RISE lands on x and the
  // sideways wander lands on y — the axes swap, which is the whole point.
  check('turned sideways the rise turns with it',
    Math.abs(sideX + spec.driftY * span) < 1e-9 && Math.abs(sideY + spec.driftX * span) < 1e-9,
    { sideX, sideY, expected: { x: -spec.driftY * span, y: -spec.driftX * span } });

  check('the sensor is off while the background is still',
    /useGravity\(animate\)/.test(lamp));
  check('lying flat holds the last direction rather than spinning',
    /magnitude < 0\.15/.test(hook));
  check('and the reading is smoothed and quantised, not fed in raw',
    /SMOOTHING/.test(hook) && /THRESHOLD/.test(hook));
  check('the sensor is required, not imported, so a build without it still starts',
    /require\('expo-sensors'\)/.test(hook));
}

console.log('\n=== AND BOTH ARE REACHABLE FROM SETTINGS ===');
{
  const settings = fs.readFileSync(path.join(root, 'app', 'SettingsScreen.js'), 'utf8');
  check('there is a slider for the edge', /setBackgroundDefinition/.test(settings));
  check('labelled at both ends, so it says what it does',
    /Blurred/.test(settings) && /Defined/.test(settings));
  const ctx = fs.readFileSync(path.join(root, 'components', 'ThemeContext.js'), 'utf8');
  check('the choice is remembered', /BG_DEFINITION_KEY/.test(ctx));
  check('and the write is debounced like the other slider',
    /definitionWrite/.test(ctx));
}

console.log(`\nTHEME RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
