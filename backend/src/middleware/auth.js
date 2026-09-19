import jwt from 'jsonwebtoken';
import { query } from '../config/db.js';

// Bearer JWT only — see docs/SPEC.md #1. Never accept auth via cookies.
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    req.userId = payload.sub;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
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
 * Same access token, read from the query string as well as the header.
 *
 * Deliberately scoped to media. An <Image source={{ uri }} /> is fetched by
 * the platform's own image loader — Fresco on Android, NSURLSession on iOS —
 * and neither sends headers the JS never gets to set. A header-only rule
 * therefore does not mean "media is protected", it means every photo in the
 * app renders as an empty grey box, which is exactly what it was doing. The
 * widget endpoints already took their credential this way for the same
 * reason; this brings /media in line.
 *
 * The header is still preferred when it is there, so ordinary API clients
 * keep their tokens out of URLs and access logs.
 */
export async function requireAuthAllowingQuery(req, res, next) {
  const [scheme, headerToken] = (req.headers.authorization || '').split(' ');
  const token = (scheme === 'Bearer' && headerToken) || req.query.token;

  if (!token) return res.status(401).json({ error: 'Missing bearer token' });

  try {
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    req.userId = payload.sub;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
