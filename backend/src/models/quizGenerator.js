// Fresh daily-quiz questions from a language model — optional.
//
// With nothing configured the quiz recycles its own bank (see
// refillQuizBank in cron/index.js), exactly as before. Setting a provider and
// a key in backend/.env turns this on:
//
//   QUIZ_LLM_PROVIDER   anthropic | openai | gemini | groq | openrouter |
//                       mistral | deepseek | together | ollama | custom
//   QUIZ_LLM_API_KEY    the key from that provider (not needed for ollama)
//   QUIZ_LLM_MODEL      which model — required for everything but anthropic
//   QUIZ_LLM_BASE_URL   optional; required for `custom`, and overrides the
//                       preset address for any of the others
//
// Claude goes through Anthropic's own SDK with a JSON schema, so the reply is
// guaranteed to be well-formed. Every other provider is reached through the
// OpenAI-compatible chat API they all offer. Either way, nothing the model
// says reaches the app until validateQuestions() has checked it: the right
// number of choices, a trivia answer that is one of its choices, no repeats of
// a question already in the bank. Anything that fails is dropped, not fixed.
import Anthropic from '@anthropic-ai/sdk';
import { query } from '../config/db.js';

export const QUIZ_TYPES = ['trivia', 'guess_partner', 'this_or_that'];
const QUESTIONS_PER_DAY = 5;
const MAX_PER_CALL = 20;
const TIMEOUT_MS = 90_000;
// The Anthropic default; set QUIZ_LLM_MODEL to use another (claude-haiku-4-5
// is the cheapest, and plenty for this).
const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5';

/** Where each provider's OpenAI-compatible API lives. */
export const PROVIDER_URLS = {
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  mistral: 'https://api.mistral.ai/v1',
  deepseek: 'https://api.deepseek.com',
  together: 'https://api.together.xyz/v1',
  // The Ollama on the machine running Docker, reached from inside the container.
  ollama: 'http://host.docker.internal:11434/v1',
};

/**
 * The generator's settings from the environment, or null when it is off.
 * Throws with a plain explanation when it is half set up, so a typo is a
 * clear message in the log rather than a silent fall back to recycling.
 */
export function quizLlmConfig(env = process.env) {
  const provider = String(env.QUIZ_LLM_PROVIDER || '').trim().toLowerCase();
  if (!provider) return null;

  const known = ['anthropic', 'custom', ...Object.keys(PROVIDER_URLS)];
  if (!known.includes(provider)) {
    throw new Error(`QUIZ_LLM_PROVIDER "${provider}" is not one of: ${known.join(', ')}`);
  }
  const apiKey = String(env.QUIZ_LLM_API_KEY || '').trim();
  if (!apiKey && provider !== 'ollama') throw new Error(`QUIZ_LLM_API_KEY is needed for ${provider}`);

  const model = String(env.QUIZ_LLM_MODEL || '').trim()
    || (provider === 'anthropic' ? ANTHROPIC_DEFAULT_MODEL : '');
  if (!model) throw new Error(`QUIZ_LLM_MODEL is needed for ${provider} — the model name from that provider's docs`);

  const baseUrl = String(env.QUIZ_LLM_BASE_URL || '').trim().replace(/\/+$/, '') || PROVIDER_URLS[provider] || null;
  if (provider === 'custom' && !baseUrl) throw new Error('QUIZ_LLM_BASE_URL is needed for a custom provider');

  return { provider, apiKey, model, baseUrl };
}

// ------------------------------------------------------------------ prompt

const SYSTEM = `You write questions for a daily quiz inside a private app for one couple in a long-distance relationship. Both partners answer the same questions each day and then see each other's answers.

Three kinds of question:
- "trivia": a general-knowledge question with exactly 4 choices and one correct answer, which must be copied exactly into correctAnswer. Only use facts that are well established and not in dispute; nothing that changes over time (no "current" holders, records or prices).
- "guess_partner": a question about personal taste or habits, with exactly 4 choices, which each partner answers for themselves so they can see if they match. correctAnswer is null.
- "this_or_that": a quick either/or preference with exactly 2 choices. correctAnswer is null.

Tone: warm, playful and affectionate, suitable for any couple. Nothing sexual, political, religious or upsetting. Keep each question under 120 characters and each choice under 40. Every question must be different from the others and from the ones the user lists as already used.`;

function userPrompt(count, avoid) {
  const mix = { trivia: Math.round(count * 0.35), this_or_that: Math.round(count * 0.3) };
  mix.guess_partner = count - mix.trivia - mix.this_or_that;
  const avoidList = avoid.slice(-80).map((q) => `- ${q}`).join('\n');
  return `Write ${count} new questions: about ${mix.trivia} trivia, ${mix.guess_partner} guess_partner and ${mix.this_or_that} this_or_that, mixed together.

Already used, do not repeat or closely paraphrase:
${avoidList || '- (none yet)'}

Reply with JSON only, in the form {"questions": [{"type": "...", "questionText": "...", "choices": ["..."], "correctAnswer": "..." or null}]}.`;
}

/** The reply's shape, for Claude's structured output. */
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'questionText', 'choices', 'correctAnswer'],
        properties: {
          type: { type: 'string', enum: QUIZ_TYPES },
          questionText: { type: 'string' },
          choices: { type: 'array', items: { type: 'string' } },
          correctAnswer: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
      },
    },
  },
};

// --------------------------------------------------------------- providers

async function askAnthropic(config, count, avoid) {
  const client = new Anthropic({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    timeout: TIMEOUT_MS,
    maxRetries: 1,
  });
  const response = await client.messages.create({
    model: config.model,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: 'user', content: userPrompt(count, avoid) }],
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
  });
  if (response.stop_reason === 'refusal') throw new Error('the model declined');
  if (response.stop_reason === 'max_tokens') throw new Error('the reply was cut off');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return parseReply(text);
}

async function askOpenAiCompatible(config, count, avoid) {
  const body = {
    model: config.model,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: userPrompt(count, avoid) },
    ],
    temperature: 0.9,
    response_format: { type: 'json_object' },
  };
  const send = (payload) => fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  let res = await send(body);
  // Not every model behind these APIs accepts a JSON response format; the
  // prompt asks for JSON anyway, so try once more without it.
  if (res.status === 400) {
    const { response_format: _dropped, ...plain } = body;
    res = await send(plain);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`${config.provider} answered ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  const data = await res.json();
  return parseReply(data?.choices?.[0]?.message?.content ?? '');
}

/** The questions out of a reply, tolerating code fences and chatter around the JSON. */
export function parseReply(text) {
  const raw = String(text || '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('the reply had no JSON in it');
  const parsed = JSON.parse(raw.slice(start, end + 1));
  if (!Array.isArray(parsed?.questions)) throw new Error('the reply had no questions list');
  return parsed.questions;
}

// -------------------------------------------------------------- validation

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const key = (s) => clean(s).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '');

/**
 * What the model wrote, reduced to questions the quiz can actually use.
 * Drops, never repairs: a trivia question whose answer is not among its
 * choices is wrong in a way no fix-up can be trusted to get right.
 */
export function validateQuestions(raw, avoid = []) {
  const seen = new Set(avoid.map(key));
  const out = [];
  for (const q of Array.isArray(raw) ? raw : []) {
    const type = q?.type;
    if (!QUIZ_TYPES.includes(type)) continue;
    const questionText = clean(q.questionText);
    if (questionText.length < 8 || questionText.length > 160) continue;
    const choices = (Array.isArray(q.choices) ? q.choices : []).map(clean).filter(Boolean);
    if (choices.some((c) => c.length > 80)) continue;
    if (new Set(choices.map((c) => c.toLowerCase())).size !== choices.length) continue;
    if (choices.length !== (type === 'this_or_that' ? 2 : 4)) continue;

    let correctAnswer = null;
    if (type === 'trivia') {
      correctAnswer = choices.find((c) => c.toLowerCase() === clean(q.correctAnswer).toLowerCase()) || null;
      if (!correctAnswer) continue;
    }
    if (seen.has(key(questionText))) continue;
    seen.add(key(questionText));
    out.push({ type, questionText, choices, correctAnswer });
  }
  return out;
}

/** Fresh, checked questions: as many as it could get, up to `count`. */
export async function generateQuizQuestions(count, avoid = [], config = quizLlmConfig()) {
  if (!config) return [];
  const ask = config.provider === 'anthropic' ? askAnthropic : askOpenAiCompatible;
  const got = [];
  // Asked in batches, with what came back added to the avoid list, so a
  // second batch cannot repeat the first.
  for (let attempt = 0; attempt < 4 && got.length < count; attempt += 1) {
    const want = Math.min(MAX_PER_CALL, count - got.length);
    const avoidNow = [...avoid, ...got.map((q) => q.questionText)];
    const fresh = validateQuestions(await ask(config, want, avoidNow), avoidNow);
    got.push(...fresh.slice(0, want));
    if (fresh.length === 0) break;
  }
  return got.slice(0, count);
}

// ---------------------------------------------------------------- the bank

const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

/**
 * Puts fresh questions on upcoming quiz days.
 *
 * A day is only replaced while nobody has answered any of it, so this can
 * never change a question under someone mid-quiz. With `onlyRecycled`, it
 * also leaves alone days that already have new questions — which is what the
 * nightly job wants, so it does not pay to replace fresh questions with
 * fresher ones.
 *
 * @returns {{ days: string[], questions: number }}
 */
export async function freshenUpcomingDays({
  days = 7, includeToday = false, onlyRecycled = true, today = new Date(), config = quizLlmConfig(), dryRun = false,
} = {}) {
  if (!config) return { days: [], questions: 0 };

  const first = new Date(today);
  first.setUTCHours(0, 0, 0, 0);
  if (!includeToday) first.setUTCDate(first.getUTCDate() + 1);
  const targets = Array.from({ length: days }, (_, i) => {
    const d = new Date(first);
    d.setUTCDate(d.getUTCDate() + i);
    return dayKey(d);
  });

  const { rows } = await query(
    `SELECT q.scheduled_date, q.question_text,
            EXISTS (SELECT 1 FROM quiz_attempts a WHERE a.quiz_question_id = q.id) AS answered,
            EXISTS (SELECT 1 FROM quiz_questions o
                     WHERE o.question_text = q.question_text AND o.scheduled_date < q.scheduled_date) AS repeat
       FROM quiz_questions q
      WHERE q.scheduled_date = ANY($1::date[])`,
    [targets]
  );
  const byDay = new Map(targets.map((d) => [d, []]));
  for (const r of rows) byDay.get(dayKey(r.scheduled_date))?.push(r);

  const replace = targets.filter((d) => {
    const qs = byDay.get(d);
    if (qs.some((q) => q.answered)) return false;
    if (onlyRecycled && qs.length > 0 && !qs.every((q) => q.repeat)) return false;
    return true;
  });
  if (replace.length === 0) return { days: [], questions: 0 };

  const { rows: bank } = await query('SELECT DISTINCT question_text FROM quiz_questions');
  const fresh = await generateQuizQuestions(replace.length * QUESTIONS_PER_DAY, bank.map((r) => r.question_text), config);
  const fullDays = Math.floor(fresh.length / QUESTIONS_PER_DAY);
  const filled = replace.slice(0, fullDays);
  if (dryRun) return { days: filled, questions: fresh.length, preview: fresh };

  for (const [n, day] of filled.entries()) {
    await query('DELETE FROM quiz_questions WHERE scheduled_date = $1', [day]);
    for (let order = 1; order <= QUESTIONS_PER_DAY; order += 1) {
      const q = fresh[n * QUESTIONS_PER_DAY + order - 1];
      await query(
        `INSERT INTO quiz_questions
           (scheduled_date, question_order, type, question_text, choices, correct_answer)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (scheduled_date, question_order) DO NOTHING`,
        [day, order, q.type, q.questionText, JSON.stringify(q.choices), q.correctAnswer]
      );
    }
  }
  return { days: filled, questions: filled.length * QUESTIONS_PER_DAY };
}
