// The AI room: Collaboration des Esprits (docker/esprits), which replaced
// Fable.
//
// Esprits is its own server with its own JSON API and one token for all of
// it. The phones never hold that token: they talk to /esprits on this
// backend, which signs each of you in to the room under your own name and
// passes the call on. Everything about models (which ones, their keys) lives
// in Esprits and in Free Claude Code, not here.
import { readFileSync } from 'fs';
import { query } from '../config/db.js';

const TIMEOUT_MS = 10_000;

export class EspritsError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

/** Where the room is (ESPRITS_URL), or null when it is not set up. */
export function espritsUrl(env = process.env) {
  const url = String(env.ESPRITS_URL || '').trim().replace(/\/+$/, '');
  return url || null;
}

let cachedToken = null;
/**
 * The room's token: ESPRITS_TOKEN, or the one the esprits container made on
 * first start (ESPRITS_TOKEN_FILE, a volume both containers share). Read
 * again after a refusal, in case the room was rebuilt with a new one.
 */
export function espritsToken(env = process.env, { fresh = false } = {}) {
  if (env.ESPRITS_TOKEN) return String(env.ESPRITS_TOKEN).trim();
  if (cachedToken && !fresh) return cachedToken;
  if (!env.ESPRITS_TOKEN_FILE) return null;
  try {
    cachedToken = readFileSync(env.ESPRITS_TOKEN_FILE, 'utf8').trim() || null;
  } catch {
    cachedToken = null;
  }
  return cachedToken;
}

/** One call to the room. Throws EspritsError with a sentence that says what went wrong. */
export async function esprits(path, { method = 'GET', body, env = process.env, fetchImpl = fetch, retried = false } = {}) {
  const base = espritsUrl(env);
  if (!base) throw new EspritsError('The AI room is not set up on the server (no ESPRITS_URL).', 503);
  const token = espritsToken(env, { fresh: retried });
  let res;
  try {
    res = await fetchImpl(`${base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new EspritsError(`The AI room is not answering (${err.cause?.code || err.name || 'no answer'}). Is the esprits container running?`, 503);
  }
  if (res.status === 401 && !retried && !env.ESPRITS_TOKEN) {
    return esprits(path, { method, body, env, fetchImpl, retried: true });
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) {
    const message = data?.error || `The AI room answered ${res.status}`;
    throw new EspritsError(res.status === 401 ? 'The AI room refused the server\'s token.' : message, res.status === 401 ? 502 : res.status);
  }
  return data;
}

/**
 * Your name in the room: your first name, lower case, letters and digits.
 * Two of you with the same first name get the start of your id added, so
 * the room never takes one of you for the other.
 */
export function handleFor(user, partner) {
  const slug = (name) => String(name || '').toLowerCase().normalize('NFKD')
    .replace(/[̀-ͯ]/g, '').split(/\s+/)[0].replace(/[^a-z0-9]/g, '').slice(0, 20);
  const mine = slug(user?.name) || 'me';
  if (partner && slug(partner.name) === mine) return `${mine}-${String(user.id).slice(0, 4)}`;
  return mine;
}

/** Who has joined the room through the app, and as whom, for pushes and names. */
export async function rememberMember(userId, handle) {
  await query(
    `INSERT INTO esprits_members (user_id, handle) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET handle = EXCLUDED.handle`,
    [userId, handle]
  );
}

export async function members() {
  const { rows } = await query(
    `SELECT m.user_id, m.handle, u.name FROM esprits_members m JOIN users u ON u.id = m.user_id`
  );
  return rows;
}

const joined = new Set();
/** Joins the room as a person, once per name per server run. */
export async function ensureJoined(handle, opts = {}) {
  if (joined.has(handle)) return;
  await esprits('/api/join', { method: 'POST', body: { name: handle, role: 'human', kind: 'human' }, ...opts });
  joined.add(handle);
}
export const forgetJoined = () => joined.clear();
