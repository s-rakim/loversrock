// The mascots: the two of you.
//
// By default, the two pictures the app ships — one of each of you, 'a' and
// 'b'. Either of you can replace your own with any picture you upload in
// Settings (components/MascotPicker.js); it is stored on the server and comes
// back on GET /profile as `mascot: { key, width, height }` for both of you.
// "Use the default" removes the upload and brings the shipped one back.
//
// Which shipped picture is whose is decided per account on the server
// (backend/src/models/mascotArt.js) — the same bundle goes on both phones,
// so "me" cannot mean a fixed file. That same choice decides the distance
// widget's sides: 'b' stands on the left, 'a' on the right.
//
// This module is the store, kept free of React and of the network so it can
// be tested on its own. components/useMascotOwners.js fills it from /profile
// and keeps it fresh; it also supplies the function that turns a storage key
// into an image URL, because that URL carries the current access token and
// has to be built at render time, not stored.
//
/**
 * The shipped pictures, and where each person's head sits in theirs (for
 * the head-and-shoulders crop), read off the artwork. A copy of each ships in
 * the widgets too (widget_mascot_a / widget_mascot_b), byte for byte.
 */
export const DEFAULT_ART = {
  a: { source: require('./me-neutral.jpg'), head: { cx: 0.29, cy: 0.17, h: 0.34 } },
  b: { source: require('./partner-neutral.jpg'), head: { cx: 0.75, cy: 0.16, h: 0.34 } },
};

/** The two of you together, for the loading screen. */
export const PAIR_ART = require('./pair.jpg');

let owners = { me: 'a', partner: 'b' };
let pictures = { me: null, partner: null };
// Replaced on every change, so useSyncExternalStore sees a new snapshot.
let snapshot = { owners, pictures };
let resolveKey = () => null;
const listeners = new Set();

function changed() {
  snapshot = { owners, pictures };
  listeners.forEach((fn) => fn());
}

/** Which side token this person has: 'a' (right) or 'b' (left). */
export function mascotArtOf(who) {
  return who === 'me' ? owners.me : owners.partner;
}

/** Tell the store which side is you. The other one is your partner. */
export function setMascotOwners(mine) {
  if (mine !== 'a' && mine !== 'b') return;
  if (owners.me === mine) return;
  owners = { me: mine, partner: mine === 'a' ? 'b' : 'a' };
  changed();
}

const cleanPicture = (p) => (p && typeof p.key === 'string' && p.key
  ? { key: p.key, width: p.width || null, height: p.height || null }
  : null);

/** Both uploaded pictures, straight from /profile: { me, partner }. */
export function setMascotPictures(next) {
  const me = cleanPicture(next?.me);
  const partner = cleanPicture(next?.partner);
  if (JSON.stringify({ me, partner }) === JSON.stringify(pictures)) return;
  pictures = { me, partner };
  changed();
}

/** How a storage key becomes an image URL (mediaUrl, with the live token). */
export function setMascotResolver(fn) {
  resolveKey = typeof fn === 'function' ? fn : () => null;
  changed();
}

export function subscribeMascotOwners(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const getMascotOwners = () => owners;
export const getMascotPictures = () => pictures;
export const getMascotState = () => snapshot;

/** Their shipped picture: 'a' or 'b', by which of you they are. */
const defaultFor = (who) => DEFAULT_ART[mascotArtOf(who)] || DEFAULT_ART.a;

/**
 * The picture to show for a person, as an <Image> source: what they
 * uploaded, or else their shipped picture. The mood is accepted for the
 * callers' sake; a mascot is one picture whatever the mood.
 *
 * Width and height ride along on an uploaded source so the frame is the
 * picture's own shape before the image has even loaded.
 */
export function artFor(mood, who = 'partner') {
  const picture = pictures[who === 'me' ? 'me' : 'partner'];
  const uri = picture ? resolveKey(picture.key) : null;
  if (!uri) return defaultFor(who).source;
  return picture.width && picture.height
    ? { uri, width: picture.width, height: picture.height }
    : { uri };
}

/** Every person has a picture — their upload or the shipped one. */
export function hasArtFor() {
  return true;
}

/** True when this person has uploaded their own picture. */
export function hasUploadFor(who) {
  return Boolean(pictures[who === 'me' ? 'me' : 'partner']);
}

/**
 * Where to centre a head-and-shoulders crop of a person's picture.
 *
 * The shipped pictures carry their own numbers. An uploaded one comes with no
 * idea where the face is, so it goes by shape: a tall picture is a standing
 * figure, head near the top; anything squarer is already a portrait, shown
 * whole. (An upload still being fetched — no URL yet — shows the shipped
 * picture, so it gets the shipped numbers.)
 */
export function headFor(who) {
  const picture = pictures[who === 'me' ? 'me' : 'partner'];
  if (!picture || !resolveKey(picture.key)) return defaultFor(who).head;
  const ratio = picture.width && picture.height ? picture.width / picture.height : 1;
  return ratio < 0.75 ? { cx: 0.5, cy: 0.16, h: 0.34 } : { cx: 0.5, cy: 0.5, h: 1 };
}
