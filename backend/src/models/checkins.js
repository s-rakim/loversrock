// The monthly check-in.
//
// Eight questions, the same eight every month, on purpose. A check-in whose
// questions change is a conversation; a check-in whose questions stay put is a
// measurement, and the whole reason to write any of this down is to be able to
// say "we were at 6 in March and 9 in June".
//
// Keys, not text. The wording can be improved in a year without orphaning a
// year of answers, and the charts keep working.
export const CHECKIN_QUESTIONS = [
  {
    key: 'connected',
    kind: 'score',
    prompt: 'How connected have you felt to me this month?',
    low: 'Distant',
    high: 'Very close',
  },
  {
    key: 'heard',
    kind: 'score',
    prompt: 'How well do you feel heard when something is bothering you?',
    low: 'Not really',
    high: 'Completely',
  },
  {
    key: 'appreciated',
    kind: 'score',
    prompt: 'How appreciated have you felt?',
    low: 'Taken for granted',
    high: 'Very',
  },
  {
    key: 'time',
    kind: 'score',
    prompt: 'How was the amount of time we spent together?',
    low: 'Not enough',
    high: 'Just right',
  },
  {
    key: 'best',
    kind: 'text',
    prompt: 'What was the best thing about this month for us?',
  },
  {
    key: 'harder',
    kind: 'text',
    prompt: 'What was harder than it needed to be?',
  },
  {
    key: 'more',
    kind: 'text',
    // The one that does the most work. A check-in that only looks backwards
    // is a report; this is the line that turns it into something to do.
    prompt: 'What is one thing you would like more of next month?',
  },
  {
    key: 'thanks',
    kind: 'text',
    prompt: 'What is one thing you want to thank me for?',
  },
];

export const SCORE_KEYS = CHECKIN_QUESTIONS.filter((q) => q.kind === 'score').map((q) => q.key);
const BY_KEY = new Map(CHECKIN_QUESTIONS.map((q) => [q.key, q]));

/** The first of the month a date falls in, as YYYY-MM-01. */
export function monthOf(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

/**
 * Validates one submitted answer.
 *
 * Returns `{ ok, value }` or `{ ok: false, error }`. Scores are clamped rather
 * than rejected on the grounds that a slider that sends 11 is a client bug,
 * and losing somebody's whole check-in to it would be worse than recording 10.
 */
export function normalizeAnswer(key, { score, answer } = {}) {
  const question = BY_KEY.get(key);
  if (!question) return { ok: false, error: `Unknown check-in question: ${key}` };

  if (question.kind === 'score') {
    const n = Number(score);
    if (!Number.isFinite(n)) return { ok: false, error: `${key} needs a score` };
    return { ok: true, value: { score: Math.min(10, Math.max(1, Math.round(n))), answer: null } };
  }

  const text = typeof answer === 'string' ? answer.trim() : '';
  if (!text) return { ok: false, error: `${key} needs an answer` };
  return { ok: true, value: { score: null, answer: text.slice(0, 1000) } };
}

/** The average of the score questions somebody answered, or null. */
export function averageScore(answers) {
  const scores = answers.filter((a) => SCORE_KEYS.includes(a.question_key) && a.score != null);
  if (scores.length === 0) return null;
  return Number((scores.reduce((sum, a) => sum + a.score, 0) / scores.length).toFixed(1));
}
