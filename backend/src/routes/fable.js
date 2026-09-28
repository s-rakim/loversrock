// Fable: the group chat with your AI agents, reached through this backend.
// See models/fable.js for why the phones go through here rather than
// straight to the room.
import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import {
  FableUnavailable, fableConfig, roomName, esprits, ensureJoined, presentMessage,
} from '../models/fable.js';

const router = asyncRouter();
router.use(requireAuth, requirePair);

/** A reply of the room's making, or the reason there is none. */
const fail = (res, err) => {
  if (err instanceof FableUnavailable) return res.status(err.status).json({ error: err.message, fable: 'unavailable' });
  throw err;
};

/**
 * Your name in the room. Both of you get your own; if your names would
 * collide (two "Sam"s), the second of you by id gets a suffix, so the room
 * never merges two people into one participant.
 */
async function nameFor(req) {
  const { rows } = await query('SELECT id, name FROM users WHERE id = ANY($1::uuid[])', [[req.userId, req.partnerId]]);
  const me = rows.find((r) => r.id === req.userId);
  const partner = rows.find((r) => r.id === req.partnerId);
  const mine = roomName(me?.name, req.userId);
  if (partner && roomName(partner.name, partner.id) === mine && String(req.userId) > String(partner.id)) {
    return `${mine}_2`;
  }
  return mine;
}

/** Is Fable set up, and is the room answering? For the chat's empty state. */
router.get('/status', async (req, res) => {
  const config = fableConfig();
  const name = await nameFor(req);
  if (!config) return res.json({ configured: false, reachable: false, name });
  try {
    await esprits(config, '/api/roster');
    res.json({ configured: true, reachable: true, name });
  } catch (err) {
    if (!(err instanceof FableUnavailable)) throw err;
    res.json({ configured: true, reachable: false, name, error: err.message });
  }
});

/**
 * Messages after `since` (a message id; 0 for the start). Pages until caught
 * up or 1500 messages, whichever first, so a long-quiet phone catches up in
 * one request without an unbounded one.
 */
router.get('/feed', async (req, res) => {
  const config = fableConfig();
  try {
    const name = await nameFor(req);
    await ensureJoined(config, name);
    let since = Math.max(0, Number(req.query.since) || 0);
    const messages = [];
    for (let page = 0; page < 3; page += 1) {
      const data = await esprits(config, `/api/feed?since=${since}`);
      messages.push(...(data.messages || []).map((m) => presentMessage(m, name)));
      since = Number(data.head) || since;
      if (!data.more) break;
    }
    res.json({ name, head: since, messages });
  } catch (err) {
    fail(res, err);
  }
});

/** Say something in the room, as yourself. @name tags an agent. */
router.post('/messages', async (req, res) => {
  const body = String(req.body?.body ?? '').trim();
  if (!body) return res.status(400).json({ error: 'Type a message first.' });
  if (body.length > 8000) return res.status(400).json({ error: 'That message is too long for the room (8000 characters).' });
  const config = fableConfig();
  try {
    const name = await nameFor(req);
    await ensureJoined(config, name);
    const idea = req.body?.idea ? String(req.body.idea) : null;
    const posted = await esprits(config, '/api/post', { method: 'POST', body: { body, as: name, idea } });
    res.status(201).json({ ok: true, id: posted?.id ?? null, mentions: posted?.mentions || [] });
  } catch (err) {
    fail(res, err);
  }
});

/** Who is in the room: the two of you and every agent, with what they are doing. */
router.get('/roster', async (req, res) => {
  const config = fableConfig();
  try {
    const roster = await esprits(config, '/api/roster');
    res.json({
      members: (Array.isArray(roster) ? roster : []).map((a) => ({
        name: a.name, role: a.role, kind: a.kind, status: a.status, model: a.model || null,
      })),
    });
  } catch (err) {
    fail(res, err);
  }
});

export default router;
