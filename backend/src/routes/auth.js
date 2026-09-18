import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import { getActivePairForUser } from '../models/pairs.js';

const router = Router();

function issueTokens(userId) {
  const accessToken = jwt.sign({ sub: userId }, process.env.JWT_ACCESS_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  });
  const refreshToken = jwt.sign({ sub: userId, type: 'refresh' }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  });
  return { accessToken, refreshToken };
}

router.post('/signup', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email, password are required' });
  }

  const existing = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const { rows } = await query(
    `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3)
     RETURNING id, name, email, avatar_url, created_at`,
    [name, email.toLowerCase(), passwordHash]
  );

  const user = rows[0];
  const tokens = issueTokens(user.id);
  res.status(201).json({ user, ...tokens });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  const { rows } = await query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  const user = rows[0];
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const tokens = issueTokens(user.id);
  res.json({
    user: { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatar_url },
    ...tokens,
  });
});

// Rotates both access and refresh tokens on every use.
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'refreshToken is required' });

  try {
    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    if (payload.type !== 'refresh') throw new Error('wrong token type');
    const tokens = issueTokens(payload.sub);
    res.json(tokens);
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
});

router.post('/fcm-token', requireAuth, async (req, res) => {
  const { fcmToken, platform } = req.body;
  if (!fcmToken) return res.status(400).json({ error: 'fcmToken is required' });

  await query(
    `INSERT INTO user_devices (user_id, fcm_token, platform, last_seen_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id, fcm_token) DO UPDATE SET last_seen_at = now(), platform = EXCLUDED.platform`,
    [req.userId, fcmToken, platform || 'android']
  );

  res.status(204).end();
});

function generateInviteCode() {
  return randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
}

// Pins the pair's timezone to the inviter's device timezone — see
// docs/SPEC.md #2. deviceTimezone must be an IANA name (e.g. "America/Denver").
router.post('/invite', requireAuth, async (req, res) => {
  const { deviceTimezone } = req.body;
  if (!deviceTimezone) return res.status(400).json({ error: 'deviceTimezone is required' });

  const existingPair = await getActivePairForUser(req.userId);
  if (existingPair) return res.status(409).json({ error: 'Already paired — unlink first' });

  const inviteCode = generateInviteCode();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const { rows } = await query(
    `INSERT INTO pairs (user_a_id, timezone, invite_code, invite_expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING id, invite_code, invite_expires_at`,
    [req.userId, deviceTimezone, inviteCode, expiresAt]
  );

  res.status(201).json({
    inviteCode: rows[0].invite_code,
    expiresAt: rows[0].invite_expires_at,
  });
});

router.post('/invite/accept', requireAuth, async (req, res) => {
  const { inviteCode } = req.body;
  if (!inviteCode) return res.status(400).json({ error: 'inviteCode is required' });

  const existingPair = await getActivePairForUser(req.userId);
  if (existingPair) return res.status(409).json({ error: 'Already paired — unlink first' });

  const { rows } = await query(
    `SELECT * FROM pairs WHERE invite_code = $1 AND user_b_id IS NULL AND invite_expires_at > now()`,
    [inviteCode.toUpperCase()]
  );
  const pair = rows[0];
  if (!pair) return res.status(404).json({ error: 'Invite code invalid or expired' });
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
router.post('/unlink', requireAuth, requirePair, async (req, res) => {
  await query('UPDATE pairs SET unlinked_at = now() WHERE id = $1', [req.pair.id]);
  await query('UPDATE users SET partner_id = NULL WHERE id IN ($1, $2)', [req.userId, req.partnerId]);
  res.status(204).end();
});

export default router;
