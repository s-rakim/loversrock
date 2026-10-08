// Fable's connections to models: Collaboration des Esprits' connection layer
// (github.com/s-rakim/collaboration-des-esprits, src/connections.js and
// src/probe.js, MIT), brought over to replace the fixed provider list.
//
// A connection is a row you define: a name, an address, a key, a model, and
// what shape the endpoint speaks. Presets only fill the boxes in; any
// endpoint works under any name, so a provider that appears next month needs
// no code change. What made the old setup fail is what this fixes:
//
//   - the key is pulled out of whatever was pasted (a curl line, a JSON
//     header, KEY=value) rather than stored with its wrapping (cleanKey);
//   - a provider's whole example can be pasted, and the address, key, model
//     and parameter names are read out of it (parseSnippet);
//   - "find" asks the endpoint itself: it repairs the address (the missing
//     /v1, Google's /v1beta/openai) and lists the models it really serves
//     (probe), then proves the key with the smallest real call (tryKey);
//   - a refusal says what went out: "sent 39 characters ending "x9Qa" as
//     Authorization: Bearer …" (asSent), which is how a cut-off or wrong key
//     shows itself.
//
// Keys are sealed with AES-256-GCM before they reach the database, as before.
import crypto from 'crypto';
import { query } from '../config/db.js';

const TIMEOUT_MS = 12_000;
// A refused key, however it is worded. Google says it with a 400, not a 401.
const KEY_REFUSED_TEXT = /api[ _-]?key (not valid|invalid)|valid api key|invalid[ _-]?api[ _-]?key|incorrect api key/i;
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Starting points. Pick one and the address and a model are filled in; change
 * anything. `model` is a hint — "find" replaces it with what the endpoint
 * actually serves. Free tiers first.
 */
export const PRESETS = [
  { preset: 'Google Gemini', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-flash-latest',
    keyHint: 'aistudio.google.com/apikey — free', keyUrl: 'https://aistudio.google.com/apikey', free: true },
  { preset: 'Groq', baseURL: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile',
    keyHint: 'console.groq.com — free, very fast', keyUrl: 'https://console.groq.com/keys', free: true },
  { preset: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct:free',
    keyHint: 'openrouter.ai — one key, many models, the :free ones cost nothing', keyUrl: 'https://openrouter.ai/keys', free: true },
  { preset: 'NVIDIA NIM', baseURL: 'https://integrate.api.nvidia.com/v1', model: 'meta/llama-3.3-70b-instruct',
    keyHint: 'build.nvidia.com — a free tier; model ids carry the vendor: meta/…, moonshotai/…', keyUrl: 'https://build.nvidia.com', free: true },
  { preset: 'Mistral', baseURL: 'https://api.mistral.ai/v1', model: 'mistral-small-latest',
    keyHint: 'console.mistral.ai — free tier', keyUrl: 'https://console.mistral.ai/api-keys', free: true },
  { preset: 'Cerebras', baseURL: 'https://api.cerebras.ai/v1', model: 'llama-3.3-70b',
    keyHint: 'cloud.cerebras.ai — free tier', keyUrl: 'https://cloud.cerebras.ai', free: true },
  { preset: 'OpenAI', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini',
    keyHint: 'platform.openai.com', keyUrl: 'https://platform.openai.com/api-keys' },
  { preset: 'Claude (Anthropic)', baseURL: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5',
    keyHint: 'console.anthropic.com', keyUrl: 'https://console.anthropic.com/settings/keys', extra: { api: 'messages' } },
  { preset: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-chat',
    keyHint: 'platform.deepseek.com', keyUrl: 'https://platform.deepseek.com/api_keys' },
  { preset: 'xAI Grok', baseURL: 'https://api.x.ai/v1', model: 'grok-3-mini',
    keyHint: 'console.x.ai', keyUrl: 'https://console.x.ai' },
  { preset: 'Together', baseURL: 'https://api.together.xyz/v1', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    keyHint: 'api.together.xyz', keyUrl: 'https://api.together.xyz/settings/api-keys' },
  { preset: 'Ollama (on the server PC)', baseURL: 'http://host.docker.internal:11434/v1', model: 'llama3.2',
    keyHint: 'no key needed', keyOptional: true },
  { preset: 'LM Studio (on the server PC)', baseURL: 'http://host.docker.internal:1234/v1', model: '',
    keyHint: 'no key needed', keyOptional: true },
  // Only while it is running: these are proxies on the PC, not services.
  { preset: 'Free Claude Code (on the server PC, when running)', baseURL: 'http://host.docker.internal:8082/v1', model: '',
    keyHint: 'no key needed — FCC holds the provider keys; its proxy token only if you turned that on',
    keyOptional: true, extra: { api: 'messages' } },
  { preset: 'My Claude Code (on the server PC, when running)', baseURL: 'http://host.docker.internal:8082/v1', model: '',
    keyHint: 'no key needed — MCC holds the provider keys', keyOptional: true },
];

// ------------------------------------------------------------ the key itself

const NOISE = new Set([
  'authorization', 'bearer', 'token', 'basic', 'apikey', 'api', 'key', 'x-api-key',
  'headers', 'header', 'auth', 'secret', 'value', 'string', 'const', 'let', 'var',
  'export', 'set', 'setx', 'env', 'true', 'false', 'null', 'none',
]);

/**
 * Pull the key out of whatever was pasted. Nobody copies a bare key: they
 * copy the line it sat in (`"Authorization": "Bearer nvapi-…",`), and every
 * wrapper makes the provider refuse a key that was fine all along. One word
 * on its own is returned untouched.
 */
export function cleanKey(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  if (!/\s/.test(text) && !/^["'`]|["'`,]$/.test(text)) {
    const assigned = text.match(/^[A-Za-z0-9_.-]+=(?!=*$)(.+)$/);
    return (assigned ? assigned[1] : text).replace(/^(bearer|token|basic)\s+/i, '');
  }
  const tokens = text.match(/[A-Za-z0-9_\-.~+/]{8,}={0,2}/g) ?? [];
  const candidates = tokens.filter((t) => !NOISE.has(t.toLowerCase().replace(/[_-]/g, '')));
  if (candidates.length) {
    const digity = candidates.filter((t) => /\d/.test(t));
    const pool = digity.length ? digity : candidates;
    return pool.reduce((best, t) => (t.length >= best.length ? t : best)).replace(/[.,;:]+$/, '');
  }
  return text
    .replace(/^["'`]+|["'`]+,?$/g, '')
    .replace(/^(bearer|token|basic)\s+/i, '')
    .trim()
    .split(/\s/)[0];
}

/**
 * Read a provider's own example (Python, JavaScript or curl, as it comes) and
 * fill a connection in from it: the address, the key, a model that exists on
 * that account, and the name the endpoint gives its length limit.
 */
export function parseSnippet(raw) {
  const text = String(raw ?? '');
  if (!text.trim()) return { ok: false, error: 'There is nothing pasted.' };

  const valueFor = (...names) => {
    for (const name of names) {
      const re = new RegExp(`["'\`]?\\b${name}\\b["'\`]?\\s*[:=]\\s*["'\`]([^"'\`]+)["'\`]`, 'i');
      const hit = text.match(re);
      if (hit) return hit[1].trim();
    }
    return '';
  };

  const found = valueFor('api_key', 'apiKey', 'apikey', 'key', 'token')
    || (text.match(/Authorization["'`]?\s*[:=]\s*["'`]?\s*Bearer\s+([^\s"'`\\,]+)/i) ?? [])[1]
    || (text.match(/x-goog-api-key["'`]?\s*[:=]\s*["'`]?\s*([^\s"'`\\,]+)/i) ?? [])[1]
    || (text.match(/[-\w]*api[-_]?key["'`]?\s*[:=]\s*["'`]?\s*([A-Za-z0-9_\-.~+/]{16,}={0,2})/i) ?? [])[1]
    || '';
  // "$NVIDIA_API_KEY" or "<your key>" is where a key goes, not a key.
  const apiKey = /^(\$|<|\{|os\.environ|process\.env|YOUR)/i.test(found) ? '' : found;

  let baseURL = valueFor('base_url', 'baseURL', 'baseurl', 'endpoint', 'host', 'invoke_url');
  if (!baseURL) {
    const urls = text.match(/https?:\/\/[^\s"'`\\)]+/g) ?? [];
    const api = urls.find((u) => /\/v\d|\/api|\/openai/i.test(u)) ?? urls[0];
    if (api) baseURL = api;
  }
  baseURL = baseURL
    .replace(/\?.*$/, '')
    .replace(/\/(chat\/completions|completions|responses|embeddings|models|messages)\/?$/i, '')
    .replace(/\/+$/, '');

  const model = valueFor('model', 'model_id', 'modelId', 'deployment');
  const tokenParam = /max_completion_tokens/i.test(text) ? 'max_completion_tokens' : (/max_tokens/i.test(text) ? 'max_tokens' : '');

  const extra = {};
  if (tokenParam) extra.tokenParam = tokenParam;
  // Anthropic's own shape: x-api-key and /v1/messages, anthropic-version.
  if (/anthropic-version|\/v1\/messages|anthropic\.Anthropic|new Anthropic/i.test(text)) extra.api = 'messages';

  if (!baseURL && !apiKey) {
    return { ok: false, error: 'Nothing in that looked like an address or a key. Paste the whole example, including the lines that set them.' };
  }
  return { ok: true, baseURL, apiKey, model, extra };
}

/** A connection name from an address: integrate.api.nvidia.com becomes "nvidia". */
export function hostName(url) {
  try {
    const host = new URL(url).hostname.replace(/^(www|api|integrate|generativelanguage)\./, '');
    if (/googleapis\.com$/.test(host)) return 'gemini';
    const parts = host.split('.').filter((p) => !['com', 'ai', 'io', 'net', 'org', 'co', 'api', 'xyz'].includes(p));
    return (parts.pop() ?? host).toLowerCase();
  } catch {
    return '';
  }
}

// --------------------------------------------------------- talking to one

/** Headers for an Anthropic-shaped endpoint, the credential in both spellings. */
export function messagesHeaders(apiKey, extra = {}) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json',
    'anthropic-version': ANTHROPIC_VERSION,
    ...(extra.headers ?? {}),
  };
  if (apiKey) {
    headers['x-api-key'] = apiKey;
    headers.authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

/** The headers for a call, in whichever shape the endpoint speaks. */
export function headersFor(apiKey, extra = {}, base = {}) {
  if (extra.api === 'messages') return { ...messagesHeaders(apiKey, extra), ...base };
  const headers = { ...base, ...(extra.headers ?? {}) };
  if (apiKey) {
    if (extra.keyHeader) headers[extra.keyHeader] = apiKey;
    else headers.authorization = `${extra.keyScheme ?? 'Bearer'} ${apiKey}`;
  }
  return headers;
}

/** What went out, without the key: the length and last four, and the header. */
export function asSent(conn) {
  if (!conn.apiKey) return 'no key was sent: the key box is empty';
  const where = conn.extra?.api === 'messages' ? 'x-api-key: '
    : conn.extra?.keyHeader ? `${conn.extra.keyHeader}: ` : `Authorization: ${conn.extra?.keyScheme ?? 'Bearer'} `;
  return `sent ${conn.apiKey.length} characters ending "${conn.apiKey.slice(-4)}" as "${where}…"`;
}

/** A provider's refusal, as the one sentence in it that matters. */
export function explain(status, raw) {
  const text = String(raw ?? '').trim();
  let message = '';
  try {
    const body = JSON.parse(text);
    const first = Array.isArray(body) ? body[0] : body;
    const found = first?.error?.message ?? first?.message ?? first?.detail ?? first?.error ?? first?.title;
    if (typeof found === 'string') message = found;
  } catch {
    message = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  message = message.slice(0, 200);
  return message ? `${status}: ${message}` : `HTTP ${status}`;
}

/** The addresses worth trying, given what somebody typed (repairs the usual mistakes). */
export function candidates(raw) {
  const typed = String(raw ?? '').trim();
  if (!typed || /\s/.test(typed)) return [];
  let url;
  try {
    const local = /^(localhost|127\.|0\.0\.0\.0|\[?::1\]?|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.|host\.docker\.internal)/i.test(typed);
    url = new URL(/^https?:\/\//i.test(typed) ? typed : `${local ? 'http' : 'https'}://${typed}`);
  } catch {
    return [];
  }
  const host = url.hostname;
  const plausible = host.includes('.') || host === 'localhost' || /^\[?[0-9a-f:]+\]?$/i.test(host);
  if (!plausible) return [];

  const origin = url.origin;
  let path = url.pathname.replace(/\/+$/, '');
  for (const tail of ['/chat/completions', '/completions', '/models', '/responses', '/messages']) {
    if (path.toLowerCase().endsWith(tail)) path = path.slice(0, -tail.length);
  }
  const out = [];
  const add = (p) => {
    const c = `${origin}${p}`.replace(/\/+$/, '');
    if (c && !out.includes(c)) out.push(c);
  };
  add(path);
  // Google's compatibility layer hangs off a versioned path rather than /v1.
  if (/googleapis\.com$/i.test(host)) add('/v1beta/openai');
  if (!/\/v\d+(beta|alpha)?$/i.test(path) && !path.endsWith('/openai')) {
    add(`${path}/v1`);
    add(`${path}/openai/v1`);
    add(`${path}/api/v1`);
  }
  add('');
  return out.slice(0, 6);
}

async function askModels(base, apiKey, extra = {}, fetchImpl = fetch) {
  try {
    const headers = headersFor(apiKey, extra, { accept: 'application/json' });
    const res = await fetchImpl(`${base}/models`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await res.text();
    if (!res.ok) {
      const unauthorized = res.status === 401 || res.status === 403 || KEY_REFUSED_TEXT.test(text);
      return { ok: false, status: res.status, unauthorized, error: explain(res.status, text) };
    }
    let body;
    try { body = JSON.parse(text); } catch { return { ok: false, error: 'that answered, but not with JSON' }; }
    const rows = Array.isArray(body) ? body : body.data ?? body.models ?? [];
    const models = rows
      .map((m) => (typeof m === 'string' ? m : m.id ?? m.name ?? m.model ?? ''))
      .map((id) => String(id).replace(/^models\//, ''))
      .filter(Boolean);
    if (!models.length) return { ok: false, error: 'that answered, but listed no models' };
    const preferred = typeof body?.default_model_id === 'string' ? body.default_model_id : null;
    return { ok: true, models: [...new Set(models)].sort(), preferred };
  } catch (err) {
    return { ok: false, error: err.name === 'TimeoutError' || err.name === 'AbortError' ? `no answer within ${TIMEOUT_MS / 1000}s` : (err.cause?.code || err.message) };
  }
}

/**
 * Find the address that works and the models behind it: tries the obvious
 * repairs in order and stops at the first that answers. A refused key stops
 * it at once ("right address, wrong key").
 */
export async function probe({ baseURL, apiKey, extra = {}, fetchImpl = fetch }) {
  const tried = [];
  const refused = addressProblem(baseURL);
  if (refused) return { ok: false, error: refused, tried };
  for (const base of candidates(baseURL)) {
    const result = await askModels(base, apiKey, extra, fetchImpl);
    tried.push({ baseURL: base, ok: result.ok, error: result.error });
    if (result.ok) {
      return {
        ok: true, baseURL: base, changed: base !== String(baseURL ?? '').trim().replace(/\/+$/, ''),
        models: result.models, preferred: result.preferred ?? null, tried,
      };
    }
    if (result.unauthorized) {
      return { ok: false, unauthorized: true, baseURL: base, error: result.error, tried };
    }
  }
  return { ok: false, error: tried.length ? 'none of these answered' : 'that is not an address', tried };
}

/** A refusal of the model rather than of the key: pick another, keep the key. */
function aboutTheModel(status, text) {
  if (status === 404) return true;
  return /model[_ ]?not[_ ]?found|not found for account|does not exist|no access to|not authorized to (use|access) (the )?model|is not a valid model|unknown model|decommissioned/i.test(text);
}

/**
 * The smallest real call there is, to prove a key: one token in, one out.
 * Given a list, walks past models the account cannot reach (a catalogue is
 * what a provider hosts, not what your account may call) and hands back the
 * first that answers. A refused key refuses every model, so that stops it.
 */
export async function tryKey({ baseURL, apiKey, model, models, extra = {}, fetchImpl = fetch }) {
  const list = (models ?? (model ? [model] : [])).filter(Boolean);
  if (!list.length) return { ok: null, error: 'no model to try' };
  const attempts = models ? list.slice(0, 6) : list;
  let last = null;
  for (const candidate of attempts) {
    try {
      const res = await fetchImpl(`${baseURL}/${extra.api === 'messages' ? 'messages' : 'chat/completions'}`, {
        method: 'POST',
        headers: headersFor(apiKey, extra, { 'content-type': 'application/json' }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        body: JSON.stringify({ model: candidate, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
      });
      if (res.ok) return { ok: true, model: candidate, tried: attempts.indexOf(candidate) + 1 };
      const text = await res.text();
      last = {
        ok: false, status: res.status, model: candidate,
        unauthorized: res.status === 401 || res.status === 403 || KEY_REFUSED_TEXT.test(text),
        modelUnavailable: aboutTheModel(res.status, text),
        error: explain(res.status, text),
      };
      if (last.unauthorized || !last.modelUnavailable) return last;
    } catch (err) {
      return { ok: false, model: candidate, error: err.name === 'TimeoutError' ? `no answer within ${TIMEOUT_MS / 1000}s` : (err.cause?.code || err.message) };
    }
  }
  return { ...last, exhausted: attempts.length };
}

// -------------------------------------------------------------- the rows

const sealKey = (secret) => crypto.createHash('sha256').update(`loversrock-ai-keys:${secret}`).digest();

function sealSecret() {
  const secret = process.env.FABLE_KEY_SECRET || process.env.JWT_REFRESH_SECRET;
  if (!secret) throw new Error('JWT_REFRESH_SECRET is not set, so API keys cannot be stored safely');
  return sealKey(secret);
}

/**
 * Secrets keys may have been sealed under before: FABLE_KEY_SECRET_OLD (put
 * there by docker/secure-setup.mjs when it changes the seal) and
 * JWT_REFRESH_SECRET (the seal when FABLE_KEY_SECRET was empty).
 */
function previousSeals() {
  const current = process.env.FABLE_KEY_SECRET || process.env.JWT_REFRESH_SECRET;
  return [...new Set([process.env.FABLE_KEY_SECRET_OLD, process.env.JWT_REFRESH_SECRET])]
    .filter((s) => s && s !== current)
    .map(sealKey);
}

export function sealApiKey(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', sealSecret(), iv);
  const body = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join(':');
}

function openWith(key, sealed) {
  try {
    const [v, iv, tag, body] = String(sealed).split(':');
    if (v !== 'v1') return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** A saved key, opened with the current seal or, failing that, a previous one. */
export function openApiKey(sealed) {
  const now = openWith(sealSecret(), sealed);
  if (now !== null) return now;
  for (const key of previousSeals()) {
    const old = openWith(key, sealed);
    if (old !== null) return old;
  }
  return null;
}

/**
 * Saved keys still sealed under a previous secret are sealed again under the
 * current one, so FABLE_KEY_SECRET can change without anyone pasting a key
 * again. Run at startup; returns how many were moved over.
 */
export async function resealApiKeys() {
  const olds = previousSeals();
  if (!olds.length) return 0;
  const current = sealSecret();
  let moved = 0;
  for (const table of ['ai_connections', 'ai_keys']) {
    const keyCols = table === 'ai_connections' ? ['pair_id', 'name'] : ['pair_id', 'provider'];
    const { rows } = await query(`SELECT ${keyCols.join(', ')}, key_enc FROM ${table} WHERE key_enc IS NOT NULL`);
    for (const row of rows) {
      if (openWith(current, row.key_enc) !== null) continue;
      const plain = olds.map((k) => openWith(k, row.key_enc)).find((p) => p !== null);
      if (plain == null) continue;
      await query(`UPDATE ${table} SET key_enc = $3 WHERE ${keyCols[0]} = $1 AND ${keyCols[1]} = $2`, [row[keyCols[0]], row[keyCols[1]], sealApiKey(plain)]);
      moved++;
    }
  }
  return moved;
}

export class ConnectionError extends Error {}

// The PC's own services, which a connection must never be pointed at: the
// other containers by name, and the ports the database, photo storage, this
// backend and the call servers listen on. A connection is a URL the backend
// fetches; aimed at one of these it would be a way to poke at them from
// inside. Ollama, LM Studio and Free Claude Code on the PC stay reachable.
const INTERNAL_HOSTS = new Set(['postgres', 'minio', 'backend', 'calls', 'coturn', 'metadata.google.internal']);
const INFRA_PORTS = new Set(['5432', '6379', '9000', '9001', '3478', '4100', '4101']);

/** Why an address may not be used for a connection, or null when it may. */
export function addressProblem(raw) {
  let url;
  try { url = new URL(String(raw)); } catch { return null; }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  if (INTERNAL_HOSTS.has(host)) return `"${host}" is one of the server's own services, not an AI.`;
  if (/^169\.254\./.test(host) || host === 'fd00:ec2::254') return 'That address is a cloud metadata service, not an AI.';
  const ownPort = String(process.env.PORT || 4000);
  const local = /^(localhost|127\.|0\.0\.0\.0|::1$|host\.docker\.internal|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(host);
  if (local && (INFRA_PORTS.has(port) || port === ownPort)) {
    return `Port ${port} on that machine is the server's own (database, storage, calls or this backend), not an AI.`;
  }
  return null;
}

/** A name has to survive being put in a URL. */
export function checkName(raw) {
  const name = String(raw ?? '').trim();
  if (!name) throw new ConnectionError('A connection needs a name.');
  if (name.length > 64) throw new ConnectionError('That name is too long.');
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(name)) throw new ConnectionError('Use letters, numbers, spaces, dots, dashes or underscores in the name.');
  return name;
}

const mask = (v) => (!v ? null : v.length <= 8 ? '•'.repeat(v.length) : `${'•'.repeat(8)}${v.slice(-4)}`);

/** How a row looks to the app: never the key, only enough to recognise it. */
function view(row) {
  const key = row.key_enc ? openApiKey(row.key_enc) : null;
  return {
    name: row.name,
    baseURL: row.base_url,
    model: row.model,
    extra: row.extra || {},
    keySet: Boolean(key),
    // The length, not the key: a key cut off when it was copied looks just
    // like a working one behind dots, and this is how to see that it is short.
    keyLength: key ? key.length : 0,
    keyPreview: mask(key),
    keyUnreadable: Boolean(row.key_enc) && !key,
    addedBy: row.added_by_name || null,
    createdAt: row.created_at,
  };
}

export async function listConnections(pairId) {
  const { rows } = await query(
    `SELECT c.*, u.name AS added_by_name FROM ai_connections c
       LEFT JOIN users u ON u.id = c.added_by
      WHERE c.pair_id = $1 ORDER BY c.created_at, c.name`,
    [pairId]
  );
  return rows.map(view);
}

/** Everything needed to call one, key included. Server-side callers only. */
export async function resolveConnection(pairId, name) {
  const { rows } = await query('SELECT * FROM ai_connections WHERE pair_id = $1 AND name = $2', [pairId, String(name)]);
  if (!rows[0]) return null;
  return { ...view(rows[0]), apiKey: rows[0].key_enc ? openApiKey(rows[0].key_enc) : null };
}

/**
 * Add or change one. `apiKey` undefined leaves the stored key alone, so
 * re-saving a row cannot wipe it; a pasted key is cleaned first.
 */
export async function saveConnection(pairId, userId, { name, baseURL, model, apiKey, extra, rename }) {
  const handle = checkName(name);
  const { rows: existing } = await query('SELECT * FROM ai_connections WHERE pair_id = $1 AND name = $2', [pairId, handle]);
  const old = existing[0];
  const url = String(baseURL ?? old?.base_url ?? '').trim().replace(/\/+$/, '');
  if (url && !/^https?:\/\/\S+$/i.test(url)) throw new ConnectionError('The address must start with http:// or https://');
  const refused = url && addressProblem(url);
  if (refused) throw new ConnectionError(refused);
  let keyEnc = old?.key_enc ?? null;
  if (apiKey !== undefined) {
    const key = cleanKey(apiKey);
    if (key && key.length < 8) throw new ConnectionError('That does not look like a whole API key. Paste all of it.');
    keyEnc = key ? sealApiKey(key) : null;
  }
  const ex = extra === undefined ? (old?.extra ?? {}) : (extra ?? {});
  await query(
    `INSERT INTO ai_connections (pair_id, name, base_url, key_enc, model, extra, added_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (pair_id, name) DO UPDATE
       SET base_url = EXCLUDED.base_url, key_enc = EXCLUDED.key_enc, model = EXCLUDED.model, extra = EXCLUDED.extra`,
    [pairId, handle, url, keyEnc, String(model ?? old?.model ?? '').trim(), JSON.stringify(ex), userId]
  );
  if (rename && rename.trim() !== handle) {
    const to = checkName(rename);
    await query('UPDATE ai_connections SET name = $3 WHERE pair_id = $1 AND name = $2', [pairId, handle, to]);
    await query('UPDATE fable_settings SET connection = $3 WHERE pair_id = $1 AND connection = $2', [pairId, handle, to]);
    return to;
  }
  return handle;
}

export async function removeConnection(pairId, name) {
  const { rowCount } = await query('DELETE FROM ai_connections WHERE pair_id = $1 AND name = $2', [pairId, String(name)]);
  return rowCount > 0;
}

// The old setup's provider ids, and the addresses they meant.
const LEGACY_URLS = {
  gemini: ['Gemini', 'https://generativelanguage.googleapis.com/v1beta/openai'],
  groq: ['Groq', 'https://api.groq.com/openai/v1'],
  openrouter: ['OpenRouter', 'https://openrouter.ai/api/v1'],
  mistral: ['Mistral', 'https://api.mistral.ai/v1'],
  openai: ['OpenAI', 'https://api.openai.com/v1'],
  anthropic: ['Claude', 'https://api.anthropic.com/v1'],
  deepseek: ['DeepSeek', 'https://api.deepseek.com/v1'],
  together: ['Together', 'https://api.together.xyz/v1'],
  ollama: ['Ollama', 'http://host.docker.internal:11434/v1'],
  custom: ['Custom', ''],
};

/**
 * The keys saved under the old setup (one per provider) become connections,
 * once, so nobody has to paste them again; the chosen provider becomes the
 * chosen connection.
 */
export async function migrateLegacy(pairId) {
  const { rows: have } = await query('SELECT 1 FROM ai_connections WHERE pair_id = $1 LIMIT 1', [pairId]);
  if (have.length) return false;
  const { rows: keys } = await query('SELECT * FROM ai_keys WHERE pair_id = $1 ORDER BY created_at', [pairId]);
  const { rows: settings } = await query('SELECT * FROM fable_settings WHERE pair_id = $1', [pairId]);
  const s = settings[0];
  let chosen = null;
  for (const k of keys) {
    const [name, url] = LEGACY_URLS[k.provider] || [k.provider, ''];
    const baseURL = k.provider === 'custom' ? (s?.base_url || '') : url;
    const model = s?.provider === k.provider ? s.model : '';
    await query(
      `INSERT INTO ai_connections (pair_id, name, base_url, key_enc, model, extra, added_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`,
      [pairId, name, baseURL, k.key_enc, model || '', JSON.stringify(k.provider === 'anthropic' ? { api: 'messages' } : {}), k.added_by, k.created_at]
    );
    if (s?.provider === k.provider) chosen = name;
  }
  if (s && !s.connection && (chosen || s.provider === 'ollama')) {
    if (!chosen) {
      await query(
        `INSERT INTO ai_connections (pair_id, name, base_url, model, extra) VALUES ($1, 'Ollama', $2, $3, '{}') ON CONFLICT DO NOTHING`,
        [pairId, LEGACY_URLS.ollama[1], s.model || '']
      );
      chosen = 'Ollama';
    }
    await query('UPDATE fable_settings SET connection = $2 WHERE pair_id = $1', [pairId, chosen]);
  }
  return keys.length > 0;
}
