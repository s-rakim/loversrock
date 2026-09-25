// The mascots: the two of you.
//
// React Native's bundler resolves require() at BUILD time — it cannot take a
// computed path — so art cannot be discovered by reading a folder at runtime.
// This file is therefore the one and only place art gets wired up, and
// nothing else in the app needs to know whether it exists.
//
// TWO PEOPLE, not one. The art is keyed by person first and mood second. `ME`
// is whoever is holding the phone; `PARTNER` is the other one. Each phone
// works that out from who is signed in, so you both install the same build
// and each sees the pair the right way round.
//
// ------------------------------------------------------------- THE SOURCE
//
// One supplied image of the two of you, cropped into three. The crops are the
// only thing done to it — no recolouring, no cut-out, no filter:
//
//   partner-neutral.jpg  from the left edge to just short of his shoulder,
//                        so her whole raised arm stays in frame
//   me-neutral.jpg       from just past her shoulder to the right edge, so
//                        his outstretched hand is not clipped
//   pair.jpg             the original, untouched
//
// JPEG rather than PNG because these are photographs — the same crops as PNG
// came to 1.5MB, which is a lot of bundle for three pictures. There is no
// transparency to lose.
//
// ADDING MOODS. Drop a file in this folder, uncomment its line. Restart the
// bundler afterwards: require() is resolved at build time, so a file added
// while Metro is running is NOT picked up by a fast refresh. Anything left
// null falls back to that person's `neutral`, so they can be added one at a
// time and the app keeps working the whole way through.

/** You. */
export const ME_ART = {
  neutral: require('./me-neutral.jpg'),
  happy: null,     // require('./me-happy.jpg'),
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

/** Them. */
export const PARTNER_ART = {
  neutral: require('./partner-neutral.jpg'),
  happy: null,     // require('./partner-happy.jpg'),
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

/**
 * The two of you together, for the loading screen.
 *
 * Its own image rather than the two cut-outs side by side: they are leaning on
 * each other in it, and no arrangement of two separate crops reproduces that.
 */
export const PAIR_ART = require('./pair.jpg');

/**
 * Art for a person's current mood.
 *
 * @param who 'me' | 'partner' — defaults to the partner, because that is
 *            whose mood the app shows in almost every place.
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
