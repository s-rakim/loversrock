import admin from 'firebase-admin';
import { query } from './db.js';

let app = null;

/**
 * Android channel per notification kind. The channel decides importance, so a
 * call can interrupt while a water reminder cannot. These ids must match
 * CHANNELS in mobile/services/notifications.js — the client creates them, the
 * server only names them.
 */
export const CHANNELS = {
  reminders: 'reminders',
  partner: 'partner',
  games: 'games',
  calls: 'calls',
};

// FCM rejects a token permanently with these. Anything else (a network blip,
// a quota error) is transient and the token is left alone.
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

/**
 * Deletes tokens FCM has told us are dead.
 *
 * Without this, an uninstalled app's token stays in user_devices forever and
 * every future send wastes a slot on it — and the failure counts make a
 * working push path look broken.
 */
async function pruneDeadTokens(tokens, responses) {
  const dead = responses
    .map((response, i) => (!response.success && DEAD_TOKEN_CODES.has(response.error?.code) ? tokens[i] : null))
    .filter(Boolean);

  if (dead.length === 0) return 0;

  await query('DELETE FROM user_devices WHERE fcm_token = ANY($1::text[])', [dead]);
  console.log(`[firebase] pruned ${dead.length} dead device token(s)`);
  return dead.length;
}

// FCM is the app's only cloud dependency, required even for fully local
// deployments (there is no self-hostable equivalent of platform push).
function getApp() {
  if (app) return app;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    console.warn(
      '[firebase] FIREBASE_SERVICE_ACCOUNT_JSON not set — push notifications are disabled.'
    );
    return null;
  }

  const serviceAccount = JSON.parse(raw);
  app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  return app;
}

export async function sendToTokens(tokens, { notification, data, channel, priority, collapseKey } = {}) {
  const firebaseApp = getApp();
  if (!firebaseApp || tokens.length === 0) return { successCount: 0, failureCount: 0, pruned: 0 };

  // Every value in an FCM data payload must be a string, and a number or an
  // object silently fails the whole send rather than that one field.
  const stringData = data
    ? Object.fromEntries(
        Object.entries(data)
          .filter(([, value]) => value !== undefined && value !== null)
          .map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)])
      )
    : undefined;

  const message = {
    tokens,
    ...(notification ? { notification } : {}),
    ...(stringData ? { data: stringData } : {}),
    android: {
      priority: priority || (channel === CHANNELS.calls ? 'high' : 'normal'),
      // Ten messages in a row should be one line in the tray that updates,
      // not ten. On Android that is a collapse key; on iOS the equivalent is
      // apns-collapse-id, which is a different header entirely — so both are
      // set from the one value rather than the caller knowing about either.
      ...(collapseKey ? { collapseKey } : {}),
      ...(channel ? { notification: { channelId: channel } } : {}),
    },
    ...(collapseKey
      ? {
        apns: {
          headers: {
            'apns-collapse-id': collapseKey.slice(0, 64),
            // A collapsed alert still has to wake the phone, or the update
            // silently replaces a notification nobody ever saw.
            'apns-priority': priority === 'high' ? '10' : '5',
          },
        },
      }
      : {}),
  };

  const result = await admin.messaging(firebaseApp).sendEachForMulticast(message);

  let pruned = 0;
  if (result.failureCount > 0 && Array.isArray(result.responses)) {
    pruned = await pruneDeadTokens(tokens, result.responses);
  }

  return { ...result, pruned };
}

// Data-only message: no `notification` block, so Android delivers it to the
// app's background handler instead of auto-drawing a tray notification —
// used by widget-photo delivery so a future widget/background receiver can
// wake and refresh even if the app isn't foregrounded.
export async function sendDataMessage(tokens, data) {
  return sendToTokens(tokens, { data });
}

export async function sendNotification(tokens, notification, data, options = {}) {
  return sendToTokens(tokens, { notification, data, ...options });
}

/**
 * A tap has to land somewhere. `type` drives the screen the client opens
 * (SCREEN_FOR_TYPE in mobile/services/notifications.js); `screen` overrides it
 * outright when a caller needs somewhere specific.
 */
export function deepLink(type, params) {
  return { type, ...(params ? { params: JSON.stringify(params) } : {}) };
}
