// Fresh content from the same AI connector as the quiz (QUIZ_LLM_* in
// backend/.env, e.g. Gemini): daily prompts, date ideas (which are also the
// Swipe Dates cards), bucket-list ideas and challenges.
//
// Each kind has its own instructions and its own checks. Nothing the model
// writes reaches the app until those checks pass: the right shape, sensible
// lengths, an allowed category, and not a repeat of something already there.
// Anything that fails is dropped, never patched. With no connector set up,
// every function here returns nothing and the app runs on what it has.
import { query } from '../config/db.js';
import { quizLlmConfig, askLlm, parseJsonList } from './quizGenerator.js';
import { normalizeQuestions } from '../services/promptSources.js';

const TONE = 'The app is private, for one couple in a long-distance relationship. '
  + 'Tone: warm, playful and affectionate, suitable for any couple. '
  + 'Nothing sexual, political, religious or upsetting, and nothing that assumes a gender, religion, budget or where they live.';

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const key = (s) => clean(s).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '');
const avoidBlock = (avoid) => (avoid.length
  ? avoid.slice(-80).map((a) => `- ${a}`).join('\n')
  : '- (none yet)');

/**
 * Asks, checks, and asks again for what was dropped: up to three rounds, each
 * told what the others already produced so a second round cannot repeat the
 * first.
 */
async function generate({ config, count, avoid, listKey, system, user, schema, check }) {
  if (!config || count <= 0) return [];
  const got = [];
  for (let round = 0; round < 3 && got.length < count; round += 1) {
    const avoidNow = [...avoid, ...got.map((g) => g.title ?? g)];
    const want = Math.min(20, count - got.length);
    const text = await askLlm(config, { system, user: user(want, avoidNow), schema });
    const fresh = check(parseJsonList(text, listKey), avoidNow);
    got.push(...fresh.slice(0, want));
    if (!fresh.length) break;
  }
  return got.slice(0, count);
}

const listSchema = (listKey, item) => ({
  type: 'object', additionalProperties: false, required: [listKey],
  properties: { [listKey]: { type: 'array', items: item } },
});

// ------------------------------------------------------------ daily prompts

/** Daily prompt questions: open questions you both answer. */
export async function generatePrompts(count, avoid = [], { topic, config = quizLlmConfig() } = {}) {
  return generate({
    config, count, avoid, listKey: 'questions',
    system: `You write the daily question for a couples app: one open question that both partners answer in their own words, then read each other's answer. ${TONE} `
      + 'Each is a single question ending in "?", 15 to 200 characters, answerable by anyone, and different from the others and from the ones listed as used.',
    user: (n, used) => `Write ${n} new daily questions${topic ? ` on the theme "${topic}"` : ''}.\n\n`
      + `Already used, do not repeat or closely paraphrase:\n${avoidBlock(used)}\n\n`
      + 'Reply with JSON only: {"questions": ["...", "..."]}.',
    schema: listSchema('questions', { type: 'string' }),
    check: (raw, used) => {
      const seen = new Set(used.map(key));
      return normalizeQuestions(raw, { limit: 50 }).filter((q) => {
        if (seen.has(key(q))) return false;
        seen.add(key(q));
        return true;
      });
    },
  });
}

// --------------------------------------------------------------- date ideas

export const DATE_CATEGORIES = ['at_home', 'outdoors', 'culture', 'sentimental', 'going_out', 'splurge'];
export const COST_TIERS = ['free', '$', '$$', '$$$'];

/** Date ideas, the catalogue behind both Date Ideas and Swipe Dates. */
export async function generateDateIdeas(count, avoid = [], { config = quizLlmConfig() } = {}) {
  return generate({
    config, count, avoid, listKey: 'ideas',
    system: `You suggest date ideas for a couples app. ${TONE} `
      + 'Include ideas they can do together over a video call while apart, as well as ideas for when they are together. '
      + `Each has: a title (3 to 60 characters, starts with a verb, no trailing full stop); a description (one or two sentences, under 200 characters, saying how to actually do it); a category, one of ${DATE_CATEGORIES.join(', ')}; and a costTier, one of ${COST_TIERS.join(', ')}.`,
    user: (n, used) => `Suggest ${n} new date ideas, mixing categories and costs.\n\n`
      + `Already in the catalogue, do not repeat or closely paraphrase:\n${avoidBlock(used)}\n\n`
      + 'Reply with JSON only: {"ideas": [{"title": "...", "description": "...", "category": "...", "costTier": "..."}]}.',
    schema: listSchema('ideas', {
      type: 'object', additionalProperties: false, required: ['title', 'description', 'category', 'costTier'],
      properties: {
        title: { type: 'string' }, description: { type: 'string' },
        category: { type: 'string', enum: DATE_CATEGORIES }, costTier: { type: 'string', enum: COST_TIERS },
      },
    }),
    check: (raw, used) => {
      const seen = new Set(used.map(key));
      const out = [];
      for (const r of Array.isArray(raw) ? raw : []) {
        const title = clean(r?.title).replace(/\.$/, '');
        const description = clean(r?.description);
        if (title.length < 3 || title.length > 60) continue;
        if (description.length < 10 || description.length > 240) continue;
        if (!DATE_CATEGORIES.includes(r?.category) || !COST_TIERS.includes(r?.costTier)) continue;
        if (/[<>{}]|https?:\/\//i.test(title + description)) continue;
        if (seen.has(key(title))) continue;
        seen.add(key(title));
        out.push({ title, description, category: r.category, costTier: r.costTier });
      }
      return out;
    },
  });
}

// ------------------------------------------------------- bucket-list ideas

/** Things to do together one day: suggestions for the shared bucket list. */
export async function generateBucketIdeas(count, avoid = [], { config = quizLlmConfig() } = {}) {
  return generate({
    config, count, avoid, listKey: 'ideas',
    system: `You suggest bucket-list items for a couple to do together one day. ${TONE} `
      + 'Each is a short goal (4 to 70 characters, starts with a verb, no trailing full stop), specific enough to picture but not tied to one city. Mix small near-term ones with big dreams.',
    user: (n, used) => `Suggest ${n} new bucket-list items.\n\n`
      + `Already suggested, do not repeat or closely paraphrase:\n${avoidBlock(used)}\n\n`
      + 'Reply with JSON only: {"ideas": ["...", "..."]}.',
    schema: listSchema('ideas', { type: 'string' }),
    check: (raw, used) => {
      const seen = new Set(used.map(key));
      const out = [];
      for (const r of Array.isArray(raw) ? raw : []) {
        const title = clean(r).replace(/\.$/, '');
        if (title.length < 4 || title.length > 70 || /[<>{}?]|https?:\/\//i.test(title)) continue;
        if (seen.has(key(title))) continue;
        seen.add(key(title));
        out.push(title);
      }
      return out;
    },
  });
}

// --------------------------------------------------------------- challenges

export const CHALLENGE_CATEGORIES = ['words', 'attention', 'acts', 'together', 'repair'];
export const CHALLENGE_SCOPES = ['now', 'today', 'week'];

/** Small things to actually do for each other, drawn from Home. */
export async function generateChallenges(count, avoid = [], { config = quizLlmConfig() } = {}) {
  return generate({
    config, count, avoid, listKey: 'challenges',
    system: `You write small relationship challenges: one concrete thing to do for or with your partner. ${TONE} `
      + 'Doable from a distance unless it says otherwise. '
      + `Each has: a title (3 to 50 characters); a detail (one or two sentences, under 200 characters, saying exactly what to do); a scope, one of ${CHALLENGE_SCOPES.join(', ')} (how long it takes: now = a minute, today, or this week); and a category, one of ${CHALLENGE_CATEGORIES.join(', ')}.`,
    user: (n, used) => `Write ${n} new challenges, mixing scopes and categories.\n\n`
      + `Already written, do not repeat or closely paraphrase:\n${avoidBlock(used)}\n\n`
      + 'Reply with JSON only: {"challenges": [{"title": "...", "detail": "...", "scope": "...", "category": "..."}]}.',
    schema: listSchema('challenges', {
      type: 'object', additionalProperties: false, required: ['title', 'detail', 'scope', 'category'],
      properties: {
        title: { type: 'string' }, detail: { type: 'string' },
        scope: { type: 'string', enum: CHALLENGE_SCOPES }, category: { type: 'string', enum: CHALLENGE_CATEGORIES },
      },
    }),
    check: (raw, used) => {
      const seen = new Set(used.map(key));
      const out = [];
      for (const r of Array.isArray(raw) ? raw : []) {
        const title = clean(r?.title).replace(/\.$/, '');
        const detail = clean(r?.detail);
        if (title.length < 3 || title.length > 50 || detail.length < 10 || detail.length > 240) continue;
        if (!CHALLENGE_SCOPES.includes(r?.scope) || !CHALLENGE_CATEGORIES.includes(r?.category)) continue;
        if (/[<>{}]|https?:\/\//i.test(title + detail)) continue;
        if (seen.has(key(title))) continue;
        seen.add(key(title));
        out.push({ title, detail, scope: r.scope, category: r.category });
      }
      return out;
    },
  });
}

// -------------------------------------------------------- into the database

const slugify = (s) => clean(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

/**
 * Adds fresh date ideas, bucket-list ideas and challenges, a few of each, so
 * the catalogues keep growing without ever repeating. Returns what was added.
 * `dryRun` asks and checks but writes nothing.
 */
export async function growCatalogues({
  dateIdeas = 6, bucketIdeas = 8, challenges = 4, config = quizLlmConfig(), dryRun = false,
} = {}) {
  const added = { dateIdeas: [], bucketIdeas: [], challenges: [] };
  if (!config) return added;

  if (dateIdeas > 0) {
    const { rows } = await query('SELECT title FROM date_ideas WHERE pair_id IS NULL');
    const ideas = await generateDateIdeas(dateIdeas, rows.map((r) => r.title), { config });
    for (const idea of ideas) {
      if (!dryRun) {
        await query(
          `INSERT INTO date_ideas (pair_id, title, description, category, cost_tier, source)
           SELECT NULL, $1, $2, $3, $4, 'ai'
           WHERE NOT EXISTS (SELECT 1 FROM date_ideas WHERE pair_id IS NULL AND lower(title) = lower($1))`,
          [idea.title, idea.description, idea.category, idea.costTier]
        );
      }
      added.dateIdeas.push(idea);
    }
  }

  if (bucketIdeas > 0) {
    const { rows } = await query('SELECT title FROM bucket_suggestions');
    const ideas = await generateBucketIdeas(bucketIdeas, rows.map((r) => r.title), { config });
    for (const title of ideas) {
      if (!dryRun) {
        await query(
          `INSERT INTO bucket_suggestions (title, source) VALUES ($1, 'ai') ON CONFLICT DO NOTHING`,
          [title]
        );
      }
      added.bucketIdeas.push(title);
    }
  }

  if (challenges > 0) {
    const { rows } = await query('SELECT title FROM challenges');
    const made = await generateChallenges(challenges, rows.map((r) => r.title), { config });
    for (const c of made) {
      if (!dryRun) {
        await query(
          `INSERT INTO challenges (slug, title, detail, scope, category, source)
           VALUES ($1, $2, $3, $4, $5, 'ai') ON CONFLICT (slug) DO NOTHING`,
          [`ai-${slugify(c.title)}`, c.title, c.detail, c.scope, c.category]
        );
      }
      added.challenges.push(c);
    }
  }
  return added;
}
