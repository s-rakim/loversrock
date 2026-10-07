// Fable: the group chat between the two of you and an AI model.
//
// Everything lives in this backend: the messages (fable_messages), how Fable
// behaves (fable_settings), and the connections it reaches models through
// (ai_connections, models/aiConnections.js — Collaboration des Esprits'
// connection layer). The phones never see a key: they paste one in once, and
// from then on only its length and last four characters come back.
//
// A connection is any endpoint speaking OpenAI's /chat/completions or
// Anthropic's /messages: Gemini, Groq, OpenRouter, NVIDIA and Mistral on
// their free tiers, OpenAI, Claude, Ollama on the PC, or any address you
// type. Or the setup page can point Fable at backend/.env's own connector.
import { query } from '../config/db.js';
import { PROVIDER_URLS, serverLlmConfig, networkError } from './quizGenerator.js';
import { setSharedAiConfig } from './aiShared.js';
import {
  resolveConnection, listConnections, probe, headersFor, asSent, explain, migrateLegacy,
} from './aiConnections.js';

const TIMEOUT_MS = 60_000;
// How long to wait before each retry when the provider says it is busy.
export const BUSY_RETRY_MS = [2000, 5000];
export const HISTORY_FOR_AI = 30;
export const MAX_BODY = 4000;

export class FableSetupError extends Error {}

// ------------------------------------------------------------ the settings

export const DEFAULT_SETTINGS = {
  source: 'key', connection: null, botName: 'Fable', persona: '', replyMode: 'always', useForContent: true,
};

const presentSettings = (row) => (row ? {
  source: row.source,
  connection: row.connection || null,
  botName: row.bot_name,
  persona: row.persona || '',
  replyMode: row.reply_mode,
  useForContent: row.use_for_content,
  updatedBy: row.updated_by_name || null,
  updatedAt: row.updated_at,
} : null);

export async function getSettings(pairId) {
  // Keys saved under the old setup become connections the first time.
  await migrateLegacy(pairId).catch((err) => console.error('[fable] could not move old keys over:', err.message));
  const { rows } = await query(
    `SELECT s.*, u.name AS updated_by_name FROM fable_settings s
       LEFT JOIN users u ON u.id = s.updated_by WHERE s.pair_id = $1`,
    [pairId]
  );
  return presentSettings(rows[0]);
}

const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Checks what the setup page sent and fills in what it left out. */
export function cleanSettings(input, current = null) {
  const base = { ...DEFAULT_SETTINGS, ...(current || {}) };
  // 'key' is "one of your connections"; 'server' is backend/.env's connector.
  const source = input.source === 'connection' ? 'key' : (input.source ?? base.source);
  if (!['key', 'server'].includes(source)) throw new FableSetupError('Choose one of your connections or the server\'s AI.');
  const connection = input.connection === undefined ? base.connection : (clip(input.connection, 64) || null);
  const botName = clip(input.botName ?? base.botName, 24) || 'Fable';
  if (!/^[\p{L}\p{N} _.'-]+$/u.test(botName)) throw new FableSetupError('Give the AI a name made of letters and numbers.');
  const persona = String(input.persona ?? base.persona ?? '').trim().slice(0, 1000);
  const replyMode = input.replyMode ?? base.replyMode;
  if (!['always', 'mention'].includes(replyMode)) throw new FableSetupError('Choose when the AI replies.');
  const useForContent = input.useForContent === undefined ? base.useForContent : Boolean(input.useForContent);
  return { source, connection, botName, persona, replyMode, useForContent };
}

export async function saveSettings(pairId, userId, input) {
  const s = cleanSettings(input, await getSettings(pairId));
  await query(
    `INSERT INTO fable_settings (pair_id, source, connection, provider, model, bot_name, persona, reply_mode, use_for_content, updated_by, updated_at)
     VALUES ($1, $2, $3, 'connection', '', $4, $5, $6, $7, $8, now())
     ON CONFLICT (pair_id) DO UPDATE SET
       source = EXCLUDED.source, connection = EXCLUDED.connection, bot_name = EXCLUDED.bot_name,
       persona = EXCLUDED.persona, reply_mode = EXCLUDED.reply_mode, use_for_content = EXCLUDED.use_for_content,
       updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [pairId, s.source, s.connection, s.botName, s.persona, s.replyMode, s.useForContent, userId]
  );
  await refreshSharedAiConfig();
  return getSettings(pairId);
}

export async function deleteSettings(pairId) {
  await query('DELETE FROM fable_settings WHERE pair_id = $1', [pairId]);
  await refreshSharedAiConfig();
}

/** backend/.env's connector, described for the setup page (never the key). */
export function serverConnector() {
  try {
    const c = serverLlmConfig();
    return c ? { available: true, provider: c.provider, model: c.model } : { available: false };
  } catch (err) {
    return { available: false, error: err.message };
  }
}

/** backend/.env's connector, as a connection Fable can call. */
function serverConnection() {
  const c = serverLlmConfig();
  if (!c) return null;
  const messages = c.provider === 'anthropic';
  const baseURL = (c.baseUrl || PROVIDER_URLS[c.provider] || (messages ? 'https://api.anthropic.com' : '')).replace(/\/+$/, '');
  return {
    name: `the server's ${c.provider}`,
    baseURL: messages && !/\/v1$/.test(baseURL) ? `${baseURL}/v1` : baseURL,
    apiKey: c.apiKey || null,
    model: c.model,
    extra: messages ? { api: 'messages' } : {},
  };
}

const isLocal = (url) => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0|host\.docker\.internal|192\.168\.|10\.)/i.test(url || '');

/**
 * The connection a pair's settings point at, ready to call: { config }, or
 * { problem } saying in a sentence what is missing. `connection` lets the
 * setup page test a named connection that is not the chosen one.
 */
export async function resolveConfig(pairId, settings, { connection: override } = {}) {
  if (!settings && !override) return { problem: 'The AI is not set up yet.' };
  if (!override && settings.source === 'server') {
    const server = serverConnector();
    if (!server.available) {
      return { problem: server.error ? `The server's AI is misconfigured: ${server.error}` : 'The server has no AI set up in backend/.env. Add a connection instead.' };
    }
    return { config: serverConnection() };
  }
  const name = override || settings.connection;
  if (!name) return { problem: 'Choose a connection for Fable on the setup page, or add one.' };
  const conn = await resolveConnection(pairId, name);
  if (!conn) return { problem: `There is no connection called "${name}" any more. Choose another on the setup page.` };
  if (conn.keyUnreadable) return { problem: `The key saved on "${name}" can no longer be read (the server's secret changed). Paste it again.` };
  if (!conn.baseURL) return { problem: `"${name}" has no address. Add one on the setup page.` };
  if (!conn.apiKey && !isLocal(conn.baseURL)) return { problem: `"${name}" has no API key. Paste one on the setup page.` };
  if (!conn.model) return { problem: `"${name}" has no model chosen. Press Find on it to pick one.` };
  return { config: conn };
}

/**
 * The connection the daily quiz, prompts and date ideas can borrow when
 * backend/.env has none: the most recently saved setup on a connection,
 * with "also use it for daily content" on. As quizGenerator's config shape.
 */
export function asContentConfig(conn) {
  if (!conn?.baseURL || !conn.model) return null;
  if (conn.extra?.api === 'messages') {
    return { provider: 'anthropic', apiKey: conn.apiKey || 'none', model: conn.model, baseUrl: conn.baseURL.replace(/\/v1$/, '') };
  }
  return { provider: conn.apiKey ? 'custom' : 'ollama', apiKey: conn.apiKey || '', model: conn.model, baseUrl: conn.baseURL };
}

export async function refreshSharedAiConfig() {
  try {
    const { rows } = await query(
      `SELECT pair_id FROM fable_settings
        WHERE source = 'key' AND use_for_content AND connection IS NOT NULL ORDER BY updated_at DESC LIMIT 5`
    );
    for (const { pair_id: pairId } of rows) {
      const { config } = await resolveConfig(pairId, await getSettings(pairId));
      const content = asContentConfig(config);
      if (content) { setSharedAiConfig(content); return content; }
    }
    setSharedAiConfig(null);
    return null;
  } catch (err) {
    // Before the migration has made the tables, or with the database down:
    // daily content simply has no borrowed connector.
    console.error('[fable] could not load the app\'s AI connector:', err.message);
    return null;
  }
}

// ---------------------------------------------------------------- the chat

/** Should the AI answer this message? */
export function wantsReply(body, settings) {
  if (!settings) return false;
  if (settings.replyMode === 'always') return true;
  const name = settings.botName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)@${name}(?![\\p{L}\\p{N}])`, 'iu').test(body)
    || new RegExp(`^\\s*${name}(?![\\p{L}\\p{N}])`, 'iu').test(body);
}

export function systemPrompt(settings, names) {
  const [a, b] = names;
  return `You are ${settings.botName}, the third member of a private group chat with a couple, ${a} and ${b}. `
    + 'They are in a relationship, often long-distance, and use this chat to talk with you together: ask questions, plan dates, settle friendly debates, get ideas, or just chat. '
    + 'Each message in the conversation is labelled with who wrote it. Talk to them by name when it helps, and keep track of who asked what. '
    + 'Be warm, playful and genuinely helpful, and never take sides in a way that would hurt either of them. '
    + 'Keep replies short and conversational, like a chat message: usually one to four sentences, longer only when they ask for detail or a list. '
    + 'Plain text only: no markdown headings or tables. Never write messages for either of them or pretend to be them. '
    + 'You cannot see photos, set reminders or do anything outside this chat; if asked, say so briefly.'
    + (settings.persona ? `\n\nHow they want you to be: ${settings.persona}` : '');
}

/** The conversation as the model reads it: one labelled line per message. */
export function transcript(history, settings, latestAuthor) {
  const lines = history.map((m) => `${m.authorName}: ${m.body}`);
  return `The group chat so far (oldest first):\n\n${lines.join('\n')}\n\n`
    + `Write ${settings.botName}'s next message, answering ${latestAuthor}'s latest message. `
    + `Just the message text, without "${settings.botName}:" in front.`;
}

/** Tidies what the model wrote: its own name in front, surrounding quotes. */
export function cleanReply(text, botName) {
  let out = String(text || '').trim();
  const prefix = new RegExp(`^\\**${botName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\**\\s*:\\s*`, 'i');
  out = out.replace(prefix, '').trim();
  if (/^".*"$/s.test(out)) out = out.slice(1, -1).trim();
  return out.slice(0, MAX_BODY);
}

const KEY_REFUSED = /api[ _-]?key (not valid|invalid)|valid api key|invalid[ _-]?api[ _-]?key|incorrect api key|unauthori[sz]ed|authentication/i;

/** What kind of failure an error is, for deciding whether to try elsewhere. */
export function failureKind(status, detail = '') {
  const text = String(detail);
  if (status === 401 || status === 403 || KEY_REFUSED.test(text)) return 'key';
  if (status === 429 || /quota|rate limit|resource[_ ]exhausted/i.test(text)) return 'limit';
  if ([500, 502, 503, 504].includes(status) || /overloaded|high demand|unavailable/i.test(text)) return 'busy';
  if (status === 404 || /model.*(not found|does not exist|not supported|is not available|decommissioned|deprecated)|unknown model|not a valid model/i.test(text)) return 'model';
  return 'other';
}

/** A provider's error, as a sentence you can act on: what went out, when it was the key. */
export function explainFailure(config, status, detail) {
  const who = `"${config.name}"`;
  switch (failureKind(status, detail)) {
    case 'key':
      return `${who} refused the API key (${explain(status, detail)}). It ${asSent(config)}: check it is the whole key, for this service, on the setup page.`;
    case 'limit':
      return `${who} hit its limit (free tiers allow a few requests a minute). Try again shortly.`;
    case 'busy':
      return `${who} is busy right now (too many people using it). Try again in a minute.`;
    case 'model':
      return `${who} does not know the model "${config.model}". Press Find on it to pick one it serves.`;
    default:
      return `${who} answered ${explain(status, detail)}`;
  }
}

function providerError(config, status, detail) {
  const err = new Error(explainFailure(config, status, detail));
  err.status = status;
  err.kind = failureKind(status, detail);
  return err;
}

function unreachable(config, err) {
  const wrapped = networkError({ provider: config.name, baseUrl: config.baseURL }, err);
  wrapped.kind = 'network';
  return wrapped;
}

/**
 * One reply from the model: plain text, from either shape of endpoint.
 * `busyWaits` is how long to wait before each retry of a busy model.
 */
export async function askChat(config, { system, user }, { busyWaits = BUSY_RETRY_MS, fetchImpl = fetch } = {}) {
  const messages = config.extra?.api === 'messages';
  const body = messages
    ? { model: config.model, max_tokens: 2000, system, messages: [{ role: 'user', content: user }] }
    : {
      model: config.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.8,
      ...(config.extra?.tokenParam ? { [config.extra.tokenParam]: 2000 } : {}),
    };
  const send = () => fetchImpl(`${config.baseURL}/${messages ? 'messages' : 'chat/completions'}`, {
    method: 'POST',
    headers: headersFor(config.apiKey, config.extra || {}, { 'content-type': 'application/json' }),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((err) => { throw unreachable(config, err); });

  // "Busy right now" is worth two more tries a few seconds apart: Gemini's
  // free tier says it often and usually means it for seconds.
  let res = await send();
  for (const wait of busyWaits) {
    if (![500, 502, 503].includes(res.status)) break;
    await res.text().catch(() => '');
    await new Promise((resolve) => setTimeout(resolve, wait));
    res = await send();
  }
  if (!res.ok) throw providerError(config, res.status, await res.text().catch(() => ''));
  const data = await res.json().catch(() => ({}));
  if (messages && data?.stop_reason === 'refusal') throw new Error('The model declined to answer that.');
  const text = messages ? replyText(data?.content) : replyText(data?.choices?.[0]?.message?.content);
  if (!text) {
    const err = new Error(`"${config.name}" sent back an empty reply.`);
    err.kind = 'empty';
    throw err;
  }
  return text;
}

/**
 * The text of a reply. Usually a string; some providers (and Anthropic's
 * shape always) send a list of parts, and thinking models can put their
 * notes in parts of their own, which are left out.
 */
export function replyText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p && (p.type === 'text' || p.type === 'output_text' || (!p.type && typeof p.text === 'string')))
      .map((p) => p.text || '').join('');
  }
  return '';
}

// -------------------------------------------------------------- the models

// Models that cannot chat: speech, embeddings, images, moderation and the
// like, which every provider lists alongside the chat models.
const NOT_CHAT = /(^|[-_./:])(tts|embed(ding)?s?|imagen?|images?|whisper|transcribe|audio|speech|moderation|guard|rerank|dall-e|sora|veo|lyria|native-audio|live|computer-use|robotics|aqa|realtime|search-preview)([-_./:]|$)/i;

/**
 * An endpoint's chat models, best first for a chat: quick, generous, current
 * ones ahead of previews, the big slow ones and the reasoning-only ones.
 */
export function chatModels(baseURL, ids) {
  const openrouter = /openrouter/i.test(String(baseURL));
  const score = (id) => {
    let n = 0;
    if (/flash|mini|small|instant|versatile|haiku|sonnet|turbo|chat|latest|:free/i.test(id)) n += 2;
    if (openrouter && /:free$/.test(id)) n += 3;
    if (/preview|exp(erimental)?([-_.]|$)|beta|thinking|deep-research|o1|o3|r1|reason/i.test(id)) n -= 3;
    if (/(^|[-_.])pro([-_.]|$)|large|405b|opus|ultra/i.test(id)) n -= 1;
    return n;
  };
  return [...new Set(ids.map((id) => String(id).replace(/^models\//, '')).filter((id) => id && !NOT_CHAT.test(id)))]
    .sort((a, b) => score(b) - score(a) || a.localeCompare(b));
}

const modelCache = new Map();
const MODEL_CACHE_MS = 30 * 60 * 1000;

/** The chat models a connection serves today, asked of the endpoint itself. Kept half an hour. */
export async function listModels(config) {
  const cacheKey = `${config.baseURL}|${config.apiKey ? config.apiKey.slice(-6) : ''}`;
  const hit = modelCache.get(cacheKey);
  if (hit && Date.now() - hit.at < MODEL_CACHE_MS) return hit.models;
  const found = await probe({ baseURL: config.baseURL, apiKey: config.apiKey, extra: config.extra || {} });
  if (!found.ok) throw new Error(found.error);
  const models = chatModels(config.baseURL, found.models);
  modelCache.set(cacheKey, { at: Date.now(), models });
  return models;
}

// What is worth trying elsewhere: the model busy, out of free quota, or gone.
const TRY_ANOTHER_MODEL = new Set(['busy', 'limit', 'model', 'empty']);

/**
 * One reply, trying harder than askChat: when the chosen model is busy, out
 * of its free quota or no longer exists, a few other models on the same
 * connection are tried (each has its own quota), then your other
 * connections. Resolves to { text, config, fallback }; throws the first
 * model's error if nothing answers.
 *
 * When the chosen model simply no longer exists and another on the same
 * connection answered, the connection is moved onto that one.
 */
export async function askWithFallback(pairId, config, prompt) {
  let first;
  try {
    return { text: await askChat(config, prompt), config, fallback: null };
  } catch (err) {
    first = err;
  }
  const tried = new Set([`${config.name}|${config.model}`]);
  const attempt = async (candidate) => {
    const id = `${candidate.name}|${candidate.model}`;
    if (tried.has(id)) return null;
    tried.add(id);
    try {
      return { text: await askChat(candidate, prompt, { busyWaits: [] }), config: candidate };
    } catch (err) {
      console.error(`[fable] fallback ${id} failed: ${err.message}`);
      return null;
    }
  };

  // Other models on the same connection.
  if (TRY_ANOTHER_MODEL.has(first.kind)) {
    const models = await listModels(config).catch(() => []);
    for (const model of models.slice(0, 4)) {
      const got = await attempt({ ...config, model });
      if (got) {
        if (first.kind === 'model' && pairId) {
          await query('UPDATE ai_connections SET model = $3 WHERE pair_id = $1 AND name = $2 AND model = $4', [pairId, config.name, model, config.model])
            .catch(() => {});
        }
        return { ...got, fallback: { from: config.model, to: model, connection: config.name, why: first.message } };
      }
    }
  }

  // Your other connections, each with its own model.
  if (pairId && first.kind !== 'other') {
    for (const view of await listConnections(pairId)) {
      if (view.name === config.name || !view.model) continue;
      const candidate = await resolveConnection(pairId, view.name);
      if (!candidate?.baseURL || (!candidate.apiKey && !isLocal(candidate.baseURL))) continue;
      const got = await attempt(candidate);
      if (got) return { ...got, fallback: { from: `${config.name} (${config.model})`, to: `${candidate.name} (${candidate.model})`, connection: candidate.name, why: first.message } };
    }
  }
  throw first;
}
