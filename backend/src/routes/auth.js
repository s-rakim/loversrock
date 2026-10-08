import { asyncRouter } from '../lib/asyncRouter.js';
import bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import { getActivePairForUser, getUserDeviceTokens } from '../models/pairs.js';
import { pushStatus, sendNotification, CHANNELS } from '../config/firebase.js';
import { issueTokens, rotate, endSession, endAllSessions, SessionError } from '../models/sessions.js';
import { Limiter, clientIp, ipScale, perIp, tooMany } from '../middleware/rateLimit.js';

const router = asyncRouter();

export const MIN_PASSWORD = 8;
// Compared against when there is no such account, so that a wrong email and
// a wrong password take equally long.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);
const passwordProblem = (pw) => (String(pw ?? '').length < MIN_PASSWORD
  ? `Use a password of at least ${MIN_PASSWORD} characters.` : null);

const device = (req) => req.headers['user-agent'] || null;

// ------------------------------------------------------------ guessing limits
// Wrong passwords: 8 per account per 15 minutes, 30 per address.
const loginByAccount = new Limiter({ windowMs: 15 * 60_000, max: 8 });
const loginByIp = new Limiter({ windowMs: 15 * 60_000, max: 30 });
// Wrong invite codes: 10 per account per 15 minutes, 30 per address.
const inviteByAccount = new Limiter({ windowMs: 15 * 60_000, max: 10 });
const inviteByIp = new Limiter({ windowMs: 15 * 60_000, max: 30 });

/**
 * Who may make an account (SIGNUPS in backend/.env):
 *   auto    anyone until a couple is paired on this server, then nobody
 *   open    anyone who can reach it
 *   closed  nobody
 */
async function signupsClosed() {
  const mode = String(process.env.SIGNUPS || 'auto').toLowerCase();
  if (mode === 'open') return null;
  if (mode === 'closed') return 'New accounts are switched off on this server (SIGNUPS=closed in backend/.env).';
  const { rows } = await query('SELECT 1 FROM pairs WHERE user_b_id IS NOT NULL AND unlinked_at IS NULL LIMIT 1');
  return rows.length
    ? 'New accounts are closed: the two of you are already paired on this server. Sign in instead. (To allow one, set SIGNUPS=open in backend/.env.)'
    : null;
}

/**
 * Which side of the cycle tracker an account is on.
 *
 *   owner    tracks their own cycle and edits all of it
 *   partner  sees what the owner chose to share, and only that
 *
 * Picked at sign-up, because nothing else in an account says which somebody
 * is, and guessing wrong is not a cosmetic mistake in either direction: it
 * either hands the person tracking a screen they cannot write to, or points
 * someone else's health data at the wrong account. Null when not yet chosen,
 * which is how accounts made before this existed get asked rather than
 * assumed into a role.
 */
const CYCLE_ROLES = ['owner', 'partner'];

router.post('/signup', perIp({ windowMs: 60 * 60_000, max: 10, what: 'new accounts from here' }), async (req, res) => {
  const { name, email, password, cycleRole } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email, password are required' });
  }
  const closed = await signupsClosed();
  if (closed) return res.status(403).json({ error: closed, signupsClosed: true });
  const weak = passwordProblem(password);
  if (weak) return res.status(400).json({ error: weak });
  if (cycleRole !== undefined && cycleRole !== null && !CYCLE_ROLES.includes(cycleRole)) {
    return res.status(400).json({ error: `cycleRole must be one of ${CYCLE_ROLES.join(', ')}` });
  }

  const existing = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const { rows } = await query(
    `INSERT INTO users (name, email, password_hash, cycle_role) VALUES ($1, $2, $3, $4)
     RETURNING id, name, email, avatar_url, cycle_role, created_at`,
    [name, email.toLowerCase(), passwordHash, cycleRole ?? null]
  );

  const user = rows[0];
  const tokens = await issueTokens(user.id, { device: device(req) });
  // camelCase out, like every other endpoint: the app should never have to
  // know the column is called cycle_role.
  const { cycle_role: role, ...rest } = user;
  res.status(201).json({ user: { ...rest, cycleRole: role || null }, ...tokens });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  const account = String(email).toLowerCase();
  const ip = clientIp(req);
  loginByIp.max = 30 * ipScale();
  const wait = Math.max(loginByAccount.blockedFor(account), loginByIp.blockedFor(ip));
  if (wait) return tooMany(res, wait, 'wrong passwords');

  const { rows } = await query('SELECT * FROM users WHERE email = $1', [account]);
  const user = rows[0];
  // The same work and the same answer whether or not the account exists.
  const valid = await bcrypt.compare(String(password), user?.password_hash || DUMMY_HASH);
  if (!user || !valid) {
    loginByAccount.hit(account);
    loginByIp.hit(ip);
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  loginByAccount.reset(account);

  const tokens = await issueTokens(user.id, { device: device(req) });
  res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatar_url,
      // So the app knows on the first screen after sign-in whether it still
      // has to ask, rather than after a round trip to /profile.
      cycleRole: user.cycle_role || null,
    },
    ...tokens,
  });
});

// Rotates both access and refresh tokens on every use; the old refresh token
// stops working a minute later (models/sessions.js).
router.post('/refresh', perIp({ windowMs: 60_000, max: 120, what: 'sign-in renewals' }), async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'refreshToken is required' });

  try {
    res.json(await rotate(refreshToken, { device: device(req) }));
  } catch (err) {
    if (err instanceof SessionError) return res.status(401).json({ error: err.message });
    throw err;
  }
});

// Logging out ends this sign-in on the server too, not only on the phone.
router.post('/logout', async (req, res) => {
  if (req.body?.refreshToken) await endSession(String(req.body.refreshToken));
  res.status(204).end();
});

/** Ends every other sign-in of yours; this phone gets fresh tokens. */
router.post('/logout-others', requireAuth, async (req, res) => {
  await endAllSessions(req.userId);
  req.app.get('io')?.in(`user:${req.userId}`).disconnectSockets(true);
  res.json(await issueTokens(req.userId, { device: device(req) }));
});

/**
 * Changing your password ends every sign-in, everywhere, including any
 * someone else might hold; this phone gets fresh tokens.
 */
router.post('/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  const wait = loginByAccount.blockedFor(`pw:${req.userId}`);
  if (wait) return tooMany(res, wait, 'wrong passwords');
  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.userId]);
  if (!rows[0] || !(await bcrypt.compare(String(currentPassword), rows[0].password_hash))) {
    loginByAccount.hit(`pw:${req.userId}`);
    return res.status(401).json({ error: 'Your current password is not right.' });
  }
  const weak = passwordProblem(newPassword);
  if (weak) return res.status(400).json({ error: weak });
  await query('UPDATE users SET password_hash = $2 WHERE id = $1', [req.userId, await bcrypt.hash(String(newPassword), 12)]);
  await endAllSessions(req.userId);
  req.app.get('io')?.in(`user:${req.userId}`).disconnectSockets(true);
  res.json(await issueTokens(req.userId, { device: device(req) }));
});

router.post('/fcm-token', requireAuth, async (req, res) => {
  const { fcmToken, platform, ringer } = req.body;
  if (!fcmToken) return res.status(400).json({ error: 'fcmToken is required' });

  await query(
    `INSERT INTO user_devices (user_id, fcm_token, platform, can_ring, last_seen_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (user_id, fcm_token) DO UPDATE
       SET last_seen_at = now(), platform = EXCLUDED.platform, can_ring = EXCLUDED.can_ring`,
    [req.userId, fcmToken, platform || 'android', ringer === true]
  );

  res.status(204).end();
});

/**
 * Settings > Notifications > "Send a test". Push has two halves, the phone's
 * token and the server's Firebase key, and either one missing looks exactly
 * the same from the outside: nothing arrives. This says which.
 */
router.post('/push-test', requireAuth, async (req, res) => {
  const server = pushStatus();
  const tokens = await getUserDeviceTokens(req.userId);
  const out = { serverConfigured: server.configured, serverReason: server.reason, devices: tokens.length, sent: 0, failed: 0, error: null };
  if (!server.configured || tokens.length === 0) return res.json(out);

  try {
    const result = await sendNotification(
      tokens,
      { title: 'Test notification', body: 'Notifications are working.' },
      { type: 'test' },
      { channel: CHANNELS.partner, priority: 'high' }
    );
    out.sent = result.successCount || 0;
    out.failed = result.failureCount || 0;
    const firstError = result.responses?.find((r) => !r.success)?.error;
    if (firstError) out.error = firstError.code || firstError.message;
  } catch (err) {
    out.error = err.message;
  }
  res.json(out);
});

// Ten characters from 31 that cannot be misread (no 0/O, 1/I/L): about
// 10^15 codes, where six hex characters gave 16 million. Shown as XXXXX-XXXXX;
// typed with or without the dash, spaces or lower case.
const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const INVITE_LENGTH = 10;
const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

function generateInviteCode() {
  let code = '';
  for (let i = 0; i < INVITE_LENGTH; i++) code += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)];
  return code;
}

export const normalizeInviteCode = (raw) => String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const showInviteCode = (code) => (code && code.length === INVITE_LENGTH ? `${code.slice(0, 5)}-${code.slice(5)}` : code);

// Pins the pair's timezone to the inviter's device timezone — see
// docs/SPEC.md #2. deviceTimezone must be an IANA name (e.g. "America/Denver").
router.post('/invite', requireAuth, async (req, res) => {
  const { deviceTimezone } = req.body;
  if (!deviceTimezone) return res.status(400).json({ error: 'deviceTimezone is required' });

  const existingPair = await getActivePairForUser(req.userId);
  if (existingPair) return res.status(409).json({ error: 'Already paired — unlink first' });

  const inviteCode = generateInviteCode();
  // A day: long enough to send it, short enough that it is not lying around.
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  const { rows } = await query(
    `INSERT INTO pairs (user_a_id, timezone, invite_code, invite_expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING id, invite_code, invite_expires_at`,
    [req.userId, deviceTimezone, inviteCode, expiresAt]
  );

  res.status(201).json({
    inviteCode: showInviteCode(rows[0].invite_code),
    expiresAt: rows[0].invite_expires_at,
  });
});

router.post('/invite/accept', requireAuth, async (req, res) => {
  const { inviteCode } = req.body;
  if (!inviteCode) return res.status(400).json({ error: 'inviteCode is required' });

  const ip = clientIp(req);
  inviteByIp.max = 30 * ipScale();
  const wait = Math.max(inviteByAccount.blockedFor(req.userId), inviteByIp.blockedFor(ip));
  if (wait) return tooMany(res, wait, 'wrong invite codes');

  const existingPair = await getActivePairForUser(req.userId);
  if (existingPair) return res.status(409).json({ error: 'Already paired — unlink first' });

  const { rows } = await query(
    `SELECT * FROM pairs WHERE invite_code = $1 AND user_b_id IS NULL AND invite_expires_at > now()`,
    [normalizeInviteCode(inviteCode)]
  );
  const pair = rows[0];
  if (!pair) {
    inviteByAccount.hit(req.userId);
    inviteByIp.hit(ip);
    return res.status(404).json({ error: 'Invite code invalid or expired' });
  }
  if (pair.user_a_id === req.userId) return res.status(400).json({ error: 'Cannot accept your own invite' });

  const { rows: updated } = await query(
    `UPDATE pairs SET user_b_id = $1, invite_code = NULL, invite_expires_at = NULL
     WHERE id = $2 RETURNING *`,
    [req.userId, pair.id]
  );

  await query('UPDATE users SET partner_id = $1 WHERE id = $2', [req.userId, pair.user_a_id]);
  await query('UPDATE users SET partner_id = $1 WHERE id = $2', [pair.user_a_id, req.userId]);

  res.status(200).json({ pair: updated[0] });
});

// Clears partner_id on both users but never deletes or reassigns historical
// rows tied to the old pair_id — see docs/SPEC.md #3. Re-pairing always
// creates a brand-new pairs row.
//
// Both phones' live connections are dropped at once: they joined the pair's
// room, and would otherwise keep receiving its messages and locations until
// they next reconnected (when the handshake, finding no pair, refuses them).
router.post('/unlink', requireAuth, requirePair, async (req, res) => {
  await query('UPDATE pairs SET unlinked_at = now() WHERE id = $1', [req.pair.id]);
  await query('UPDATE users SET partner_id = NULL WHERE id IN ($1, $2)', [req.userId, req.partnerId]);
  const io = req.app.get('io');
  if (io) {
    io.to(`pair:${req.pair.id}`).emit('pair:unlinked', {});
    io.in(`pair:${req.pair.id}`).disconnectSockets(true);
  }
  res.status(204).end();
});

export default router;
