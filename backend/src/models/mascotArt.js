// Which of the two original mascot pictures is whose: 'a' (him) or 'b' (her).
//
// The app ships one picture of each of you and the same bundle goes on both
// phones, so "me" cannot mean a fixed file; this decides it per account, once,
// on the server. It is also which side of the distance widget you stand on:
// 'b' on the left, 'a' on the right. An uploaded mascot replaces the picture
// but not the side.
//
// In order, the first rule that gives an answer wins:
//
//   1. what you picked (Settings → Your mascot → Which original picture is you?)
//   2. the opposite of what your partner picked
//   3. the cycle tracker role: the person tracking their own cycle is 'b'
//   4. the opposite of your partner's role
//   5. whoever created the pair is 'a'
//
// Rule 5 always answers, so there is always a pair of different pictures.

export const MASCOT_ARTS = ['a', 'b'];

const other = (art) => (art === 'a' ? 'b' : 'a');
const fromRole = (role) => (role === 'owner' ? 'b' : role === 'partner' ? 'a' : null);

/**
 * @param {{art?: string|null, cycleRole?: string|null}} me
 * @param {{art?: string|null, cycleRole?: string|null}|null} partner
 * @param {boolean} iCreatedThePair  true when I am pairs.user_a_id
 * @returns {{mine: 'a'|'b', theirs: 'a'|'b'}}
 */
export function resolveMascotArt(me, partner, iCreatedThePair) {
  const valid = (v) => (MASCOT_ARTS.includes(v) ? v : null);

  let mine = valid(me?.art);
  if (!mine && valid(partner?.art)) mine = other(partner.art);
  if (!mine) mine = fromRole(me?.cycleRole);
  if (!mine && fromRole(partner?.cycleRole)) mine = other(fromRole(partner.cycleRole));
  if (!mine) mine = iCreatedThePair === false ? 'b' : 'a';

  return { mine, theirs: other(mine) };
}
