import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Anthropic from '@anthropic-ai/sdk';

const here = dirname(fileURLToPath(import.meta.url)); // no __dirname in ESM

/**
 * Where tomorrow's daily prompts come from.
 *
 * Three providers, chosen by what's configured, each falling back to the next
 * so the app is never left without a prompt:
 *
 *   claude  — generates fresh questions on a random topic (needs an API key)
 *   http    — pulls from any URL returning a JSON array or newline-separated
 *             text, for a dataset you host or point at
 *   local   — recombines the seeded bank; always works, no network
 */

// Deliberately broad: a couple who've been together years shouldn't get the
// same three getting-to-know-you themes on a loop.
export const TOPICS = [
  'everyday gratitude', 'how we first met', 'the future we want',
  'small habits we love in each other', 'travel and places',
  'food and shared rituals', 'money and how we handle it',
  'family and the people around us', 'conflict and repair',
  'what makes each of us feel safe', 'nostalgia and childhood',
  'ambitions and work', 'rest, hobbies and play', 'intimacy and affection',
  'the last year of us', 'what we find funny', 'home and how we live',
  'fears we do not say out loud', 'music, films and taste',
  'things we still want to learn', 'friendship inside the relationship',
  'how we say sorry', 'what we are proud of', 'seasons and time passing',
];

export function pickTopic(random = Math.random) {
  return TOPICS[Math.floor(random() * TOPICS.length)];
}

const MIN_LENGTH = 15;
const MAX_LENGTH = 220;

/**
 * Questions land in front of two people with no moderation in between, so
 * anything that isn't a plausible, self-contained question is dropped rather
 * than shown. Also strips list numbering, which every text source has.
 */
export function normalizeQuestions(raw, { limit = 6 } = {}) {
  const seen = new Set();
  const out = [];

  for (const entry of Array.isArray(raw) ? raw : []) {
    const text =
      typeof entry === 'string'
        ? entry
        : entry && typeof entry === 'object'
          ? entry.question || entry.content || entry.text || entry.prompt || ''
          : '';

    const cleaned = String(text)
      .replace(/^\s*[\d]+[.)]\s*/, '')   // "1. " / "12) "
      .replace(/^\s*[-*•]\s*/, '')       // bullets
      .replace(/\s+/g, ' ')
      .trim();

    if (cleaned.length < MIN_LENGTH || cleaned.length > MAX_LENGTH) continue;
    if (!cleaned.endsWith('?')) continue;
    if (/[<>{}]|https?:\/\//i.test(cleaned)) continue; // markup or a stray URL

    const key = cleaned.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (seen.has(key)) continue;
    seen.add(key);

    out.push(cleaned);
    if (out.length >= limit) break;
  }

  return out;
}

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
  '&nbsp;': ' ', '&rsquo;': "'", '&lsquo;': "'", '&ldquo;': '"', '&rdquo;': '"',
  '&mdash;': '\u2014', '&ndash;': '\u2013', '&hellip;': '\u2026',
};

function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&[a-z]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity);
}

/**
 * Turns a web page into candidate questions.
 *
 * Most "100 questions to ask your partner" pages put one question per list
 * item or paragraph, so block-level tags become line breaks and each line is a
 * candidate. Pages that run questions together inside prose are covered by a
 * second pass that pulls out any sentence ending in a question mark.
 */
export function htmlToQuestions(html) {
  const text = decodeEntities(
    String(html)
      .replace(/<(script|style|noscript|template)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      // Block-level ends become line breaks so list items stay separate.
      .replace(/<\s*(br|\/p|\/li|\/h[1-6]|\/div|\/td|\/tr|\/blockquote)[^>]*>/gi, '\n')
      .replace(/<[^>]*>/g, ' ')
  );

  const lines = text.split('\n').map((line) => line.replace(/\s+/g, ' ').trim());
  const fromLines = lines.filter((line) => line.endsWith('?'));

  // Sentence pass: catches questions embedded in running prose.
  const fromProse = (text.replace(/\s+/g, ' ').match(/[^.!?]{15,200}\?/g) || [])
    .map((sentence) => sentence.trim());

  return [...fromLines, ...fromProse];
}

const SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
    },
  },
  required: ['questions'],
  additionalProperties: false,
};

/** Generates questions on a topic. Returns [] rather than throwing. */
export async function fetchFromClaude(topic, count, { client } = {}) {
  const apiKey = process.env.PROMPT_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!client && !apiKey) return [];

  const anthropic = client || new Anthropic({ apiKey });

  const response = await anthropic.beta.messages.create({
    model: 'claude-opus-5',
    max_tokens: 2000,
    // Opus 5 can decline; without this a refusal just stops. "default" routes
    // by refusal category so there's no fallback model list to maintain.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: {
      // Writing six short questions is not an intelligence-sensitive task.
      effort: 'low',
      format: { type: 'json_schema', schema: SCHEMA },
    },
    system:
      'You write daily conversation prompts for a couple who use a private app together. ' +
      'Each prompt is ONE open question, warm and specific, answerable in a few sentences by ' +
      'either partner. Never assume gender, marital status, children, living arrangements or ' +
      'sexuality. Avoid anything interrogating, therapeutic or accusatory. Vary the shape — ' +
      'some memory, some imagination, some preference. No numbering, no preamble.',
    messages: [
      {
        role: 'user',
        content: `Write ${count} distinct questions on the theme: ${topic}.`,
      },
    ],
  });

  if (response.stop_reason === 'refusal') return [];

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }

  return normalizeQuestions(parsed?.questions, { limit: count });
}

/** Pulls from a URL returning a JSON array, {questions:[...]}, or plain lines. */
export async function fetchFromHttp(url, count, { fetchImpl = fetch } = {}) {
  if (!url) return [];

  const response = await fetchImpl(url, {
    headers: {
      Accept: 'text/html,application/json,text/plain',
      // Plenty of sites reject a request with no User-Agent outright. This is
      // one request a day for two people's own use, not a crawl.
      'User-Agent': 'Mozilla/5.0 (compatible; loversrock/1.0; +self-hosted couples app)',
      'Accept-Language': 'en',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) return [];

  const body = await response.text();
  const contentType = response.headers?.get?.('content-type') || '';

  let candidates;
  try {
    const json = JSON.parse(body);
    candidates = Array.isArray(json)
      ? json
      : json?.questions || json?.prompts || json?.data || [];
  } catch {
    // Not JSON. A web page needs its markup stripped first; anything else is
    // treated as one question per line.
    candidates =
      /html/i.test(contentType) || /<\s*(html|body|ul|ol|li|p|div)\b/i.test(body)
        ? htmlToQuestions(body)
        : body.split('\n');
  }

  // Shuffle so a static list doesn't yield the same six every day.
  return normalizeQuestions(shuffle(candidates), { limit: count });
}

let localBank = null;

/** The seeded bank. Always available, so the app is never promptless. */
export function fetchFromLocal(count, { exclude = [] } = {}) {
  if (!localBank) {
    const bank = [];
    for (const file of ['daily_prompts.json', 'deck_questions.json']) {
      try {
        const rows = JSON.parse(readFileSync(join(here, '../../seed', file), 'utf8'));
        for (const row of rows) if (row?.content) bank.push(row.content);
      } catch {
        // A missing seed file just means a smaller bank.
      }
    }
    localBank = bank;
  }

  const taken = new Set(exclude.map((q) => q.toLowerCase().replace(/[^a-z0-9]/g, '')));
  const fresh = localBank.filter(
    (q) => !taken.has(q.toLowerCase().replace(/[^a-z0-9]/g, ''))
  );

  return normalizeQuestions(shuffle(fresh), { limit: count });
}

/** PROMPT_SOURCE_URL may hold several comma-separated URLs; try them in a
 *  random order so one page isn't always the source. */
export function sourceUrls() {
  return shuffle(
    (process.env.PROMPT_SOURCE_URL || '')
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean)
  );
}

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Tries each configured provider in turn. `exclude` is the questions already
 * scheduled, so a source that repeats itself doesn't produce a duplicate.
 */
export async function fetchQuestions({ count = 6, exclude = [], topic } = {}) {
  const chosenTopic = topic || pickTopic();
  const attempts = [];

  const hasKey = Boolean(process.env.PROMPT_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY);
  if (hasKey) attempts.push(['claude', () => fetchFromClaude(chosenTopic, count)]);
  for (const url of sourceUrls()) {
    attempts.push([`http:${url}`, () => fetchFromHttp(url, count)]);
  }
  attempts.push(['local', async () => fetchFromLocal(count, { exclude })]);

  const seen = new Set(exclude.map((q) => q.toLowerCase().replace(/[^a-z0-9]/g, '')));

  for (const [source, run] of attempts) {
    let questions = [];
    try {
      questions = await run();
    } catch (err) {
      console.error(`[prompts] source "${source}" failed: ${err.message}`);
      continue;
    }

    const fresh = questions.filter(
      (q) => !seen.has(q.toLowerCase().replace(/[^a-z0-9]/g, ''))
    );
    if (fresh.length) return { source, topic: chosenTopic, questions: fresh };
  }

  return { source: 'none', topic: chosenTopic, questions: [] };
}
