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
import crypto from 'node:crypto';
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
 * STUN alone only tells a phone its own public address. That is enough when
 * a direct path between the two devices exists - same Wi-Fi, or across a
 * tailnet. When it does not, and carrier-grade NAT on mobile data is the
 * common way it does not, there is no path to find: the call rings, both
 * ends negotiate, ICE runs out of candidate pairs, and the screen sits on
 * "connecting" until it gives up. Nothing either phone can do fixes that.
 * Only a relay both of them can reach does, which is what coturn is for
 * (docker/docker-compose.yml, docker/turnserver.conf).
 *
 * The credentials are minted here, per request, and expire.
 *
 * coturn's `use-auth-secret` mode does not know about users: the username is
 * an expiry timestamp and the password is its HMAC under a secret only the
 * server and coturn share. So these are good for a few hours and cannot be
 * lifted out of an APK and used for a month, which a static TURN password
 * absolutely can.
 */
const TURN_CREDENTIAL_TTL_SECONDS = 6 * 60 * 60;

export function turnCredentials(secret, userId, now = Date.now()) {
  const expiry = Math.floor(now / 1000) + TURN_CREDENTIAL_TTL_SECONDS;
  // coturn parses everything up to the first colon as the expiry, and treats
  // the rest as an opaque label. Carrying the user id makes a relay session
  // traceable to an account without coturn needing an account database.
  const username = `${expiry}:${userId}`;
  const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential, expiresAt: new Date(expiry * 1000).toISOString() };
}

/** Where the phones should look for the relay. */
function turnUrls() {
  if (process.env.TURN_URL) return [process.env.TURN_URL];
  if (!process.env.TURN_PUBLIC_IP) return [];
  const host = process.env.TURN_PUBLIC_IP;
  const port = process.env.TURN_PORT || 3478;
  // UDP first because it is what media wants; the TCP entry is the fallback
  // for networks that block UDP outright, which some do.
  return [`turn:${host}:${port}?transport=udp`, `turn:${host}:${port}?transport=tcp`];
}

router.get('/config', async (req, res) => {
  const iceServers = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ];

  const urls = turnUrls();
  const secret = process.env.TURN_SECRET;
  let expiresAt = null;

  if (urls.length && secret) {
    const { username, credential, expiresAt: expiry } = turnCredentials(secret, req.userId);
    iceServers.push({ urls, username, credential });
    expiresAt = expiry;
  } else if (urls.length && process.env.TURN_USERNAME) {
    // A relay someone else runs, with credentials they issued.
    iceServers.push({
      urls,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_PASSWORD,
    });
  }

  res.json({
    iceServers,
    hasTurn: iceServers.length > 1,
    turnExpiresAt: expiresAt,
  });
});

/**
 * How long a call may sit unanswered before it stops counting as live.
 *
 * Without this, a call that never got a clean ending blocks every future one
 * forever, and there are two easy ways to leave one behind: kill the app
 * while it is ringing, or lose the network before POST /:id/end lands. The
 * row stays 'ringing', the partial unique index keeps refusing a second live
 * call, and every subsequent tap on Call answers 409 "A call is already in
 * progress" — for a call that ended days ago and nobody is on.
 *
 * Two minutes is past any real ring-out (the client gives up at 45 seconds)
 * and short enough that a stuck row heals itself before anyone notices.
 */
const RING_TIMEOUT_SECONDS = 120;

/**
 * Retires calls that are plainly over.
 *
 * Run before anything reads the live call, so the answer is never a ghost:
 * a ringing call older than the timeout was missed, and a 'connected' one
 * with no end after twelve hours is a row whose hangup never arrived, not a
 * call anybody is still on.
 */
async function expireStaleCalls(pairId) {
  const { rows } = await query(
    `UPDATE call_sessions
        SET status = CASE WHEN answered_at IS NULL THEN 'missed' ELSE 'ended' END,
            ended_at = COALESCE(ended_at, now()),
            end_reason = COALESCE(end_reason, 'expired')
      WHERE pair_id = $1
        AND status IN ('ringing', 'connected')
        AND (
          (status = 'ringing' AND started_at < now() - ($2 || ' seconds')::interval)
          OR (status = 'connected' AND started_at < now() - interval '12 hours')
        )
      RETURNING id`,
    [pairId, RING_TIMEOUT_SECONDS]
  );
  return rows.length;
}

/** The live call for this pair, if there is one. */
async function liveCall(pairId) {
  await expireStaleCalls(pairId);
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
      // The partial unique index fired. That is either a genuine race — both
      // phones tapping Call in the same instant — or a stale row that slipped
      // in between the sweep above and this insert. liveCall sweeps again, so
      // a ghost is retired and the insert retried rather than reported as a
      // call in progress.
      const raced = await liveCall(req.pair.id);
      if (!raced) {
        const { rows } = await query(
          `INSERT INTO call_sessions (pair_id, caller_id, callee_id, kind)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [req.pair.id, req.userId, req.partnerId, kind]
        );
        call = rows[0];
      } else {
        return res.status(409).json({ error: 'A call is already in progress', call: view(raced, req.userId) });
      }
    } else {
      throw err;
    }
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
