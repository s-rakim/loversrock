// Signed-in sessions, recorded so they can be ended.
//
// A refresh token used to be a bare JWT: good for 30 days, renewing itself
// forever, and nothing the server could take back — logging out only forgot
// it on the phone, and changing a password left every other copy working.
// Now each one has a row (refresh_tokens), and:
//
//   - using it replaces it: the old one stops working a minute later (the
//     minute is for two requests that refreshed at the same moment);
//   - logging out ends that one;
//   - changing your password, or "sign out everywhere else", ends all of
//     them and every access token issued before that second
//     (users.sessions_valid_after), and drops the live connections.
//
// Tokens issued before this existed carry no id. They are honoured until they
// expire or a cut-off passes them, and swapped for a recorded one on first use.
//
// Photos get a token of their own (mediaToken): it rides in image URLs, which
// end up in caches, so it opens pictures of your own pair and nothing else.
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { query } from '../config/db.js';
import { purposeKey } from '../config/secrets.js';

export const REFRESH_GRACE_MS = 60_000;
export const MEDIA_TOKEN_TTL = '12h';

export class SessionError extends Error {}

export function mediaToken(userId) {
  return jwt.sign({ sub: userId, typ: 'media' }, purposeKey('media'), { expiresIn: MEDIA_TOKEN_TTL });
}

export function verifyMediaToken(token) {
  const payload = jwt.verify(token, purposeKey('media'));
  if (payload.typ !== 'media') throw new SessionError('not a media token');
  return payload;
}

/** Access, refresh and media tokens for one device, the refresh one recorded. */
export async function issueTokens(userId, { device = null } = {}) {
  const jti = crypto.randomUUID();
  const accessToken = jwt.sign({ sub: userId }, process.env.JWT_ACCESS_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  });
  const refreshToken = jwt.sign({ sub: userId, type: 'refresh', jti }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  });
  const { exp } = jwt.decode(refreshToken);
  await query(
    'INSERT INTO refresh_tokens (id, user_id, expires_at, device) VALUES ($1, $2, to_timestamp($3), $4)',
    [jti, userId, exp, device ? String(device).slice(0, 80) : null]
  );
  // Expired rows are worth nothing; tidy this user's while here.
  query('DELETE FROM refresh_tokens WHERE user_id = $1 AND expires_at < now()', [userId]).catch(() => {});
  return { accessToken, refreshToken, mediaToken: mediaToken(userId) };
}

// ------------------------------------------------------------- the cut-off

const cutoffs = new Map();
const CUTOFF_CACHE_MS = 10_000;

/** The second before which this user's tokens no longer count (0 for none). */
export async function sessionCutoff(userId) {
  const hit = cutoffs.get(userId);
  if (hit && Date.now() - hit.at < CUTOFF_CACHE_MS) return hit.cutoff;
  const { rows } = await query(
    'SELECT floor(extract(epoch FROM sessions_valid_after))::bigint AS cutoff FROM users WHERE id = $1',
    [userId]
  );
  // An account that no longer exists has no valid tokens at all.
  const cutoff = rows.length ? Number(rows[0].cutoff || 0) : Number.MAX_SAFE_INTEGER;
  cutoffs.set(userId, { at: Date.now(), cutoff });
  return cutoff;
}

/** Whether a verified token (access, refresh or media) is still honoured. */
export async function stillValid(payload) {
  return Number(payload.iat || 0) >= await sessionCutoff(payload.sub);
}

/**
 * Ends every session of this user from this second on. The device asking
 * gets fresh tokens straight after (issued in this same second, they count).
 */
export async function endAllSessions(userId) {
  const now = new Date();
  await query('UPDATE users SET sessions_valid_after = $2 WHERE id = $1', [userId, now]);
  await query('UPDATE refresh_tokens SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL', [userId, now]);
  cutoffs.delete(userId);
}

// ------------------------------------------------------------- refreshing

/** A refresh token in, a new set out; SessionError when it no longer counts. */
export async function rotate(refreshToken, { device } = {}) {
  let payload;
  try {
    payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
  } catch {
    throw new SessionError('Invalid or expired refresh token');
  }
  if (payload.type !== 'refresh') throw new SessionError('Invalid or expired refresh token');
  if (!(await stillValid(payload))) throw new SessionError('Signed out: sign in again');

  if (payload.jti) {
    const { rows } = await query('SELECT * FROM refresh_tokens WHERE id = $1 AND user_id = $2', [payload.jti, payload.sub]);
    const row = rows[0];
    if (!row || row.revoked_at) throw new SessionError('Signed out: sign in again');
    if (row.rotated_at && Date.now() - new Date(row.rotated_at).getTime() > REFRESH_GRACE_MS) {
      throw new SessionError('That sign-in was already renewed: sign in again');
    }
    if (!row.rotated_at) await query('UPDATE refresh_tokens SET rotated_at = now() WHERE id = $1', [row.id]);
  }
  return issueTokens(payload.sub, { device });
}

/** Ends the session one refresh token belongs to. Quietly does nothing for a bad one. */
export async function endSession(refreshToken) {
  let payload;
  try {
    payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
  } catch {
    return false;
  }
  if (payload.jti) {
    const { rowCount } = await query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL',
      [payload.jti, payload.sub]
    );
    return rowCount > 0;
  }
  // An unrecorded (older) token cannot be ended alone: end them all.
  await endAllSessions(payload.sub);
  return true;
}
