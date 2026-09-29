// Fable: the group chat between the two of you and an AI model, and the
// setup page behind it. See models/fableAi.js for where the keys live and how
// the model is reached.
import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import { getUserDeviceTokens } from '../models/pairs.js';
import { sendNotification, deepLink, CHANNELS } from '../config/firebase.js';
import {
  PROVIDERS, DEFAULT_SETTINGS, HISTORY_FOR_AI, MAX_BODY, FableSetupError,
  listKeys, saveKey, deleteKey, getSettings, saveSettings, deleteSettings, cleanSettings,
  serverConnector, resolveConfig, wantsReply, systemPrompt, transcript, cleanReply, askChat,
} from '../models/fableAi.js';

const router = asyncRouter();
router.use(requireAuth, requirePair);

const setupError = (res, err) => {
  if (err instanceof FableSetupError) return res.status(400).json({ error: err.message });
  throw err;
};

/** Both of your names, yours first. */
async function namesOf(req) {
  const { rows } = await query('SELECT id, name FROM users WHERE id = ANY($1::uuid[])', [[req.userId, req.partnerId]]);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r.name]));
  return { [req.userId]: byId[req.userId] || 'You', [req.partnerId]: byId[req.partnerId] || 'Your partner' };
}

function present(row, names, me, botName) {
  return {
    id: Number(row.id),
    authorKind: row.author_kind,
    author: row.author_kind === 'ai' ? botName : row.author_kind === 'system' ? null : (names[row.user_id] || 'Someone'),
    mine: row.author_kind === 'user' && row.user_id === me,
    body: row.body,
    createdAt: row.created_at,
  };
}

// ------------------------------------------------------------------ setup

/** Everything the setup page shows. Keys come back as hints only. */
router.get('/settings', async (req, res) => {
  const settings = await getSettings(req.pair.id);
  const keys = await listKeys(req.pair.id);
  const { problem } = settings ? await resolveConfig(req.pair.id, settings) : { problem: null };
  res.json({
    settings: settings || { ...DEFAULT_SETTINGS },
    saved: Boolean(settings),
    ready: Boolean(settings) && !problem,
    problem: settings ? problem || null : null,
    keys,
    providers: PROVIDERS,
    server: serverConnector(),
  });
});

router.put('/settings', async (req, res) => {
  try {
    const settings = await saveSettings(req.pair.id, req.userId, req.body || {});
    const { problem } = await resolveConfig(req.pair.id, settings);
    res.json({ settings, ready: !problem, problem: problem || null });
  } catch (err) { setupError(res, err); }
});

router.delete('/settings', async (req, res) => {
  await deleteSettings(req.pair.id);
  res.json({ ok: true });
});

/** Adds or replaces the key for one provider. The key never comes back. */
router.put('/keys/:provider', async (req, res) => {
  try {
    await saveKey(req.pair.id, req.userId, req.params.provider, req.body?.apiKey);
    res.json({ keys: await listKeys(req.pair.id) });
  } catch (err) { setupError(res, err); }
});

router.delete('/keys/:provider', async (req, res) => {
  await deleteKey(req.pair.id, req.params.provider);
  res.json({ keys: await listKeys(req.pair.id) });
});

/**
 * Tries a setup without saving it: the settings on the page, with the key
 * typed there or the one already saved. Says hello, or says what is wrong.
 */
router.post('/test', async (req, res) => {
  let settings;
  try {
    settings = cleanSettings(req.body || {}, await getSettings(req.pair.id));
  } catch (err) { return setupError(res, err); }
  const { config, problem } = await resolveConfig(req.pair.id, settings, { apiKey: req.body?.apiKey });
  if (!config) return res.status(400).json({ ok: false, error: problem });
  const started = Date.now();
  try {
    const reply = await askChat(config, {
      system: `You are ${settings.botName}, an AI in a couple's group chat, being tested.`,
      user: 'Say hello to the couple in one short, friendly sentence.',
    });
    res.json({ ok: true, reply: cleanReply(reply, settings.botName), provider: config.provider, model: config.model, ms: Date.now() - started });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ------------------------------------------------------------------- chat

/** The chat, oldest first. `since` (a message id) returns only what is newer. */
router.get('/messages', async (req, res) => {
  const since = Number(req.query.since) || 0;
  const settings = await getSettings(req.pair.id);
  const { rows } = since
    ? await query('SELECT * FROM fable_messages WHERE pair_id = $1 AND id > $2 ORDER BY id LIMIT 500', [req.pair.id, since])
    : await query(
      `SELECT * FROM (SELECT * FROM fable_messages WHERE pair_id = $1 ORDER BY id DESC LIMIT 300) recent ORDER BY id`,
      [req.pair.id]
    );
  const names = await namesOf(req);
  const botName = settings?.botName || DEFAULT_SETTINGS.botName;
  const { problem } = settings ? await resolveConfig(req.pair.id, settings) : { problem: 'not set up' };
  res.json({
    messages: rows.map((r) => present(r, names, req.userId, botName)),
    botName,
    replyMode: settings?.replyMode || DEFAULT_SETTINGS.replyMode,
    ready: Boolean(settings) && !problem,
    problem: settings ? problem || null : null,
    thinking: replying.has(req.pair.id),
  });
});

router.post('/messages', async (req, res) => {
  const body = String(req.body?.body ?? '').trim();
  if (!body) return res.status(400).json({ error: 'Type a message first.' });
  if (body.length > MAX_BODY) return res.status(400).json({ error: `Keep it under ${MAX_BODY} characters.` });

  const { rows } = await query(
    `INSERT INTO fable_messages (pair_id, author_kind, user_id, body) VALUES ($1, 'user', $2, $3) RETURNING *`,
    [req.pair.id, req.userId, body]
  );
  const settings = await getSettings(req.pair.id);
  const names = await namesOf(req);
  const botName = settings?.botName || DEFAULT_SETTINGS.botName;
  const io = req.app.get('io');
  const room = `pair:${req.pair.id}`;
  // Each phone works out "mine" for itself from the user id.
  io?.to(room).emit('fable:message', { message: present(rows[0], names, null, botName), userId: req.userId });

  const reply = wantsReply(body, settings);
  res.status(201).json({ message: present(rows[0], names, req.userId, botName), aiReplying: reply });

  // Your partner hears about it the way they hear about any message.
  getUserDeviceTokens(req.partnerId)
    .then((tokens) => sendNotification(
      tokens,
      { title: `${names[req.userId]} in ${botName}`, body: body.length > 120 ? `${body.slice(0, 117)}…` : body },
      deepLink('fable', {}),
      { channel: CHANNELS.partner, priority: 'high', collapseKey: `fable:${req.pair.id}` }
    ))
    .catch((err) => console.error('[fable] push failed:', err.message));

  if (reply) queueReply(req, settings, names, io, room);
});

router.delete('/messages', async (req, res) => {
  await query('DELETE FROM fable_messages WHERE pair_id = $1', [req.pair.id]);
  req.app.get('io')?.to(`pair:${req.pair.id}`).emit('fable:cleared', {});
  res.json({ ok: true });
});

// ----------------------------------------------------------- the AI turn

/**
 * One reply at a time per pair, in the order the messages came. Two quick
 * messages get two answers, each able to see the one before it.
 */
const queues = new Map();
const replying = new Set();

function queueReply(req, settings, names, io, room) {
  const pairId = req.pair.id;
  const latestAuthor = names[req.userId];
  const run = async () => {
    replying.add(pairId);
    io?.to(room).emit('fable:thinking', { thinking: true });
    let row;
    try {
      const { config, problem } = await resolveConfig(pairId, settings);
      if (!config) throw new Error(problem);
      const { rows: history } = await query(
        `SELECT * FROM (SELECT * FROM fable_messages WHERE pair_id = $1 AND author_kind <> 'system'
           ORDER BY id DESC LIMIT $2) recent ORDER BY id`,
        [pairId, HISTORY_FOR_AI]
      );
      const labelled = history.map((m) => ({
        authorName: m.author_kind === 'ai' ? settings.botName : (names[m.user_id] || 'Someone'),
        body: m.body,
      }));
      const text = cleanReply(await askChat(config, {
        system: systemPrompt(settings, [names[req.userId], names[req.partnerId]]),
        user: transcript(labelled, settings, latestAuthor),
      }), settings.botName);
      ({ rows: [row] } = await query(
        `INSERT INTO fable_messages (pair_id, author_kind, body) VALUES ($1, 'ai', $2) RETURNING *`,
        [pairId, text || '…']
      ));
    } catch (err) {
      console.error(`[fable] no reply for pair ${pairId}:`, err.message);
      ({ rows: [row] } = await query(
        `INSERT INTO fable_messages (pair_id, author_kind, body) VALUES ($1, 'system', $2) RETURNING *`,
        [pairId, `${settings.botName} could not answer: ${err.message}`]
      ));
    } finally {
      replying.delete(pairId);
    }
    io?.to(room).emit('fable:message', { message: present(row, names, null, settings.botName) });
    io?.to(room).emit('fable:thinking', { thinking: replying.has(pairId) });
  };
  const next = (queues.get(pairId) || Promise.resolve()).then(run, run);
  queues.set(pairId, next);
  next.finally(() => { if (queues.get(pairId) === next) queues.delete(pairId); });
}

export default router;
