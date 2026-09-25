import { query } from '../config/db.js';
import { sendNotification } from '../config/firebase.js';
import { getUserDeviceTokens } from './pairs.js';

// Every push category the user can switch off in Settings → Notifications.
export const NOTIFICATION_CATEGORIES = [
  'messages',
  'mood',
  'feed',
  'notes',
  'secret',
  'dates',
  'checkins',
  'sparks',
  'achievements',
  'canvas',
  'thumbkiss',
  'games',
  'snaps',
];

/**
 * Pushes to one user unless they switched that category off. Never throws:
 * a push failure must not fail the request that triggered it.
 */
export async function notifyUser(userId, category, { title, body }, data = {}) {
  try {
    const { rows } = await query('SELECT notification_prefs FROM users WHERE id = $1', [userId]);
    const prefs = rows[0]?.notification_prefs || {};
    if (prefs[category] === false) return;

    const tokens = await getUserDeviceTokens(userId);
    if (tokens.length === 0) return;

    // FCM data values must be strings.
    const stringData = Object.fromEntries(Object.entries({ category, ...data }).map(([k, v]) => [k, String(v)]));
    await sendNotification(tokens, { title, body }, stringData);
  } catch (err) {
    console.error(`[notify] ${category} push failed:`, err.message);
  }
}

export async function userName(userId) {
  const { rows } = await query('SELECT name FROM users WHERE id = $1', [userId]);
  return rows[0]?.name || 'Your partner';
}
