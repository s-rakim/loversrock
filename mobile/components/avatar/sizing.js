// One place that decides how big the characters are, relative to the phone.
// Sizes are the character's full height in px; every context is capped so
// the characters never crowd content on a small phone or balloon on a big one.
import { useWindowDimensions } from 'react-native';

const RULES = {
  loading: { w: 0.4, h: 0.3, min: 140, max: 260 },   // each of two, side by side
  home: { w: 0.42, h: 0.24, min: 150, max: 230 },    // each of two, in the header card
  hero: { w: 0.5, h: 0.28, min: 150, max: 260 },     // single character, profile / wardrobe
  picker: { w: 0.38, h: 0.22, min: 120, max: 200 },  // onboarding character choice
  game: { w: 0.34, h: 0.2, min: 110, max: 180 },     // two players in a game
  sheet: { w: 0.3, h: 0.16, min: 100, max: 150 },    // mood sheet preview
  small: { w: 0.22, h: 0.13, min: 80, max: 120 },
};

export function mascotSize(context, width, height) {
  const r = RULES[context] || RULES.hero;
  // Characters are ~0.66 as wide as tall, so a width budget converts to height.
  const byWidth = (width * r.w) / (148 / 224);
  const byHeight = height * r.h;
  return Math.round(Math.max(r.min, Math.min(r.max, byWidth, byHeight)));
}

export function useMascotSize(context) {
  const { width, height } = useWindowDimensions();
  return mascotSize(context, width, height);
}

// Both characters are always drawn at the same height — the couple stands
// eye to eye. (Kept as a function so call sites stay simple.)
export function heightFactor() {
  return 1;
}
