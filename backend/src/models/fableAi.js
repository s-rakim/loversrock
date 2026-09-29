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

/** One reply from the model: plain text. */
export async function askChat(config, { system, user }) {
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
      if (err?.status) throw new Error(explainFailure(config, err.status, err.message));
      throw networkError(config, err);
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
  }).catch((err) => { throw networkError(config, err); });
  let res = await send();
  for (const wait of BUSY_RETRY_MS) {
    if (![500, 502, 503].includes(res.status)) break;
    await new Promise((resolve) => setTimeout(resolve, wait));
    res = await send();
  }
  if (!res.ok) throw new Error(explainFailure(config, res.status, await res.text().catch(() => '')));
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error(`${labelOf(config.provider)} sent back an empty reply.`);
  return text;
}
