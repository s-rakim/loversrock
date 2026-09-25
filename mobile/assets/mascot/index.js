// Where your mascot artwork goes.
//
// React Native's bundler resolves require() at BUILD time — it cannot take a
// computed path, so art cannot be discovered by reading a folder at runtime.
// This file is therefore the one and only place art gets wired up, and
// nothing else in the app needs to know whether it exists.
//
// TWO PEOPLE, not one. The mascots are you and your partner, so the art is
// keyed by person first and mood second. `ME` is whoever is holding the
// phone; `PARTNER` is the other one. Each phone works this out from who is
// signed in, so both of you install the same build and each sees the right
// pair round the right way.
//
// ------------------------------------------------------------------ HOW TO
//
//  1. Drop the files in this folder: mobile/assets/mascot/
//  2. Uncomment the matching lines below.
//  3. Restart the bundler. `require` is resolved at build time, so a file
//     added while Metro is running is NOT picked up by a fast refresh.
//
// Any entry left null falls back to that person's `neutral`, and a person
// with no art at all falls back to the drawn character — so you can add them
// one at a time and the app keeps working the whole way through.
//
// PNG with a transparent background, portrait, roughly 600x1000. Transparent
// matters more than size: these sit on the live background and a white box
// round a character is very obvious against a moving gradient.

const NONE = {
  neutral: null,   // require('./me-neutral.png'),
  happy: null,     // require('./me-happy.png'),
  loved: null,
  calm: null,
  tired: null,
  stressed: null,
  sad: null,
  annoyed: null,
  excited: null,
  lonely: null,
  unwell: null,
};

/** You. */
export const ME_ART = {
  ...NONE,
  // neutral: require('./me-neutral.png'),
};

/** Them. */
export const PARTNER_ART = {
  ...NONE,
  // neutral: require('./partner-neutral.png'),
};

/**
 * The two of you together, for the loading screen.
 *
 * Worth its own image rather than two cut-outs side by side: the pair art has
 * them leaning on each other, and two separate PNGs cannot overlap correctly
 * without knowing where the arms are.
 */
export const PAIR_ART = null;   // require('./pair.png');

/**
 * Art for a person's current mood.
 *
 * @param who   'me' | 'partner' — defaults to the partner, because that is
 *              whose mood the app shows in almost every place.
 */
export function artFor(mood, who = 'partner') {
  const set = who === 'me' ? ME_ART : PARTNER_ART;
  return set[mood] || set.neutral || null;
}

export const HAS_ART =
  Object.values(ME_ART).some(Boolean) || Object.values(PARTNER_ART).some(Boolean);

/** True when THIS person has art, which is what decides drawn vs photographed. */
export function hasArtFor(who) {
  return Object.values(who === 'me' ? ME_ART : PARTNER_ART).some(Boolean);
}
