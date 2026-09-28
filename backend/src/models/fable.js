// Fable: the group chat between the two of you and your AI agents.
//
// The chat itself lives in collaboration-des-esprits, the room your agents
// already meet in (github.com/s-rakim/collaboration-des-esprits). It has a
// Telegram bridge; this is the same idea for the app. The phones never talk
// to the room directly: they talk to this backend, which only lets the paired
// couple in and relays to the room's JSON API with the room's token. So the
// token stays on the server, and each of you posts under your own name.
//
// Configuration (backend/.env):
//   ESPRITS_URL     where the room listens, from inside Docker. The room runs
//                   on the same PC, so http://host.docker.internal:4300
//   ESPRITS_TOKEN   the room's ESPRITS_TOKEN, if it has one (it must, if it
//                   listens on anything but 127.0.0.1)

export class FableUnavailable extends Error {
  constructor(message, status = 503) {
    super(message);
    this.status = status;
  }
}

export function fableConfig(env = process.env) {
  const url = String(env.ESPRITS_URL || '').trim().replace(/\/+$/, '');
  if (!url) return null;
  return { url, token: String(env.ESPRITS_TOKEN || '').trim() };
}

/**
 * The name a person has in the room. The room uses names for @mentions, so
 * they cannot contain spaces; "Hobi" stays "Hobi", "Mary Jane" becomes
 * "Mary_Jane". A name that is empty after that falls back to a stable one.
 */
export function roomName(displayName, userId) {
  const clean = String(displayName || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_.-]/g, '')
    .slice(0, 32);
  return clean || `member-${String(userId || '').slice(0, 8)}`;
}

/** One call to the room's JSON API. */
export async function esprits(config, path, { method = 'GET', body, timeoutMs = 10000 } = {}) {
  if (!config) {
    throw new FableUnavailable('Fable is not set up on the server yet: ESPRITS_URL is empty in backend/.env.');
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${config.url}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
  } catch (err) {
    throw new FableUnavailable(
      `Fable's room is not answering at ${config.url}. Start collaboration-des-esprits on the server PC (npm start).`
    );
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    throw new FableUnavailable('The room refused the server: ESPRITS_TOKEN in backend/.env does not match the room\'s.');
  }
  if (!res.ok) {
    // The room's own message is written for people ("body is required", …).
    throw new FableUnavailable(data.error || `The room answered ${res.status}.`, res.status >= 500 ? 502 : 400);
  }
  return data;
}

/**
 * Makes sure a person is in the room, as a human. The room's join is
 * idempotent, but it posts "X joined" the first time, so it is remembered
 * here and repeated only after a restart or once an hour.
 */
const joined = new Map();
export async function ensureJoined(config, name) {
  const key = `${config?.url}|${name}`;
  if (joined.has(key) && Date.now() - joined.get(key) < 60 * 60 * 1000) return;
  await esprits(config, '/api/join', {
    method: 'POST',
    body: { name, role: 'human', kind: 'human', model: 'loversrock' },
  });
  joined.set(key, Date.now());
}

/** The room's messages as the app shows them. */
export function presentMessage(m, me) {
  return {
    id: m.id,
    author: m.author,
    authorKind: m.authorKind,     // 'human' | 'agent' | 'system'
    kind: m.kind,                 // 'message', or a structured post (proposal, decision, …)
    body: m.body,
    idea: m.idea || null,         // which idea's thread, or null for the lobby
    replyTo: m.replyTo ?? null,
    createdAt: m.createdAt,
    mine: m.author === me,
  };
}
