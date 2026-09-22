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
