// Grey-white base with a romantic rose accent. Text is a warm near-black
// for contrast on the light surfaces, rather than pure black.
export const colors = {
  bg: '#F7F4F2',
  surface: '#FFFFFF',
  surfaceAlt: '#F3ECEA',
  border: '#E9E1DE',
  text: '#2B2320',
  textMuted: '#8C7F79',
  accent: '#E8607A', // romantic rose — primary accent, replaces the old yellow
  accentSoft: '#FCE1E6', // pale blush, used behind icon chips / stickers
  gold: '#D9A441', // secondary warm accent, used sparingly (streaks, premium)
  danger: '#D9455B',
  success: '#3FA372',
  glassTintLight: 'rgba(255,255,255,0.7)',
  glassBorder: 'rgba(232, 96, 122, 0.18)',
};

// Soft pastel duotones for deck/game gradient chips — tuned to sit on the
// grey-white base rather than a dark card.
export const categoryGradients = {
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

export function gradientForCategory(category) {
  return categoryGradients[category] || categoryGradients.default;
}

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };

// Slightly more rounded across the board for a softer, "sticker-like" feel.
export const radius = { sm: 10, md: 16, lg: 24, xl: 30, pill: 999, icon: 14 };

export const font = {
  wordmark: {
    fontFamily: 'serif',
    fontSize: 34,
    color: colors.text,
    letterSpacing: 0.5,
  },
  h1: { fontSize: 24, fontWeight: '700', color: colors.text },
  h2: { fontSize: 18, fontWeight: '600', color: colors.text },
  body: { fontSize: 15, color: colors.text },
  muted: { fontSize: 13, color: colors.textMuted },
};

// Default liquid-glass tab bar intensity (0-100), overridden at runtime by
// GlassContext once the user adjusts it in Settings.
export const DEFAULT_GLASS_INTENSITY = 55;

export default {
  colors,
  categoryGradients,
  gradientForCategory,
  spacing,
  radius,
  font,
  DEFAULT_GLASS_INTENSITY,
};
