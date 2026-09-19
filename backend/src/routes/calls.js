// Call setup and history.
//
// Media never reaches this server. WebRTC connects the two phones directly
// and the audio and video travel peer to peer; what lives here is the
// bookkeeping - who rang whom, whether it was answered, how long it lasted -
// and the ICE configuration the phones need to find each other.
//
// The signalling itself (offer, answer, candidates) goes over the socket,
// in sockets/index.js. It is deliberately not REST: those messages are
// latency-critical and worthless a second late, and they are relayed
// without being stored.
import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import { sendNotification, deepLink, CHANNELS } from '../config/firebase.js';
import { getUserDeviceTokens } from '../models/pairs.js';

const router = asyncRouter();

router.use(requireAuth, requirePair);

/**
 * The ICE servers the phone should use.
 *
 * Google's public STUN is enough whenever the two devices can reach each
 * other - which, for a couple on the same Tailscale tailnet, is the normal
 * case. A TURN server relays the media when they cannot (symmetric NAT on
 * both ends, some mobile carriers), and is configured only if the operator
 * has one: TURN_URL / TURN_USERNAME / TURN_PASSWORD. Without it, calls still
 * work in the common case and fail honestly in the uncommon one, which is
 * better than pretending to be configured.
 */
router.get('/config', async (req, res) => {
  const iceServers = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ];
  if (process.env.TURN_URL) {
    iceServers.push({
      urls: process.env.TURN_URL,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_PASSWORD,
    });
  }
  res.json({ iceServers, hasTurn: Boolean(process.env.TURN_URL) });
});

/** The live call for this pair, if there is one. */
async function liveCall(pairId) {
  const { rows } = await query(
    `SELECT * FROM call_sessions WHERE pair_id = $1 AND status IN ('ringing','connected')
     ORDER BY started_at DESC LIMIT 1`,
    [pairId]
  );
  return rows[0] || null;
}

const view = (call, userId) => call && {
  id: call.id,
  kind: call.kind,
  status: call.status,
  // Which end you are, so the client knows whether to show "calling…" or
  // an incoming-call screen without comparing ids itself.
  role: call.caller_id === userId ? 'caller' : 'callee',
  startedAt: call.started_at,
  answeredAt: call.answered_at,
  endedAt: call.ended_at,
  endReason: call.end_reason,
  durationSeconds: call.answered_at && call.ended_at
    ? Math.round((new Date(call.ended_at) - new Date(call.answered_at)) / 1000)
    : null,
};

router.get('/current', async (req, res) => {
  res.json({ call: view(await liveCall(req.pair.id), req.userId) });
});

/**
 * Ring your partner.
 *
 * The row is created before any signalling so a missed call is still a
 * recorded call - the phone that rang can go flat, and the history should
 * still say somebody tried.
 */
router.post('/start', async (req, res) => {
  const kind = req.body?.kind === 'video' ? 'video' : 'voice';

  const existing = await liveCall(req.pair.id);
  if (existing) {
    // Both tapping call at the same instant is a real race between two
    // phones, not a bug. Whoever lost simply joins the call that exists.
    return res.status(409).json({ error: 'A call is already in progress', call: view(existing, req.userId) });
  }

  let call;
  try {
    const { rows } = await query(
      `INSERT INTO call_sessions (pair_id, caller_id, callee_id, kind)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.pair.id, req.userId, req.partnerId, kind]
    );
    call = rows[0];
  } catch (err) {
    if (err.code === '23505') {
      const raced = await liveCall(req.pair.id);
      return res.status(409).json({ error: 'A call is already in progress', call: view(raced, req.userId) });
    }
    throw err;
  }

  // A socket only reaches a phone with the app open. The push is what makes
  // a phone in a pocket ring, so both go out and the client ignores whichever
  // arrives second. CHANNELS.calls is the one channel at MAX importance, so
  // it can interrupt in a way a water reminder never should.
  //
  // A failed push must never fail the call: the socket may well have got
  // through, and the caller's phone should ring out rather than error.
  const tokens = await getUserDeviceTokens(req.partnerId);
  await sendNotification(
    tokens,
    {
      title: kind === 'video' ? 'Incoming video call' : 'Incoming call',
      body: 'Your partner is calling',
    },
    deepLink('call', { callId: call.id, kind }),
    { channel: CHANNELS.calls, priority: 'high' }
  ).catch((err) => console.error('[calls] push failed:', err.message));

  res.status(201).json({ call: view(call, req.userId) });
});

/** Picked up. */
router.post('/:id/answer', async (req, res) => {
  const { rows } = await query(
    `UPDATE call_sessions SET status = 'connected', answered_at = now()
     WHERE id = $1 AND pair_id = $2 AND callee_id = $3 AND status = 'ringing'
     RETURNING *`,
    [req.params.id, req.pair.id, req.userId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'No ringing call to answer' });
  res.json({ call: view(rows[0], req.userId) });
});

/**
 * Hung up, declined, or never picked up - one endpoint, because the client
 * cannot always tell which it was and the server can: a call that ends
 * without having been answered is missed if the caller gave up, declined if
 * the callee did.
 */
router.post('/:id/end', async (req, res) => {
  const reason = String(req.body?.reason || 'hangup').slice(0, 40);

  const { rows: found } = await query(
    `SELECT * FROM call_sessions WHERE id = $1 AND pair_id = $2`,
    [req.params.id, req.pair.id]
  );
  const call = found[0];
  if (!call) return res.status(404).json({ error: 'No such call' });
  if (call.caller_id !== req.userId && call.callee_id !== req.userId) {
    return res.status(403).json({ error: 'Not your call' });
  }
  if (call.status === 'ended' || call.status === 'missed' || call.status === 'declined') {
    return res.json({ call: view(call, req.userId) });
  }

  const status = call.answered_at
    ? 'ended'
    : req.userId === call.callee_id ? 'declined' : 'missed';

  const { rows } = await query(
    `UPDATE call_sessions SET status = $1, ended_at = now(), end_reason = $2
     WHERE id = $3 RETURNING *`,
    [status, reason, call.id]
  );
  res.json({ call: view(rows[0], req.userId) });
});

/** Call history, newest first. */
router.get('/history', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const { rows } = await query(
    `SELECT * FROM call_sessions WHERE pair_id = $1 ORDER BY started_at DESC LIMIT $2`,
    [req.pair.id, limit]
  );
  res.json({ calls: rows.map((c) => view(c, req.userId)) });
});

export default router;
