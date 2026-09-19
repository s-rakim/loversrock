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
  background: '#EDE9FB',
  backgroundGradient: ['#EDE9FB', '#F8E8F1'],
  card: 'rgba(255,255,255,0.95)',
  cardBorder: '#E9E1DE',
  textPrimary: '#111111',
  // Spec said #6B6B6B, which measures 4.48:1 on the light gradient - just
  // under WCAG AA for body text. Nudged two steps darker to clear 4.5:1;
  // visually indistinguishable, and test/theme.mjs holds the line.
  textSecondary: '#696969',
  accentIndigo: '#4B1FD1',
  tabBarActivePill: '#FFD9E4',
  categoryChip: 'rgba(255,92,141,0.12)',

  // Lava lamp blobs (step 2) — pink, lavender, peach on the light gradient.
  blobs: ['#FFC1CC', '#E3C9FF', '#FFDCA8', '#FFB3C1'],
  blobOpacity: 0.55,

  // Names the existing screens already use. Kept so the whole app could move
  // onto the provider without every colour being renamed in the same change.
  bg: '#EDE9FB',
  surface: '#FFFFFF',
  surfaceAlt: '#F3ECEA',
  border: '#E9E1DE',
  text: '#111111',
  textMuted: '#6B6B6B',
  accent: '#FF5C8D',
  accentSoft: '#FCE1E6',
  glassTintLight: 'rgba(255,255,255,0.7)',
  glassBorder: 'rgba(255, 92, 141, 0.18)',
};

export const darkColors = {
  ...shared,

  background: '#0B0B1A',
  backgroundGradient: ['#0B0B1A', '#1A1030'],
  card: 'rgba(20,20,35,0.6)',
  cardBorder: 'rgba(255,255,255,0.12)',
  textPrimary: '#FFFFFF',
  textSecondary: '#B5B3C4',
  accentIndigo: '#A99BF5',
  tabBarActivePill: '#4A1428',
  categoryChip: 'rgba(255,92,141,0.22)',

  blobs: ['#5B2A8C', '#A3197D', '#3B2FA0', '#7A1F6B'],
  blobOpacity: 0.7,

  bg: '#0B0B1A',
  surface: 'rgba(20,20,35,0.6)',
  surfaceAlt: 'rgba(255,255,255,0.06)',
  border: 'rgba(255,255,255,0.12)',
  text: '#FFFFFF',
  textMuted: '#B5B3C4',
  accent: '#FF5C8D',
  accentSoft: 'rgba(255,92,141,0.22)',
  glassTintLight: 'rgba(20,20,35,0.55)',
  glassBorder: 'rgba(255, 92, 141, 0.28)',
};

/** Type scale bound to a colour set, so text follows the active theme. */
export function makeFont(colors) {
  return {
    wordmark: {
      fontFamily: 'serif',
      fontSize: 34,
      color: colors.textPrimary,
      letterSpacing: 0.5,
    },
    h1: { fontSize: 24, fontWeight: '700', color: colors.textPrimary },
    h2: { fontSize: 18, fontWeight: '600', color: colors.textPrimary },
    h3: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
    body: { fontSize: 15, color: colors.textPrimary },
    muted: { fontSize: 13, color: colors.textSecondary },
  };
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
export const font = makeFont(lightColors);
