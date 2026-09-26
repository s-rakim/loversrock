// Which side of the distance widget each of you stands on: 'b' on the left,
// 'a' on the right.
//
// (It began as "which of the two bundled pictures is whose". The pictures are
// now whatever each of you uploads, but the widget still needs the two of you
// the same way round on both phones, and this still decides that — the same
// answer for both, worked out once on the server.)
//
// In order, the first rule that gives an answer wins:
//
//   1. what you picked (Settings → Your mascot → left / right)
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
