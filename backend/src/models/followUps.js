// Building a follow-up question out of somebody's answer.
//
// No LLM, and that is a constraint rather than a compromise: the templates are
// written by hand and the only thing filled in is what your partner actually
// wrote, verbatim. Nothing rewrites, summarises or interprets their words —
// which for a question that will be read as "they said this about me" matters
// more than any amount of cleverness would.

/** Longest quote we will inline before it stops reading as a question. */
const MAX_QUOTE = 90;

/**
 * Trims a quote to something that fits inside a sentence.
 *
 * Cut at a word boundary, because a quote that ends mid-word looks like a bug
 * rather than an ellipsis. And never cut so hard that nothing recognisable is
 * left — a two-word stub attributed to somebody is worse than no quote.
 */
export function quote(answer) {
  const text = String(answer || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (text.length <= MAX_QUOTE) return text;

  const cut = text.slice(0, MAX_QUOTE);
  const lastSpace = cut.lastIndexOf(' ');
  // If the first "word" is longer than the limit there is no space to cut at,
  // and slicing to -1 would produce an empty string.
  const kept = lastSpace > MAX_QUOTE * 0.5 ? cut.slice(0, lastSpace) : cut;
  return `${kept.replace(/[,;:.\s]+$/, '')}…`;
}

/**
 * Renders a template against an answer.
 *
 * Returns null when there is nothing worth quoting, which is the caller's
 * signal not to offer a follow-up at all. A follow-up that says
 * You said "". What is behind that?
 * is worse than no follow-up.
 */
export function renderFollowUp(template, answer) {
  const q = quote(answer);
  if (!q) return null;
  if (!template?.includes('{answer}')) return null;
  return template.replaceAll('{answer}', q);
}

/**
 * Picks one template for a pair, deterministically.
 *
 * Deterministic because the pick is stored on first read and must be the same
 * if two devices race to create it — and because a follow-up that re-rolled
 * between opening the screen and answering would attach the answer to a
 * question nobody saw.
 */
export function pickTemplate(templates, seed) {
  if (!templates?.length) return null;
  let hash = 0;
  for (const ch of String(seed)) hash = (hash * 31 + ch.charCodeAt(0)) % 2147483647;
  return templates[hash % templates.length];
}
