// Fable: the group chat between the two of you and an AI model, and the
// setup page behind it. See models/fableAi.js for where the keys live and how
// the model is reached.
import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import { getUserDeviceTokens } from '../models/pairs.js';
import { sendNotification, deepLink, CHANNELS } from '../config/firebase.js';
import {
  DEFAULT_SETTINGS, HISTORY_FOR_AI, MAX_BODY, FableSetupError,
  getSettings, saveSettings, deleteSettings, cleanSettings,
  serverConnector, resolveConfig, wantsReply, systemPrompt, transcript, cleanReply, askWithFallback,
  chatModels, refreshSharedAiConfig,
} from '../models/fableAi.js';
import {
  PRESETS, ConnectionError, listConnections, resolveConnection, saveConnection, removeConnection,
  parseSnippet, hostName, probe, tryKey, asSent,
} from '../models/aiConnections.js';

const router = asyncRouter();
router.use(requireAuth, requirePair);


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

const setupError = (res, err) => {
  if (err instanceof FableSetupError || err instanceof ConnectionError) return res.status(400).json({ error: err.message });
  throw err;
};

/** Everything the setup page shows. Keys come back as a length and last four only. */
router.get('/settings', async (req, res) => {
  const settings = await getSettings(req.pair.id);
  const { problem } = settings ? await resolveConfig(req.pair.id, settings) : { problem: null };
  res.json({
    settings: settings || { ...DEFAULT_SETTINGS },
    saved: Boolean(settings),
    ready: Boolean(settings) && !problem,
    problem: settings ? problem || null : null,
    connections: await listConnections(req.pair.id),
    presets: PRESETS,
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

// -------------------------------------------------------------- connections

/**
 * Add or change a connection: name, address, model, and a key only when one
 * was typed (re-saving a row never wipes the key). `use` makes it Fable's.
 */
router.put('/connections/:name', async (req, res) => {
  try {
    const { baseURL, model, apiKey, extra, rename, use } = req.body || {};
    const name = await saveConnection(req.pair.id, req.userId, {
      name: req.params.name, baseURL, model, apiKey, extra, rename,
    });
    if (use) await saveSettings(req.pair.id, req.userId, { source: 'key', connection: name });
    else await refreshSharedAiConfig();
    res.json({ name, connections: await listConnections(req.pair.id) });
  } catch (err) { setupError(res, err); }
});

router.delete('/connections/:name', async (req, res) => {
  const removed = await removeConnection(req.pair.id, req.params.name);
  if (!removed) return res.status(404).json({ error: 'No such connection.' });
  await refreshSharedAiConfig();
  res.json({ connections: await listConnections(req.pair.id) });
});

/**
 * Find: ask the endpoint which address works and which models it serves,
 * repair the address if one of the usual mistakes was the problem, then prove
 * the key with the smallest real call. A model it has never heard of is
 * cleared; with none chosen, the first that answers is kept.
 */
router.post('/connections/:name/find', async (req, res) => {
  const conn = await resolveConnection(req.pair.id, req.params.name);
  if (!conn) return res.status(404).json({ ok: false, error: 'No such connection.' });
  const baseURL = String(req.body?.baseURL ?? conn.baseURL ?? '').trim();
  if (!baseURL) return res.status(400).json({ ok: false, error: 'There is no address to check.' });

  const found = await probe({ baseURL, apiKey: conn.apiKey, extra: conn.extra });
  if (!found.ok) {
    return res.status(400).json({
      ...found,
      error: found.unauthorized
        ? `${found.baseURL} is the right address, but the key was refused (${found.error}). It ${asSent(conn)}.`
        : `${found.error}: tried ${found.tried.map((t) => t.baseURL).join(', ') || 'nothing'}`,
    });
  }
  const models = chatModels(found.baseURL, found.models);
  const keepsModel = Boolean(conn.model) && found.models.includes(conn.model);
  const usable = await tryKey({
    baseURL: found.baseURL, apiKey: conn.apiKey, extra: conn.extra,
    ...(keepsModel ? { model: conn.model } : { models: models.length ? models : found.models }),
  });
  const model = keepsModel ? conn.model : (usable.ok ? usable.model : '');
  await saveConnection(req.pair.id, req.userId, { name: conn.name, baseURL: found.baseURL, model });
  await refreshSharedAiConfig();
  res.json({
    ok: usable.ok === true,
    baseURL: found.baseURL,
    changed: found.changed,
    models: models.length ? models : found.models,
    model,
    clearedModel: conn.model && !keepsModel ? conn.model : null,
    key: usable.ok ? { ok: true, model: usable.model }
      : { ok: false, error: usable.unauthorized ? `The key was refused (${usable.error}). It ${asSent(conn)}.` : usable.error },
  });
});

/**
 * Test: Fable says hello through this connection (or the chosen one), the
 * way the chat would, trying other models if this one is busy or gone.
 */
async function testConnection(req, res, name) {
  const settings = cleanSettings(req.body || {}, await getSettings(req.pair.id));
  const { config, problem } = await resolveConfig(req.pair.id, settings, name ? { connection: name } : {});
  if (!config) return res.status(400).json({ ok: false, error: problem });
  const started = Date.now();
  try {
    const got = await askWithFallback(req.pair.id, config, {
      system: `You are ${settings.botName}, an AI in a couple's group chat, being tested.`,
      user: 'Say hello to the couple in one short, friendly sentence.',
    });
    res.json({
      ok: true,
      reply: cleanReply(got.text, settings.botName),
      connection: got.config.name,
      model: got.config.model,
      fallback: got.fallback,
      ms: Date.now() - started,
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
}
router.post('/connections/:name/test', async (req, res) => {
  try { await testConnection(req, res, req.params.name); } catch (err) { setupError(res, err); }
});
router.post('/test', async (req, res) => {
  try { await testConnection(req, res, null); } catch (err) { setupError(res, err); }
});

/**
 * Paste the example from the page where the key was made (Python,
 * JavaScript or curl): the address, key, model and parameter names are read
 * out of it, saved as a connection, checked with Find, and made Fable's.
 */
router.post('/connections/from-snippet', async (req, res) => {
  const parsed = parseSnippet(req.body?.snippet ?? '');
  if (!parsed.ok) return res.status(400).json({ ok: false, error: parsed.error });
  const name = String(req.body?.name ?? '').trim() || hostName(parsed.baseURL) || 'pasted';
  let saved;
  try {
    const existing = await resolveConnection(req.pair.id, name);
    saved = await saveConnection(req.pair.id, req.userId, {
      name,
      baseURL: parsed.baseURL || existing?.baseURL,
      model: parsed.model || existing?.model || '',
      ...(parsed.apiKey ? { apiKey: parsed.apiKey } : {}),
      extra: { ...(existing?.extra ?? {}), ...parsed.extra },
    });
  } catch (err) { return setupError(res, err); }

  const conn = await resolveConnection(req.pair.id, saved);
  let check = null;
  if (conn.baseURL) {
    const found = await probe({ baseURL: conn.baseURL, apiKey: conn.apiKey, extra: conn.extra });
    if (found.ok) {
      const models = chatModels(found.baseURL, found.models);
      const keeps = conn.model && found.models.includes(conn.model);
      const usable = await tryKey({
        baseURL: found.baseURL, apiKey: conn.apiKey, extra: conn.extra,
        ...(keeps ? { model: conn.model } : { models: models.length ? models : found.models }),
      });
      await saveConnection(req.pair.id, req.userId, { name: saved, baseURL: found.baseURL, model: keeps ? conn.model : (usable.ok ? usable.model : conn.model) });
      check = usable.ok ? { ok: true, model: usable.model, models }
        : { ok: false, models, error: usable.unauthorized ? `The key was refused (${usable.error}). It ${asSent(conn)}.` : usable.error };
    } else {
      check = { ok: false, error: found.unauthorized ? `The key was refused (${found.error}). It ${asSent(conn)}.` : found.error };
    }
  }
  if (req.body?.use !== false) await saveSettings(req.pair.id, req.userId, { source: 'key', connection: saved });
  res.json({
    ok: true,
    name: saved,
    found: {
      baseURL: parsed.baseURL,
      model: parsed.model,
      // Never the key: how much of one arrived, which says whether the paste was whole.
      key: parsed.apiKey ? `${parsed.apiKey.length} characters ending "${parsed.apiKey.slice(-4)}"` : null,
      api: parsed.extra.api || 'chat',
    },
    check,
    connections: await listConnections(req.pair.id),
  });
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
      const got = await askWithFallback(pairId, config, {
        system: systemPrompt(settings, [names[req.userId], names[req.partnerId]]),
        user: transcript(labelled, settings, latestAuthor),
      });
      if (got.fallback) console.log(`[fable] ${got.fallback.from} could not answer (${got.fallback.why}); ${got.fallback.to} did`);
      const text = cleanReply(got.text, settings.botName);
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
