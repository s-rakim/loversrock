import admin from "firebase-admin";
import dotenv from "dotenv";

dotenv.config();

let initialized = false;

export function initFirebase() {
  if (initialized) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    console.warn(
      "FIREBASE_SERVICE_ACCOUNT_JSON not set — push notifications are disabled. " +
        "Create a free Firebase project and set this env var to enable FCM."
    );
    return;
  }
  const serviceAccount = JSON.parse(raw);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  initialized = true;
}

// Sends a data message (not a notification message) so Android can wake the app
// in background to refresh the widget. See docs/SPEC.md Feature 8 reliability caveats —
// this is NOT guaranteed delivery, callers must design for graceful degradation.
export async function sendDataMessage(fcmTokens, dataPayload) {
  if (!initialized || fcmTokens.length === 0) return;
  const message = {
    tokens: fcmTokens,
    data: dataPayload, // all values must be strings
  };
  return admin.messaging().sendEachForMulticast(message);
}

export async function sendNotification(fcmTokens, title, body, dataPayload = {}) {
  if (!initialized || fcmTokens.length === 0) return;
  const message = {
    tokens: fcmTokens,
    notification: { title, body },
    data: dataPayload,
  };
  return admin.messaging().sendEachForMulticast(message);
}
