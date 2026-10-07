// Fable: the group chat between the two of you and an AI model.
//
// Everything lives in this backend: the messages (fable_messages), which
// model answers (fable_settings) and the API keys you add in the app
// (ai_keys, one per provider). The phones never see a key. They send one in
// once, on the setup page, and from then on only a hint of it ("…a1b2")
// comes back.
//
// The model is reached through the same connector as the AI-written quiz and
// prompts (models/quizGenerator.js), so any provider that works there works
// here: Gemini and Groq on their free tiers, OpenRouter, OpenAI, Claude, a
// local Ollama, or any OpenAI-compatible address. Or the setup page can
// point Fable at the connector already in backend/.env.
import crypto from 'node:crypto';
import { query } from '../config/db.js';
import {
  PROVIDER_URLS, ANTHROPIC_DEFAULT_MODEL, buildLlmConfig, serverLlmConfig, networkError,
} from './quizGenerator.js';
import { setSharedAiConfig } from './aiShared.js';

const TIMEOUT_MS = 60_000;
// How long to wait before each retry when the provider says it is busy.
export const BUSY_RETRY_MS = [2000, 5000];
export const HISTORY_FOR_AI = 30;
export const MAX_BODY = 4000;

/**
 * What the setup page offers, in the order it offers them: the free ones
 * first. The default models are a starting point the page fills in; any
 * model the provider has can be typed instead.
 */
export const PROVIDERS = [
  { id: 'gemini', label: 'Google Gemini', free: true, defaultModel: 'gemini-flash-latest', keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'groq', label: 'Groq', free: true, defaultModel: 'llama-3.3-70b-versatile', keyUrl: 'https://console.groq.com/keys' },
  { id: 'openrouter', label: 'OpenRouter', free: true, defaultModel: 'meta-llama/llama-3.3-70b-instruct:free', keyUrl: 'https://openrouter.ai/keys' },
  { id: 'mistral', label: 'Mistral', free: true, defaultModel: 'mistral-small-latest', keyUrl: 'https://console.mistral.ai/api-keys' },
  { id: 'openai', label: 'OpenAI', free: false, defaultModel: 'gpt-4o-mini', keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', label: 'Claude (Anthropic)', free: false, defaultModel: ANTHROPIC_DEFAULT_MODEL, keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'deepseek', label: 'DeepSeek', free: false, defaultModel: 'deepseek-chat', keyUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'together', label: 'Together', free: false, defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', keyUrl: 'https://api.together.xyz/settings/api-keys' },
  { id: 'ollama', label: 'Ollama on the server PC', free: true, defaultModel: 'llama3.2', keyUrl: null, noKey: true },
  { id: 'custom', label: 'Another OpenAI-compatible service', free: false, defaultModel: '', keyUrl: null, needsBaseUrl: true },
];
const PROVIDER_IDS = PROVIDERS.map((p) => p.id);
const APP_NAMES = { provider: 'The provider', apiKey: 'An API key', model: 'The model', baseUrl: 'The server address' };

export class FableSetupError extends Error {}

// ---------------------------------------------------------------- the keys

/**
 * Keys are sealed with AES-256-GCM before they reach the database, so a copy
 * of the database (a backup, a dump pasted somewhere) is not a copy of your
 * keys. The secret is FABLE_KEY_SECRET, or JWT_REFRESH_SECRET when that is
 * not set;
 * change it and the saved keys can no longer be opened — the setup page then
 * asks for them again rather than failing strangely.
 */
function sealKey() {
  const secret = process.env.FABLE_KEY_SECRET || process.env.JWT_REFRESH_SECRET;
  if (!secret) throw new Error('JWT_REFRESH_SECRET is not set, so API keys cannot be stored safely');
  return crypto.createHash('sha256').update(`loversrock-ai-keys:${secret}`).digest();
}

export function sealApiKey(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', sealKey(), iv);
  const body = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join(':');
}

export function openApiKey(sealed) {
  try {
    const [v, iv, tag, body] = String(sealed).split(':');
    if (v !== 'v1') return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', sealKey(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Enough of a key to recognise it, never enough to use it. */
export const keyHint = (key) => (key && key.length > 8 ? `…${key.slice(-4)}` : '…');

export async function listKeys(pairId) {
  const { rows } = await query(
    `SELECT k.provider, k.hint, k.created_at, u.name AS added_by
       FROM ai_keys k LEFT JOIN users u ON u.id = k.added_by
      WHERE k.pair_id = $1 ORDER BY k.created_at`,
    [pairId]
  );
  return rows.map((r) => ({ provider: r.provider, hint: r.hint, addedBy: r.added_by, addedAt: r.created_at }));
}

export async function saveKey(pairId, userId, provider, apiKey) {
  const id = String(provider || '').toLowerCase();
  if (!PROVIDER_IDS.includes(id)) throw new FableSetupError(`Unknown provider "${provider}".`);
  const key = String(apiKey || '').trim();
  if (key.length < 8) throw new FableSetupError('That does not look like an API key. Paste the whole key.');
  if (/\s/.test(key)) throw new FableSetupError('An API key has no spaces in it. Paste just the key.');
  await query(
    `INSERT INTO ai_keys (pair_id, provider, key_enc, hint, added_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (pair_id, provider) DO UPDATE
       SET key_enc = EXCLUDED.key_enc, hint = EXCLUDED.hint, added_by = EXCLUDED.added_by, created_at = now()`,
    [pairId, id, sealApiKey(key), keyHint(key), userId]
  );
  await refreshSharedAiConfig();
}

export async function deleteKey(pairId, provider) {
  await query('DELETE FROM ai_keys WHERE pair_id = $1 AND provider = $2', [pairId, String(provider).toLowerCase()]);
  await refreshSharedAiConfig();
}

async function keyFor(pairId, provider) {
  const { rows } = await query('SELECT key_enc FROM ai_keys WHERE pair_id = $1 AND provider = $2', [pairId, provider]);
  if (!rows[0]) return { key: null, missing: true };
  const key = openApiKey(rows[0].key_enc);
  return key ? { key } : { key: null, unreadable: true };
}

// ------------------------------------------------------------ the settings

export const DEFAULT_SETTINGS = {
  source: 'key', provider: 'gemini', model: 'gemini-flash-latest', baseUrl: null,
  botName: 'Fable', persona: '', replyMode: 'always', useForContent: true,
};

const presentSettings = (row) => (row ? {
  source: row.source,
  provider: row.provider,
  model: row.model,
  baseUrl: row.base_url,
  botName: row.bot_name,
  persona: row.persona || '',
  replyMode: row.reply_mode,
  useForContent: row.use_for_content,
  updatedBy: row.updated_by_name || null,
  updatedAt: row.updated_at,
} : null);

export async function getSettings(pairId) {
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
  const source = input.source ?? base.source;
  if (!['key', 'server'].includes(source)) throw new FableSetupError('Choose your own key or the server\'s AI.');
  const provider = String(input.provider ?? base.provider).toLowerCase();
  if (source === 'key' && !PROVIDER_IDS.includes(provider)) throw new FableSetupError(`Unknown provider "${provider}".`);
  const preset = PROVIDERS.find((p) => p.id === provider);
  const model = clip(input.model ?? (input.provider && input.provider !== base.provider ? preset?.defaultModel : base.model), 120)
    || preset?.defaultModel || '';
  const baseUrl = clip(input.baseUrl ?? base.baseUrl, 300) || null;
  if (baseUrl && !/^https?:\/\/\S+$/i.test(baseUrl)) throw new FableSetupError('The server address must start with http:// or https://');
  const botName = clip(input.botName ?? base.botName, 24) || 'Fable';
  if (!/^[\p{L}\p{N} _.'-]+$/u.test(botName)) throw new FableSetupError('Give the AI a name made of letters and numbers.');
  const persona = String(input.persona ?? base.persona ?? '').trim().slice(0, 1000);
  const replyMode = input.replyMode ?? base.replyMode;
  if (!['always', 'mention'].includes(replyMode)) throw new FableSetupError('Choose when the AI replies.');
  const useForContent = input.useForContent === undefined ? base.useForContent : Boolean(input.useForContent);
  return { source, provider, model, baseUrl, botName, persona, replyMode, useForContent };
}

export async function saveSettings(pairId, userId, input) {
  const s = cleanSettings(input, await getSettings(pairId));
  await query(
    `INSERT INTO fable_settings (pair_id, source, provider, model, base_url, bot_name, persona, reply_mode, use_for_content, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
     ON CONFLICT (pair_id) DO UPDATE SET
       source = EXCLUDED.source, provider = EXCLUDED.provider, model = EXCLUDED.model,
       base_url = EXCLUDED.base_url, bot_name = EXCLUDED.bot_name, persona = EXCLUDED.persona,
       reply_mode = EXCLUDED.reply_mode, use_for_content = EXCLUDED.use_for_content,
       updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [pairId, s.source, s.provider, s.model, s.baseUrl, s.botName, s.persona, s.replyMode, s.useForContent, userId]
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

/**
 * The connector for a pair's settings: { config } ready to call, or
 * { problem } saying in a sentence what is missing. `override` lets the
 * setup page try settings (and a key) before saving them.
 */
export async function resolveConfig(pairId, settings, { apiKey } = {}) {
  if (!settings) return { problem: 'The AI is not set up yet.' };
  if (settings.source === 'server') {
    const server = serverConnector();
    if (!server.available) {
      return { problem: server.error ? `The server's AI is misconfigured: ${server.error}` : 'The server has no AI set up in backend/.env. Add your own key instead.' };
    }
    return { config: serverLlmConfig() };
  }
  let key = apiKey ? String(apiKey).trim() : null;
  if (!key) {
    const found = await keyFor(pairId, settings.provider);
    if (found.unreadable) return { problem: `The saved ${labelOf(settings.provider)} key can no longer be read (the server's secret changed). Add it again.` };
    key = found.key;
  }
  try {
    return { config: buildLlmConfig({ provider: settings.provider, apiKey: key || '', model: settings.model, baseUrl: settings.baseUrl }, APP_NAMES) };
  } catch (err) {
    const noKey = !key && settings.provider !== 'ollama';
    return { problem: noKey ? `Add a ${labelOf(settings.provider)} API key to use it.` : err.message };
  }
}

const labelOf = (id) => PROVIDERS.find((p) => p.id === id)?.label || id;

/**
 * Loads the connector the daily quiz, prompts and date ideas can borrow when
 * backend/.env has none: the most recently saved setup with its own key and
 * "also use it for daily content" on. Called at start and on every save.
 */
export async function refreshSharedAiConfig() {
  try {
    const { rows } = await query(
      `SELECT pair_id FROM fable_settings
        WHERE source = 'key' AND use_for_content ORDER BY updated_at DESC LIMIT 5`
    );
    for (const { pair_id: pairId } of rows) {
      const { config } = await resolveConfig(pairId, await getSettings(pairId));
      if (config) { setSharedAiConfig(config); return config; }
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

/** A provider's error, as a sentence you can act on. */
export function explainFailure(config, status, detail) {
  const who = labelOf(config.provider);
  const text = String(detail || '');
  if (status === 401 || status === 403 || /api[ _-]?key (not valid|invalid)|invalid[ _-]?api[ _-]?key|incorrect api key|unauthori[sz]ed/i.test(text)) {
    return `${who} refused the API key. Check it on the setup page.`;
  }
  if (status === 429 || /quota|rate limit|resource[_ ]exhausted/i.test(text)) {
    return `${who}'s limit was reached (free tiers allow a few requests a minute). Try again shortly.`;
  }
  if (status === 503 || /overloaded|high demand|unavailable/i.test(text)) {
    return `${who} is busy right now (too many people using it). Try again in a minute.`;
  }
  if (status === 404 || /model.*(not found|does not exist|not supported)/i.test(text)) {
    return `${who} does not know the model "${config.model}". Pick another on the setup page.`;
  }
  let message = '';
  try { const j = JSON.parse(text); message = j?.error?.message || j?.[0]?.error?.message || j?.message || ''; } catch { /* not JSON */ }
  return `${who} answered ${status}: ${(message || text).slice(0, 200) || 'no details'}`;
}

/** What kind of failure an error is, for deciding whether to try elsewhere. */
export function failureKind(status, detail = '') {
  const text = String(detail);
  if (status === 401 || status === 403 || /api[ _-]?key (not valid|invalid)|invalid[ _-]?api[ _-]?key|incorrect api key|unauthori[sz]ed/i.test(text)) return 'key';
  if (status === 429 || /quota|rate limit|resource[_ ]exhausted/i.test(text)) return 'limit';
  if ([500, 502, 503, 504].includes(status) || /overloaded|high demand|unavailable/i.test(text)) return 'busy';
  if (status === 404 || /model.*(not found|does not exist|not supported|is not available|decommissioned|deprecated)/i.test(text)) return 'model';
  return 'other';
}

/** A provider's error, carrying its status and kind as well as the sentence. */
function providerError(config, status, detail) {
  const err = new Error(explainFailure(config, status, detail));
  err.status = status;
  err.kind = failureKind(status, detail);
  return err;
}

/**
 * One reply from the model: plain text. `busyWaits` is how long to wait
 * before each retry of a busy model (askWithFallback tries other models
 * instead, so it asks the alternatives only once each).
 */
export async function askChat(config, { system, user }, { busyWaits = BUSY_RETRY_MS } = {}) {
  if (config.provider === 'anthropic') {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      timeout: TIMEOUT_MS,
      maxRetries: 1,
    });
    let response;
    try {
      response = await client.messages.create({
        model: config.model,
        max_tokens: 2000,
        system,
        messages: [{ role: 'user', content: user }],
      });
    } catch (err) {
      if (err?.status) throw providerError(config, err.status, err.message);
      const wrapped = networkError(config, err);
      wrapped.kind = 'network';
      throw wrapped;
    }
    if (response.stop_reason === 'refusal') throw new Error('The model declined to answer that.');
    return response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  }

  // "Busy right now" (503, and 500/502 from overloaded gateways) is worth
  // two more tries a few seconds apart: Gemini's free tier says it often and
  // usually means it for seconds, not minutes. Anything else is said at once.
  const send = () => fetch(`${config.baseUrl || PROVIDER_URLS[config.provider]}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.8,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((err) => {
    const wrapped = networkError(config, err);
    wrapped.kind = 'network';
    throw wrapped;
  });
  let res = await send();
  for (const wait of busyWaits) {
    if (![500, 502, 503].includes(res.status)) break;
    await res.text().catch(() => '');
    await new Promise((resolve) => setTimeout(resolve, wait));
    res = await send();
  }
  if (!res.ok) throw providerError(config, res.status, await res.text().catch(() => ''));
  const data = await res.json();
  const text = replyText(data?.choices?.[0]?.message?.content);
  if (!text) {
    const err = new Error(`${labelOf(config.provider)} sent back an empty reply.`);
    err.kind = 'empty';
    throw err;
  }
  return text;
}

/**
 * The text of a chat reply. Usually a string; some providers send a list of
 * parts instead ([{ type: 'text', text }]), and thinking models can put their
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
 * A provider's chat models, best first for a chat: quick, generous, current
 * ones ahead of previews, the big slow ones and the reasoning-only ones.
 */
export function chatModels(provider, ids) {
  const score = (id) => {
    let n = 0;
    if (/flash|mini|small|instant|versatile|haiku|sonnet|turbo|chat|latest|:free/i.test(id)) n += 2;
    if (provider === 'openrouter' && /:free$/.test(id)) n += 3;
    if (/preview|exp(erimental)?([-_.]|$)|beta|thinking|deep-research|o1|o3|r1|reason/i.test(id)) n -= 3;
    if (/(^|[-_.])pro([-_.]|$)|large|405b|opus|ultra/i.test(id)) n -= 1;
    return n;
  };
  return [...new Set(ids.map((id) => String(id).replace(/^models\//, '')).filter((id) => id && !NOT_CHAT.test(id)))]
    .sort((a, b) => score(b) - score(a) || a.localeCompare(b));
}

const modelCache = new Map();
const MODEL_CACHE_MS = 30 * 60 * 1000;

/**
 * The chat models this key can use, asked of the provider itself (its
 * /models list), so the setup page offers what exists today rather than
 * names that were current when this was written. Kept for half an hour.
 */
export async function listModels(config) {
  const cacheKey = `${config.provider}|${config.baseUrl}|${crypto.createHash('sha256').update(config.apiKey || '').digest('hex')}`;
  const hit = modelCache.get(cacheKey);
  if (hit && Date.now() - hit.at < MODEL_CACHE_MS) return hit.models;

  let ids;
  if (config.provider === 'anthropic') {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      timeout: 20_000,
      maxRetries: 1,
    });
    try {
      const page = await client.models.list({ limit: 100 });
      ids = page.data.map((m) => m.id);
    } catch (err) {
      if (err?.status) throw providerError(config, err.status, err.message);
      throw networkError(config, err);
    }
  } else {
    const res = await fetch(`${config.baseUrl || PROVIDER_URLS[config.provider]}/models`, {
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
      signal: AbortSignal.timeout(20_000),
    }).catch((err) => { throw networkError(config, err); });
    if (!res.ok) throw providerError(config, res.status, await res.text().catch(() => ''));
    const data = await res.json().catch(() => ({}));
    const list = Array.isArray(data) ? data : data.data || data.models || [];
    ids = list.map((m) => (typeof m === 'string' ? m : m.id || m.name));
  }
  const models = chatModels(config.provider, ids);
  modelCache.set(cacheKey, { at: Date.now(), models });
  return models;
}

// What is worth trying elsewhere: the model busy, out of free quota, or gone.
const TRY_ANOTHER_MODEL = new Set(['busy', 'limit', 'model', 'empty']);

/**
 * One reply, trying harder than askChat: when the chosen model is busy, out
 * of its free quota or no longer exists, a few other models from the same
 * provider are tried (each has its own quota), then your other saved keys.
 * Resolves to { text, config, fallback } where fallback says what stood in
 * and why; throws the first model's error if nothing answers.
 *
 * When the chosen model simply no longer exists and another of the same
 * provider answered, the setup is moved onto that one, so the next message
 * does not have to find it again.
 */
export async function askWithFallback(pairId, config, prompt, { settings = null } = {}) {
  let first;
  try {
    return { text: await askChat(config, prompt), config, fallback: null };
  } catch (err) {
    first = err;
  }
  const tried = new Set([`${config.provider}|${config.model}`]);
  const attempt = async (candidate) => {
    const id = `${candidate.provider}|${candidate.model}`;
    if (tried.has(id)) return null;
    tried.add(id);
    try {
      return { text: await askChat(candidate, prompt, { busyWaits: [] }), config: candidate };
    } catch (err) {
      console.error(`[fable] fallback ${id} failed: ${err.message}`);
      return null;
    }
  };

  // Other models from the same provider.
  if (TRY_ANOTHER_MODEL.has(first.kind)) {
    const models = await listModels(config).catch(() => []);
    for (const model of models.slice(0, 4)) {
      const got = await attempt({ ...config, model });
      if (got) {
        if (first.kind === 'model' && settings?.source === 'key' && settings.provider === config.provider && pairId) {
          await query('UPDATE fable_settings SET model = $2 WHERE pair_id = $1 AND model = $3', [pairId, model, config.model])
            .catch(() => {});
        }
        return { ...got, fallback: { from: config.model, to: model, provider: config.provider, why: first.message } };
      }
    }
  }

  // Your other saved keys, each with its best model.
  if (pairId && first.kind !== 'other') {
    const { rows } = await query('SELECT provider, key_enc FROM ai_keys WHERE pair_id = $1 AND provider <> $2 ORDER BY created_at DESC', [pairId, config.provider]);
    for (const row of rows) {
      const preset = PROVIDERS.find((p) => p.id === row.provider);
      const key = openApiKey(row.key_enc);
      if (!preset || !key || preset.needsBaseUrl) continue;
      let candidate;
      try {
        candidate = buildLlmConfig({ provider: row.provider, apiKey: key, model: preset.defaultModel }, APP_NAMES);
      } catch { continue; }
      const listed = await listModels(candidate).catch(() => []);
      const models = [...new Set([listed.includes(preset.defaultModel) || !listed.length ? preset.defaultModel : null, ...listed.slice(0, 2)].filter(Boolean))];
      for (const model of models) {
        const got = await attempt({ ...candidate, model });
        if (got) return { ...got, fallback: { from: `${labelOf(config.provider)} ${config.model}`, to: `${labelOf(row.provider)} ${model}`, provider: row.provider, why: first.message } };
      }
    }
  }
  throw first;
}
