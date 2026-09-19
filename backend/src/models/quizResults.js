// How a finished daily quiz is scored and titled.
//
// Kept out of the route so the banding can be tested on its own — it is the
// part with real edge cases (nobody answered, one question, an exact tie)
// and the part a route test would only reach through six HTTP calls.
//
// "Matching" here means the two of you gave the SAME answer, not that either
// of you was right. A trivia question both of you get wrong in the same way
// still says something about the two of you, which is the point of the
// feature.

/**
 * Compared case- and whitespace-insensitively, the same way the existing
 * guess-partner comparison already worked. "Pizza" and "pizza " are the
 * same answer, and treating them otherwise would make the score feel broken.
 */
export function answersMatch(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

/**
 * The title for a completed quiz.
 *
 * The bands are the ones asked for:
 *   every answer the same          -> Perfect Match
 *   more than half, but not all    -> Strong Connection
 *   less than half                 -> Growing Together
 *
 * Exactly half was not specified and has to land somewhere. It goes to
 * Growing Together, because the Strong Connection band is defined as
 * "more than half" and half is not more than half. With an even number of
 * questions this is reachable, so it is a real case rather than a
 * hypothetical one.
 */
export function matchResult(matched, total) {
  if (!total || total <= 0) return null;

  const fraction = matched / total;

  if (matched === total) {
    return {
      title: 'Perfect Match',
      blurb: 'Every single answer the same. You two are in sync.',
      tier: 'perfect',
      matched,
      total,
      fraction,
    };
  }

  if (fraction > 0.5) {
    return {
      title: 'Strong Connection',
      blurb: `${matched} of ${total} answers matched. You know each other well.`,
      tier: 'strong',
      matched,
      total,
      fraction,
    };
  }

  return {
    title: 'Growing Together',
    blurb: matched === 0
      ? 'No matches this time — plenty left to discover about each other.'
      : `${matched} of ${total} matched. Still learning each other, and that's the fun part.`,
    tier: 'growing',
    matched,
    total,
    fraction,
  };
}
