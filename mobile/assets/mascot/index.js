// The mascots: the two of you.
//
// React Native's bundler resolves require() at BUILD time — it cannot take a
// computed path — so art cannot be discovered by reading a folder at runtime.
// This file is therefore the one and only place art gets wired up, and
// nothing else in the app needs to know whether it exists.
//
// TWO PEOPLE, not one. There are two pictures, 'a' and 'b', one of each of
// you, and the same bundle goes onto both phones — so "me" cannot be a fixed
// file. On his phone "me" is his picture, on hers it is hers. The server
// decides which picture is whose (backend/src/models/mascotArt.js) and hands
// it over as `mascotArt` on GET /profile; setMascotOwners() takes it from
// there. Until it answers, the last answer this phone saw is used, so a cold
// start does not flash the wrong person.
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

/** Picture 'a' — him. The home-screen widgets carry a copy (widget_mascot_a). */
const ART_A = {
  neutral: require('./me-neutral.jpg'),
  happy: null,     // require('./a-happy.jpg'),
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

/** Picture 'b' — her. The home-screen widgets carry a copy (widget_mascot_b). */
const ART_B = {
  neutral: require('./partner-neutral.jpg'),
  happy: null,     // require('./b-happy.jpg'),
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

export const ART_SETS = { a: ART_A, b: ART_B };

/**
 * The two of you together, for the loading screen.
 *
 * Its own image rather than the two cut-outs side by side: they are leaning on
 * each other in it, and no arrangement of two separate crops reproduces that.
 */
export const PAIR_ART = require('./pair.jpg');

/**
 * Where each person's head sits in their picture.
 *
 * The supplied crops are full-body, roughly 0.4 wide to tall. Sized by height
 * for an avatar — 96px in the mood card — that makes a 35px-wide sliver in
 * which the face is about twelve pixels across. The mascot was rendering
 * perfectly and could not be seen.
 *
 * `cx`/`cy` are the centre of the head as a fraction of the image, and `h` is
 * how much of the image height a head-and-shoulders crop should span. Read off
 * the artwork rather than guessed, and kept per PICTURE rather than per
 * person, because the numbers belong to the image.
 */
export const HEAD = {
  a: { cx: 0.29, cy: 0.17, h: 0.34 },
  b: { cx: 0.75, cy: 0.16, h: 0.34 },
};

// ------------------------------------------------------------ WHO IS WHICH

// 'a' until told otherwise: the same default the server uses for whoever
// created the pair, and on a phone that has never been told anything there
// is no better guess.
let owners = { me: 'a', partner: 'b' };
const listeners = new Set();

/** Which picture is this person: 'a' or 'b'. */
export function mascotArtOf(who) {
  return who === 'me' ? owners.me : owners.partner;
}

/**
 * Tell the art which picture is you. The other one is your partner — there
 * are two pictures and two of you, so one answer settles both.
 */
export function setMascotOwners(mine) {
  if (mine !== 'a' && mine !== 'b') return;
  if (owners.me === mine) return;
  owners = { me: mine, partner: mine === 'a' ? 'b' : 'a' };
  listeners.forEach((fn) => fn());
}

/** For useSyncExternalStore: re-render whatever draws a mascot when it flips. */
export function subscribeMascotOwners(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const getMascotOwners = () => owners;

/** The head rect for a person, with a safe middle-of-the-frame fallback. */
export function headFor(who) {
  return HEAD[mascotArtOf(who)] || { cx: 0.5, cy: 0.2, h: 0.36 };
}

/**
 * Art for a person's current mood.
 *
 * @param who 'me' | 'partner' — defaults to the partner, because that is
 *            whose mood the app shows in almost every place.
 */
export function artFor(mood, who = 'partner') {
  const set = ART_SETS[mascotArtOf(who)];
  return (set && (set[mood] || set.neutral)) || null;
}

export const HAS_ART =
  Object.values(ART_A).some(Boolean) || Object.values(ART_B).some(Boolean);

/** True when THIS person has art, which is what decides drawn vs photographed. */
export function hasArtFor(who) {
  return Object.values(ART_SETS[mascotArtOf(who)] || {}).some(Boolean);
}
