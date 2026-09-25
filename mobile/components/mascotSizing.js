// How big the couple mascot is, relative to the phone. Sizes are the image's
// height in px; the width follows the image's own aspect ratio. Every context
// is capped so the mascot never crowds content on a small phone or balloons
// on a big one.
import { useWindowDimensions } from 'react-native';

// assets/mascot/couple.png is 406 × 509.
export const MASCOT_ASPECT = 406 / 509;

const RULES = {
  loading: { w: 0.72, h: 0.46, min: 240, max: 420 },
  home: { w: 0.62, h: 0.3, min: 190, max: 300 },
  hero: { w: 0.6, h: 0.32, min: 190, max: 320 },
  picker: { w: 0.78, h: 0.4, min: 220, max: 380 },
  game: { w: 0.6, h: 0.3, min: 180, max: 300 },
  sheet: { w: 0.42, h: 0.2, min: 140, max: 200 },
};

export function mascotSize(context, width, height) {
  const r = RULES[context] || RULES.hero;
  const byWidth = (width * r.w) / MASCOT_ASPECT;
  const byHeight = height * r.h;
  return Math.round(Math.max(r.min, Math.min(r.max, byWidth, byHeight)));
}

export function useMascotSize(context) {
  const { width, height } = useWindowDimensions();
  return mascotSize(context, width, height);
}
