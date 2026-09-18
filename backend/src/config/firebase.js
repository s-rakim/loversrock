import admin from 'firebase-admin';

let app = null;

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

export async function sendToTokens(tokens, { notification, data } = {}) {
  const firebaseApp = getApp();
  if (!firebaseApp || tokens.length === 0) return { successCount: 0, failureCount: 0 };

  const message = {
    tokens,
    ...(notification ? { notification } : {}),
    ...(data ? { data } : {}),
  };

  return admin.messaging(firebaseApp).sendEachForMulticast(message);
}

// Data-only message: no `notification` block, so Android delivers it to the
// app's background handler instead of auto-drawing a tray notification —
// used by widget-photo delivery so a future widget/background receiver can
// wake and refresh even if the app isn't foregrounded.
export async function sendDataMessage(tokens, data) {
  return sendToTokens(tokens, { data });
}

export async function sendNotification(tokens, notification, data) {
  return sendToTokens(tokens, { notification, data });
}
