import jwt from 'jsonwebtoken';
import { query } from '../config/db.js';
import { stillValid, verifyMediaToken } from '../models/sessions.js';

// Bearer JWT only — see docs/SPEC.md #1. Never accept auth via cookies.
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  // Issued before a password change or "sign out everywhere": void.
  if (!(await stillValid(payload))) return res.status(401).json({ error: 'Signed out' });
  req.userId = payload.sub;
  next();
}

// Attaches req.pair for routes that operate on shared pair data. Always
// derives pair_id server-side from the authenticated user — a client can
// never supply its own pair_id (see docs/SPEC.md #3).
export async function requirePair(req, res, next) {
  const { rows } = await query(
    `SELECT * FROM pairs
     WHERE (user_a_id = $1 OR user_b_id = $1) AND unlinked_at IS NULL AND user_b_id IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
    [req.userId]
  );

  if (rows.length === 0) {
    return res.status(403).json({ error: 'Not currently paired' });
  }

  req.pair = rows[0];
  req.partnerId = req.pair.user_a_id === req.userId ? req.pair.user_b_id : req.pair.user_a_id;
  next();
}

/**
 * For /media: the access token in the header, or a media token in the query
 * string.
 *
 * An <Image source={{ uri }} /> is fetched by the platform's own image loader
 * (Fresco on Android, NSURLSession on iOS), which sends no headers the JS can
 * set, so the credential has to ride in the URL. URLs end up in caches and
 * logs, so the one that rides there is a media token (models/sessions.js):
 * it opens pictures of your own pair and nothing else. `?token=` with a full
 * access token is still read, for builds of the app from before media tokens.
 */
export async function requireMediaAuth(req, res, next) {
  const [scheme, headerToken] = (req.headers.authorization || '').split(' ');
  let payload = null;
  try {
    if (scheme === 'Bearer' && headerToken) payload = jwt.verify(headerToken, process.env.JWT_ACCESS_SECRET);
    else if (req.query.mt) payload = verifyMediaToken(String(req.query.mt));
    else if (req.query.token) payload = jwt.verify(String(req.query.token), process.env.JWT_ACCESS_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  if (!payload) return res.status(401).json({ error: 'Missing token' });
  if (!(await stillValid(payload))) return res.status(401).json({ error: 'Signed out' });
  req.userId = payload.sub;
  next();
}

/**
 * Whether this user may read this stored file. Every upload is filed under
 * its pair (memories/<pair>/…, messages/<pair>/…, widget-photos/<pair>/…,
 * voice/<pair>/…) or, for a drawn mascot, its owner (mascots/<user>/…). Only
 * your current pair's files, and your own or your partner's mascots, open:
 * not a stranger's, and not an ex-partner's after unlinking.
 */
export async function mayReadMedia(userId, key) {
  const k = String(key || '');
  if (k.includes('..') || k.startsWith('/')) return false;
  const { rows } = await query(
    `SELECT id, user_a_id, user_b_id FROM pairs
      WHERE (user_a_id = $1 OR user_b_id = $1) AND unlinked_at IS NULL AND user_b_id IS NOT NULL
      ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  const pair = rows[0];
  const byPair = /^(memories|messages|widget-photos|voice)\/([0-9a-f-]{36})\//i.exec(k);
  if (byPair) return Boolean(pair) && byPair[2].toLowerCase() === String(pair.id).toLowerCase();
  const byUser = /^mascots\/([0-9a-f-]{36})\//i.exec(k);
  if (byUser) {
    const owner = byUser[1].toLowerCase();
    if (owner === String(userId).toLowerCase()) return true;
    return Boolean(pair) && [pair.user_a_id, pair.user_b_id].some((id) => String(id).toLowerCase() === owner);
  }
  return false;
}
