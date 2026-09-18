import { query } from '../config/db.js';

export async function getActivePairForUser(userId) {
  const { rows } = await query(
    `SELECT * FROM pairs
     WHERE (user_a_id = $1 OR user_b_id = $1) AND unlinked_at IS NULL AND user_b_id IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

export async function getPairById(pairId) {
  const { rows } = await query('SELECT * FROM pairs WHERE id = $1', [pairId]);
  return rows[0] || null;
}

export function otherUserId(pair, userId) {
  return pair.user_a_id === userId ? pair.user_b_id : pair.user_a_id;
}

// "Today" for a pair is always computed in the pair's pinned timezone, not
// either device's local timezone — see docs/SPEC.md #2.
export function pairLocalDateString(pair, at = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: pair.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(at); // en-CA formats as YYYY-MM-DD
}

export async function getUserDeviceTokens(userId) {
  const { rows } = await query('SELECT fcm_token FROM user_devices WHERE user_id = $1', [userId]);
  return rows.map((r) => r.fcm_token);
}
