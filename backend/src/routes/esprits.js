// /esprits: the app's way into the AI room (models/esprits.js).
//
// Signed in to loversrock and paired is enough. Each call is made to the room
// as YOU (your handle, never one the phone names), with the server's token,
// which never leaves this machine.
import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import {
  esprits, EspritsError, espritsUrl, handleFor, ensureJoined, rememberMember, members,
} from '../models/esprits.js';

const router = asyncRouter();
router.use(requireAuth, requirePair);

const MAX_BODY = 8000;
// The first load shows the most recent stretch of the room, not all of it.
const FIRST_PAGE = 200;

/** Errors from the room become a status and a sentence, not a 500. */
const guarded = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof EspritsError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
};

/** You and your partner as the room knows you, and your names in the app. */
async function whoami(req) {
  const { rows } = await query('SELECT id, name FROM users WHERE id = ANY($1::uuid[])', [[req.userId, req.partnerId]]);
  const me = rows.find((u) => u.id === req.userId);
  const partner = rows.find((u) => u.id === req.partnerId);
  const handle = handleFor(me, partner);
  return { me, partner, handle };
}

async function joinAs(req) {
  const who = await whoami(req);
  await ensureJoined(who.handle);
  await rememberMember(req.userId, who.handle);
  return who;
}

/** Where the full room's pages are, for the phone's browser. */
export function webUrl(req, env = process.env) {
  if (env.ESPRITS_PUBLIC_URL) return env.ESPRITS_PUBLIC_URL;
  const host = String(req.hostname || '').trim();
  if (!host || !espritsUrl(env)) return null;
  return `http://${host.includes(':') ? `[${host}]` : host}:${env.ESPRITS_PORT || 4300}/`;
}

/**
 * How the room is: reachable or not, whether Free Claude Code answers, the
 * seats (the models in the chat), who is mid-reply. `problem` is the one
 * sentence the screen shows when the room cannot answer you yet.
 */
router.get('/status', guarded(async (req, res) => {
  const who = await whoami(req);
  const base = { me: who.handle, webUrl: webUrl(req) };
  if (!espritsUrl()) {
    return res.json({ ...base, ready: false, reachable: false, problem: 'The AI room is not set up on the server. Rebuild with docker compose up -d --build.' });
  }
  let fcc; let busy; let seatsList;
  try {
    [fcc, busy, seatsList] = await Promise.all([
      esprits('/api/fcc'),
      esprits('/api/busy').catch(() => ({ seats: [] })),
      esprits('/api/seats').catch(() => ({ seats: [] })),
    ]);
  } catch (err) {
    return res.json({ ...base, ready: false, reachable: false, problem: err.message });
  }
  const seats = (seatsList.seats || []).map((s) => ({
    name: s.name, role: s.role, model: s.model || null, enabled: Boolean(s.enabled), ready: Boolean(s.ready),
  }));
  const inChat = seats.filter((s) => s.enabled);
  let problem = null;
  if (!inChat.length) {
    problem = fcc.running
      ? 'Free Claude Code is running, but no model has a seat yet. Tap Connect.'
      : 'Start Free Claude Code on the PC (fcc-server), then tap Connect.';
  } else if (fcc.connection && !fcc.running) {
    problem = 'Free Claude Code is not answering on the PC, so the models cannot reply. Start fcc-server.';
  }
  res.json({
    ...base,
    reachable: true,
    ready: inChat.length > 0 && !problem,
    problem,
    fcc: { running: Boolean(fcc.running), model: fcc.connection?.model || null, connected: Boolean(fcc.connection) },
    seats,
    busy: busy.seats || [],
  });
}));

/**
 * The room's messages, oldest first. `since` (a message id) gives only what
 * is newer; without it, the most recent stretch. Each says whether it is
 * yours, and a person's name is the one they have in the app.
 */
router.get('/feed', guarded(async (req, res) => {
  const who = await whoami(req);
  let since = Number(req.query.since);
  if (!Number.isFinite(since) || since < 0) {
    const health = await esprits('/health');
    since = Math.max(0, Number(health.head || 0) - FIRST_PAGE);
  }
  const feed = await esprits(`/api/feed?since=${since}`);
  const names = new Map((await members()).map((m) => [m.handle, m.name]));
  names.set(who.handle, who.me?.name || who.handle);
  res.json({
    head: feed.head,
    more: Boolean(feed.more),
    me: who.handle,
    messages: (feed.messages || []).map((m) => ({
      id: m.id,
      idea: m.idea || null,
      author: m.author,
      // A person who joined through the app is shown by their name in it.
      name: m.authorKind === 'human' ? (names.get(m.author) || m.author) : m.author,
      authorKind: m.authorKind,
      kind: m.kind,
      body: m.body,
      replyTo: m.replyTo ?? null,
      createdAt: m.createdAt,
      mine: m.author === who.handle,
    })),
  });
}));

/** Say something. With no @, every model in the room answers; @seat asks one. */
router.post('/post', guarded(async (req, res) => {
  const body = String(req.body?.body ?? '').trim();
  if (!body) return res.status(400).json({ error: 'Type a message first.' });
  if (body.length > MAX_BODY) return res.status(400).json({ error: `Keep it under ${MAX_BODY} characters.` });
  const who = await joinAs(req);
  const posted = await esprits('/api/post', { method: 'POST', body: { as: who.handle, body, kind: 'message' } });
  res.status(201).json({ message: posted });
}));

/** Drop an idea: the room's way of starting a piece of work (see its README). */
router.post('/ideas', guarded(async (req, res) => {
  const title = String(req.body?.title ?? '').trim();
  const raw = String(req.body?.raw ?? '').trim();
  if (!title) return res.status(400).json({ error: 'An idea needs a title.' });
  if (title.length > 200 || raw.length > MAX_BODY) return res.status(400).json({ error: 'That idea is too long.' });
  const who = await joinAs(req);
  const idea = await esprits('/api/ideas', { method: 'POST', body: { as: who.handle, title, raw } });
  res.status(201).json({ idea });
}));

/** Stop every reply in progress (the seats stay in the room). */
router.post('/stop', guarded(async (req, res) => {
  res.json(await esprits('/api/interrupt', { method: 'POST', body: {} }));
}));

/**
 * Connect Free Claude Code: seats every model in the room on it. `baseURL`
 * and `token` only when FCC is somewhere else, or its proxy auth is on.
 */
router.post('/connect', guarded(async (req, res) => {
  const body = {};
  if (req.body?.baseURL) {
    const url = String(req.body.baseURL).trim();
    if (!/^https?:\/\/\S+$/i.test(url)) return res.status(400).json({ error: 'The address must start with http:// or https://' });
    body.baseURL = url;
  }
  if (req.body?.token) body.apiKey = String(req.body.token).trim();
  res.json(await esprits('/api/connections/from-fcc', { method: 'POST', body }));
}));

export default router;
