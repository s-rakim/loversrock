// The mascots: the two of you, as pictures you each choose.
//
// There is no preset artwork any more. Each person uploads their own picture
// in Settings (components/MascotPicker.js); it is stored on the server and
// comes back on GET /profile as `mascot: { key, width, height }` for both of
// you. Until someone uploads one, they are drawn instead — the wardrobe
// character, which is what `artFor` returning null means to every caller.
//
// This module is the store, kept free of React and of the network so it can
// be tested on its own. components/useMascotOwners.js fills it from /profile
// and keeps it fresh; it also supplies the function that turns a storage key
// into an image URL, because that URL carries the current access token and
// has to be built at render time, not stored.
//
// It also knows which SIDE each of you stands on in the distance widget:
// 'b' is the left, 'a' the right (the server decides, see
// backend/src/models/mascotArt.js; you can change it in Settings).

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

/**
 * The picture to show for a person, as an <Image> source, or null to draw
 * them instead. The mood is accepted for the callers' sake; an uploaded
 * mascot is one picture whatever the mood.
 *
 * Width and height ride along on the source so the frame is the picture's own
 * shape before the image has even loaded.
 */
export function artFor(mood, who = 'partner') {
  const picture = pictures[who === 'me' ? 'me' : 'partner'];
  if (!picture) return null;
  const uri = resolveKey(picture.key);
  if (!uri) return null;
  return picture.width && picture.height
    ? { uri, width: picture.width, height: picture.height }
    : { uri };
}

/** True when this person has uploaded a picture. */
export function hasArtFor(who) {
  return Boolean(pictures[who === 'me' ? 'me' : 'partner']);
}

/**
 * Where to centre a head-and-shoulders crop of a person's picture.
 *
 * An uploaded picture comes with no idea where the face is, so this goes by
 * its shape: a tall picture is a standing figure, head near the top; anything
 * squarer is already a portrait, and is shown whole.
 */
export function headFor(who) {
  const picture = pictures[who === 'me' ? 'me' : 'partner'];
  const ratio = picture?.width && picture?.height ? picture.width / picture.height : 1;
  return ratio < 0.75 ? { cx: 0.5, cy: 0.16, h: 0.34 } : { cx: 0.5, cy: 0.5, h: 1 };
}
