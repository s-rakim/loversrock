export const colors = {
  bg: '#000000',
  surface: '#121212',
  surfaceAlt: '#1a1a1a',
  border: '#262626',
  text: '#f5f5f0',
  textMuted: '#9a9a9a',
  accent: '#FFE862',
  danger: '#ff5c5c',
  success: '#4ade80',
};

// Category-specific gradient pairs for deck/game cards.
export const categoryGradients = {
  'Would You Rather': ['#ff6a6a', '#ffb56b'],
  'Deep Questions': ['#6a7bff', '#8f6aff'],
  'Hot & Spicy': ['#ff4d6a', '#ff8a3d'],
  Unhinged: ['#c76aff', '#ff6ac1'],
  'Effective Communication': ['#3dd6c4', '#3d9bd6'],
  'Money Matters': ['#3dd67a', '#8fd63d'],
  'Parenting Perspectives': ['#ffb56b', '#ff8a6a'],
  Wellness: ['#6affb0', '#6ae0ff'],
  'Photo Prompts': ['#ffd66a', '#ff9e6a'],
  'Future Plans & Dreams': ['#6a8bff', '#6affe0'],
  'Popular Community Questions': ['#ffe862', '#ff9e6a'],
  default: ['#3d3d3d', '#1a1a1a'],
};

export function gradientForCategory(category) {
  return categoryGradients[category] || categoryGradients.default;
}

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };

export const radius = { sm: 8, md: 14, lg: 22, pill: 999 };

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

export default { colors, categoryGradients, gradientForCategory, spacing, radius, font };
