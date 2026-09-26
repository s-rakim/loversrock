// Design tokens for both themes.
//
// Colours are NOT exported as a flat object any more — read them from
// `useTheme()` (components/ThemeContext.js) so every screen follows the
// active light/dark scheme. Shape, spacing and type scale are deliberately
// shared between themes: the app should feel like the same app in both.

const shared = {
  accentPink: '#FF5C8D',
  period: '#FF4F7B',
  fertility: '#FFB300',
  danger: '#D9455B',
  success: '#3FA372',
  gold: '#D9A441',
};

export const lightColors = {
  ...shared,

  // Semantic tokens
  background: '#E4DCFA',
  backgroundGradient: ['#E4DCFA', '#FBE4EF'],
  // 0.78, not 0.95. At 0.95 the cards were effectively opaque white and the
  // lava lamp behind them may as well not have existed — which is precisely
  // what it looked like.
  card: 'rgba(255,255,255,0.78)',
  cardBorder: 'rgba(120,90,140,0.20)',
  textPrimary: '#111111',
  // Dark enough to clear 4.5:1 sitting DIRECTLY on the animated background,
  // over the densest blob — not just on a card. The old #696969 measured
  // 2.20:1 there, and the blobs below are far stronger than the pastels it
  // was chosen against. Secondary text is also where "no weight" shows first.
  textSecondary: '#363636',
  accentIndigo: '#3A11B0',
  tabBarActivePill: '#FFD9E4',
  categoryChip: 'rgba(255,92,141,0.18)',

  // The lava lamp, made visible.
  //
  // These were '#FFC1CC', '#E3C9FF', '#FFDCA8', '#FFB3C1' — pale pastels
  // drifting over a pale pastel gradient, which measured a luminance ratio of
  // about 1.05 against the background. The animation ran perfectly and could
  // not be seen. Saturated tones put it between 1.3x and 1.9x, which reads as
  // a lava lamp instead of as a flat pink screen.
  blobs: ['#FF5C93', '#8B55FF', '#FF922E', '#2FC6D6'],
  blobOpacity: 0.55,

  // Icons. The glyph used to default to accent (#FF5C8D) on accentSoft
  // (#FCE1E6): pink on pink, measuring 2.02:1, which is the washed-out
  // weightlessness the whole icon set had. A deep rose on a denser tint,
  // with a hairline edge, measures 4.66:1.
  iconGlyph: '#A8003A',
  iconChip: 'rgba(255,92,141,0.20)',
  iconChipBorder: 'rgba(168,0,58,0.26)',

  // Names the existing screens already use. Kept so the whole app could move
  // onto the provider without every colour being renamed in the same change.
  bg: '#E4DCFA',
  // Translucent, not solid white: the lava lamp has to read through the cards.
  surface: 'rgba(255,255,255,0.78)',
  surfaceAlt: 'rgba(255,255,255,0.55)',
  border: 'rgba(120,90,140,0.20)',
  text: '#111111',
  textMuted: '#363636',
  accent: '#FF5C8D',
  accentSoft: 'rgba(255,92,141,0.20)',
  glassTintLight: 'rgba(255,255,255,0.62)',
  glassBorder: 'rgba(255, 92, 141, 0.30)',
};

export const darkColors = {
  ...shared,

  background: '#07060F',
  backgroundGradient: ['#07060F', '#170C2B'],
  card: 'rgba(18,17,31,0.66)',
  cardBorder: 'rgba(255,255,255,0.14)',
  textPrimary: '#FFFFFF',
  // Same reasoning as light: bright enough to survive sitting on the
  // animated background rather than only on a card.
  textSecondary: '#E2E0EC',
  accentIndigo: '#B9ADFF',
  tabBarActivePill: '#4A1428',
  categoryChip: 'rgba(255,92,141,0.26)',

  // Deeper and more saturated than the old muddy purples, so the drift is
  // legible against near-black instead of being a faint smudge.
  blobs: ['#7A34C9', '#D81B8C', '#4432E0', '#B02A8F'],
  blobOpacity: 0.8,

  iconGlyph: '#FFB3CB',
  iconChip: 'rgba(255,92,141,0.26)',
  iconChipBorder: 'rgba(255,179,203,0.34)',

  bg: '#07060F',
  surface: 'rgba(18,17,31,0.66)',
  surfaceAlt: 'rgba(255,255,255,0.08)',
  border: 'rgba(255,255,255,0.14)',
  text: '#FFFFFF',
  textMuted: '#E2E0EC',
  accent: '#FF5C8D',
  accentSoft: 'rgba(255,92,141,0.26)',
  glassTintLight: 'rgba(18,17,31,0.58)',
  glassBorder: 'rgba(255, 92, 141, 0.34)',
};

/**
 * Type scale bound to a colour set, so text follows the active theme.
 *
 * `fontScale` is the phone's own font-size setting, from
 * useWindowDimensions().fontScale. It is NOT applied to fontSize: React
 * Native already scales fontSize by that setting on its own, and doing it
 * here as well would apply it twice.
 *
 * It IS applied to lineHeight, because React Native does not. That mismatch
 * is the whole problem: turn the phone's font size up and the glyphs grow
 * while the line spacing stays put, so the text closes up and looks
 * squeezed. Multiplying lineHeight by the same factor keeps the spacing in
 * proportion at every setting.
 *
 * The ratios are deliberate rather than uniform - headings read better
 * tighter than body copy, which needs room to be comfortable over several
 * lines.
 */
export function makeFont(colors, fontScale = 1, textScale = 1) {
  // Two different multipliers, because they are not the same thing.
  //
  // `fontScale` is the PHONE's font-size setting. React Native already
  // multiplies every fontSize by it automatically, so applying it to fontSize
  // here would square it. It does NOT scale lineHeight, which is the reason
  // this function exists at all.
  //
  // `textScale` is the app's own Small/Default/Large control. Nothing applies
  // it for us, so it has to reach fontSize directly — otherwise picking
  // "Large" would stretch the line spacing and leave the glyphs exactly the
  // size they were.
  //
  // Leading tracks both, since it has to accommodate whatever the glyphs
  // actually end up being.
  const size = (px) => Math.round(px * textScale);
  const leading = (px, ratio) => Math.round(px * textScale * ratio * fontScale);

  return {
    wordmark: {
      fontFamily: 'serif',
      fontSize: size(34),
      lineHeight: leading(34, 1.18),
      color: colors.textPrimary,
      letterSpacing: 0.5,
    },
    h1: { fontSize: size(24), lineHeight: leading(24, 1.25), fontWeight: '700', color: colors.textPrimary },
    h2: { fontSize: size(18), lineHeight: leading(18, 1.3), fontWeight: '600', color: colors.textPrimary },
    h3: { fontSize: size(15), lineHeight: leading(15, 1.35), fontWeight: '600', color: colors.textPrimary },
    body: { fontSize: size(15), lineHeight: leading(15, 1.45), color: colors.textPrimary },
    muted: { fontSize: size(13), lineHeight: leading(13, 1.4), color: colors.textSecondary },
  };
}

/**
 * The same leading rule for one-off text that is not on the scale.
 *
 * Used where a screen sets its own fontSize - a scoreboard number, a chip
 * label - so those get spacing that tracks the phone setting too instead of
 * being the one line that closes up.
 */
export function lineHeightFor(fontSize, fontScale = 1, ratio = 1.4) {
  return Math.round(fontSize * ratio * fontScale);
}

// Pastel in light; darker and translucent in dark, so a chip reads as a tint
// of the background rather than a bright sticker on a night sky.
const lightGradients = {
  'Would You Rather': ['#FFC1CC', '#FFDCA8'],
  'Deep Questions': ['#C7CFFF', '#E3C9FF'],
  'Hot & Spicy': ['#FFB3C1', '#FFC9A0'],
  Unhinged: ['#EAC1FF', '#FFC1E6'],
  'Effective Communication': ['#B8F0E6', '#B8DDF0'],
  'Money Matters': ['#C3F0CE', '#E4F0B8'],
  'Parenting Perspectives': ['#FFDCB8', '#FFC9BE'],
  Wellness: ['#C1F5DC', '#C1EAF5'],
  'Photo Prompts': ['#FFE7B8', '#FFCBB8'],
  'Future Plans & Dreams': ['#C1D4FF', '#C1FFEF'],
  'Popular Community Questions': ['#FFE9A8', '#FFC9B8'],
  default: ['#F0E7E3', '#E4D9D4'],
};

const darkGradients = Object.fromEntries(
  Object.entries(lightGradients).map(([name, [from, to]]) => [name, [shade(from), shade(to)]])
);

/** Darkens a pastel and keeps it translucent for the night theme. */
function shade(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * 0.42);
  const g = Math.round(((n >> 8) & 255) * 0.42);
  const b = Math.round((n & 255) * 0.42);
  return `rgba(${r},${g},${b},0.85)`;
}

export const categoryGradients = lightGradients;

export function gradientForCategory(category, scheme = 'light') {
  const set = scheme === 'dark' ? darkGradients : lightGradients;
  return set[category] || set.default;
}

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };
export const radius = { sm: 10, md: 16, lg: 24, xl: 30, pill: 999, icon: 14, card: 24 };

// Default liquid-glass tab bar intensity (0-100), overridden at runtime by
// GlassContext once the user adjusts it in Settings.
export const DEFAULT_GLASS_INTENSITY = 55;

// Deprecated: light-theme colours as a static object, for any module that
// cannot use a hook (StyleSheet.create at module scope). Prefer useTheme().
export const colors = lightColors;
export const font = makeFont(lightColors, 1);


/**
 * Accent presets.
 *
 * Each one carries its own icon glyph colour per scheme rather than deriving
 * one, because a derived tint is exactly how the old icons ended up at
 * 2.02:1. Every pair below is measured against the real stack an <Icon chip>
 * paints — chip tint over card over a blob over the gradient — and clears
 * 4.5:1 in both schemes. test/theme.mjs recomputes it, so a new accent that
 * looks nice and reads badly fails before it ships.
 */
export const ACCENTS = {
  rose: {
    label: 'Rose',
    accent: '#FF5C8D',
    light: { iconGlyph: '#A8003A', iconChipBorder: 'rgba(168,0,58,0.26)' },
    dark: { iconGlyph: '#FFB3CB', iconChipBorder: 'rgba(255,179,203,0.34)' },
  },
  violet: {
    label: 'Violet',
    accent: '#7C4DFF',
    light: { iconGlyph: '#43128F', iconChipBorder: 'rgba(67,18,143,0.26)' },
    dark: { iconGlyph: '#CBB8FF', iconChipBorder: 'rgba(203,184,255,0.34)' },
  },
  ember: {
    label: 'Ember',
    accent: '#FF7043',
    light: { iconGlyph: '#7E2600', iconChipBorder: 'rgba(126,38,0,0.26)' },
    dark: { iconGlyph: '#FFC9B2', iconChipBorder: 'rgba(255,201,178,0.34)' },
  },
  ocean: {
    label: 'Ocean',
    accent: '#00ACC1',
    light: { iconGlyph: '#00525E', iconChipBorder: 'rgba(0,82,94,0.26)' },
    dark: { iconGlyph: '#8FE9F5', iconChipBorder: 'rgba(143,233,245,0.34)' },
  },
  forest: {
    label: 'Forest',
    accent: '#43A047',
    light: { iconGlyph: '#14501A', iconChipBorder: 'rgba(20,80,26,0.26)' },
    dark: { iconGlyph: '#B0E0B3', iconChipBorder: 'rgba(176,224,179,0.34)' },
  },
};

export const ACCENT_NAMES = Object.keys(ACCENTS);
export const DEFAULT_ACCENT = 'rose';

/** How lively the background drifts. Multiplies each blob's period. */
export const BACKGROUND_SPEEDS = {
  calm: { label: 'Calm', factor: 1.8 },
  gentle: { label: 'Gentle', factor: 1.0 },
  lively: { label: 'Lively', factor: 0.55 },
};

/**
 * The background can be dimmed but never boosted.
 *
 * The palette's blobOpacity is the value every contrast measurement in
 * test/theme.mjs is taken at. Letting a slider push past it would put
 * secondary text at 3.95:1 — the app would ship a setting that quietly
 * breaks its own accessibility floor. Turning it down only ever helps.
 */
export const MIN_BACKGROUND_INTENSITY = 0.3;
export const MAX_BACKGROUND_INTENSITY = 1;

/**
 * How hard-edged the blobs are, 0 to 1.
 *
 * Two different knobs that both sound like "how strong is the background":
 * INTENSITY is how much of it you see, DEFINITION is where it stops. A blob
 * is a radial gradient from an opaque middle to a transparent rim, and moving
 * where that falloff begins is the whole effect — at 0 the colour starts
 * fading almost immediately and the field reads as smoke, at 1 it holds full
 * strength nearly to the edge and reads as a lamp with actual blobs in it.
 *
 * It exists because this was the one thing about the background nobody could
 * change: the stops were hardcoded at 0/55/100%, which is one designer's
 * opinion about how blurry a lava lamp should be.
 */
export const MIN_BACKGROUND_DEFINITION = 0;
export const MAX_BACKGROUND_DEFINITION = 1;
export const DEFAULT_BACKGROUND_DEFINITION = 0.25;

/**
 * The gradient stops for a blob at a given definition.
 *
 * Returns the two inner offsets as percentages; the rim is always fully
 * transparent at 100%, which is what gives the soft edge in the first place.
 * Kept here rather than in the component so the numbers can be tested without
 * rendering anything.
 *
 * At 0:  core 0%, mid 40% — a wide, early falloff. Smoke.
 * At 1:  core 78%, mid 94% — colour to the brim, then a short hard rim. A
 *        real edge, but never a jagged one: SVG has no anti-aliasing to spare
 *        on a circle this large, and a stop at exactly 100% shimmers as it
 *        moves.
 */
export function blobStops(definition = DEFAULT_BACKGROUND_DEFINITION) {
  const d = Math.min(1, Math.max(0, Number(definition) || 0));
  return {
    core: Math.round(78 * d),
    mid: Math.round(40 + 54 * d),
    // How much of the original softness survives in the middle stop. At full
    // definition the mid stop is nearly as opaque as the core, which is what
    // stops the "edge" being a gradient that merely starts later.
    midAlpha: 0.55 + 0.4 * d,
  };
}

/** Applies an accent preset onto a base palette. */
export function withAccent(colors, accentName, isDark) {
  const preset = ACCENTS[accentName] || ACCENTS[DEFAULT_ACCENT];
  const scheme = isDark ? preset.dark : preset.light;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(preset.accent.slice(i, i + 2), 16));
  return {
    ...colors,
    accent: preset.accent,
    accentPink: preset.accent,
    accentSoft: `rgba(${r},${g},${b},${isDark ? 0.26 : 0.20})`,
    iconChip: `rgba(${r},${g},${b},${isDark ? 0.26 : 0.20})`,
    categoryChip: `rgba(${r},${g},${b},${isDark ? 0.26 : 0.18})`,
    glassBorder: `rgba(${r},${g},${b},${isDark ? 0.34 : 0.30})`,
    ...scheme,
  };
}


/**
 * Blob palettes for the live background.
 *
 * Kept as whole sets rather than letting four colours be picked independently:
 * a lava lamp is a palette, and four individually-chosen hues almost always
 * come out as mud where they overlap. Each set is measured in test/theme.mjs
 * against the gradient it sits on, in both schemes, so a palette that looks
 * pretty and leaves body text at 3:1 fails before it ships.
 */
export const BLOB_PALETTES = {
  sunset: {
    label: 'Sunset',
    light: ['#FF5C93', '#8B55FF', '#FF922E', '#2FC6D6'],
    dark: ['#7A34C9', '#D81B8C', '#4432E0', '#B02A8F'],
  },
  lagoon: {
    label: 'Lagoon',
    light: ['#2FA8D6', '#4FD6B0', '#5C7CFF', '#28C2A8'],
    dark: ['#0E5C8A', '#1B7A6B', '#2A3FA8', '#146E8C'],
  },
  ember: {
    label: 'Ember',
    light: ['#FF6B3D', '#FF9F1C', '#E8455C', '#C64BD6'],
    dark: ['#8C2A10', '#A85E06', '#8F1230', '#6E1A8C'],
  },
  forest: {
    label: 'Forest',
    light: ['#3FA372', '#7BC43F', '#2FA8A0', '#B7C43F'],
    dark: ['#14502F', '#2E5C14', '#125450', '#4A5410'],
  },
  mono: {
    label: 'Mono',
    light: ['#8A8FA3', '#A9AEC2', '#6E7488', '#BFC4D6'],
    dark: ['#464C63', '#5A6180', '#383D52', '#6B7291'],
  },
};

export const BLOB_PALETTE_NAMES = Object.keys(BLOB_PALETTES);
export const DEFAULT_BLOB_PALETTE = 'sunset';

/** Swaps the background palette on a set of colours. */
export function withBlobs(colors, paletteName, isDark) {
  const preset = BLOB_PALETTES[paletteName] || BLOB_PALETTES[DEFAULT_BLOB_PALETTE];
  return { ...colors, blobs: isDark ? preset.dark : preset.light };
}

/**
 * A custom accent, from any hex the person picks.
 *
 * The glyph shade is DERIVED here rather than chosen, which is the one thing
 * the five built-in presets deliberately do not do — they each carry a
 * hand-measured shade. A free colour picker has no such luxury, so the shade
 * is computed by pushing the hue to a fixed lightness known to clear 4.5:1 on
 * this app's card colours: very dark in the light scheme, very light in the
 * dark one. That is a rule that holds for every hue rather than a guess that
 * holds for some.
 */
export function hexToHsl(hex) {
  const clean = String(hex).replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h, s, l };
}

export function hslToHex(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const value = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(value * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** True for a string this app will accept as a colour. */
export const isHexColor = (value) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(value || ''));

/** WCAG relative luminance. */
export function luminanceOf(hex) {
  const clean = String(hex).replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const channel = (i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** Flattens an rgba() over an opaque backdrop and returns the luminance. */
function compositeLuminance(rgb, alpha, backdrop) {
  const mixed = rgb.map((c, i) => alpha * c + (1 - alpha) * backdrop[i]);
  const channel = (v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(mixed[0]) + 0.7152 * channel(mixed[1]) + 0.0722 * channel(mixed[2]);
}

const toRgb = (hex) => {
  const clean = String(hex).replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};

const alphaOf = (rgba) => {
  const m = String(rgba).match(/rgba?\(([^)]+)\)/);
  return m ? (Number(m[1].split(',')[3]) || 1) : 1;
};


// Aim past the line rather than at it: 4.6 leaves room for the rounding that
// 8-bit colour forces at the end.
const CONTRAST_TARGET = 4.6;

/**
 * Builds the icon shade for an arbitrary accent.
 *
 * Solved for LUMINANCE against the measured backdrop, not for HSL lightness.
 * Pinning lightness is the obvious approach and it is wrong twice over: HSL
 * lightness is not perceptual, so the same "L" is a very different brightness
 * per hue — yellow at 0.26 measured 3.52:1 while blue sailed past 7:1 — and a
 * card-only target ignores that the chip under the glyph is a tint of the
 * accent itself.
 *
 * Because lightness runs all the way to black and white for every hue, any
 * luminance target is reachable without touching the hue or saturation the
 * person chose. So only the axis that decides readability moves.
 */
export function glyphForAccent(hex, isDark, backdropLuminance) {
  const { h, s } = hexToHsl(hex);
  const saturation = Math.min(1, s * (isDark ? 0.9 : 1.05));

  const backdrop = typeof backdropLuminance === 'number'
    ? backdropLuminance
    : (isDark ? 0.045 : 0.93);

  // Solve the WCAG ratio for the glyph's luminance.
  const target = isDark
    ? CONTRAST_TARGET * (backdrop + 0.05) - 0.05
    : (backdrop + 0.05) / CONTRAST_TARGET - 0.05;

  if (target <= 0) return '#000000';
  if (target >= 1) return '#ffffff';

  let low = 0;
  let high = 1;
  for (let i = 0; i < 20; i += 1) {
    const mid = (low + high) / 2;
    if (luminanceOf(hslToHex(h, saturation, mid)) > target) high = mid; else low = mid;
  }

  // `low` is the last lightness measured at or below the target. In the light
  // scheme the glyph must be no brighter than the target, so that is the one
  // to take; in the dark scheme it must be no dimmer, so take `high`.
  return hslToHex(h, saturation, isDark ? high : low);
}

/** Applies a free-form accent, deriving everything that depends on it. */
export function withCustomAccent(colors, hex, isDark) {
  if (!isHexColor(hex)) return colors;
  const full = hex.length === 4
    ? `#${hex.slice(1).split('').map((c) => c + c).join('')}`
    : hex;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(full.slice(i, i + 2), 16));
  const chipAlpha = isDark ? 0.26 : 0.20;

  // Walk every layer the screen paints and keep the worst case: chip tint
  // over card over each blob over each gradient stop.
  const cardRgb = toRgb(String(colors.card).startsWith('rgba')
    ? `#${String(colors.card).match(/\d+/g).slice(0, 3)
      .map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`
    : colors.card);
  const cardAlpha = alphaOf(colors.card);

  // Which extreme is "worst" is the opposite of the intuition. A DARK glyph
  // (light scheme) has its lowest contrast against the DARKEST backdrop, so
  // the minimum is the one to design against; a light glyph in the dark
  // scheme is bound by the brightest. Getting this backwards solves the glyph
  // against the layer it was already safe on and leaves it failing on the
  // other — it measured 2.73:1 that way.
  let worst = isDark ? 0 : 1;
  for (const stop of colors.backgroundGradient) {
    for (const blob of colors.blobs) {
      const painted = toRgb(blob).map((c, i) =>
        colors.blobOpacity * c + (1 - colors.blobOpacity) * toRgb(stop)[i]);
      const card = cardRgb.map((c, i) => cardAlpha * c + (1 - cardAlpha) * painted[i]);
      for (const luminance of [
        compositeLuminance(card, 1, card),
        compositeLuminance([r, g, b], chipAlpha, card),
      ]) {
        worst = isDark ? Math.max(worst, luminance) : Math.min(worst, luminance);
      }
    }
  }

  const glyph = glyphForAccent(full, isDark, worst);

  return {
    ...colors,
    accent: full,
    accentPink: full,
    accentSoft: `rgba(${r},${g},${b},${chipAlpha})`,
    iconChip: `rgba(${r},${g},${b},${chipAlpha})`,
    categoryChip: `rgba(${r},${g},${b},${isDark ? 0.26 : 0.18})`,
    glassBorder: `rgba(${r},${g},${b},${isDark ? 0.34 : 0.30})`,
    iconGlyph: glyph,
    iconChipBorder: `${glyph}44`,
  };
}
