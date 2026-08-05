# Android Live Photo Widget — build notes

This is deliberately NOT scaffolded in `mobile/` yet, because it requires ejecting
from Expo Go to a dev client (`npx expo prebuild`) and writing native Kotlin —
do this last, after everything else in the MVP build order is working.

## Steps when you get here
1. `npx expo prebuild --platform android` to generate the `android/` folder.
2. Add a Kotlin `AppWidgetProvider` (not Jetpack Glance — avoids pulling in a
   Compose runtime dependency the rest of the app doesn't use) under
   `android/app/src/main/java/.../CandleWidgetProvider.kt`.
3. Write a small Expo config plugin (`mobile/plugins/withCandleWidget.js`) that
   injects the widget provider `<receiver>` entry into AndroidManifest.xml during
   prebuild, so this survives future `expo prebuild` regenerations.
4. On the backend: `POST /widget-photos` sends an FCM **data message** (see
   `backend/src/config/firebase.js` sendDataMessage) — not a notification message —
   so it can wake the app in background.
5. A `BroadcastReceiver` catches the FCM data message and hands off the image
   download to `WorkManager` — do NOT download inline in the receiver, it will ANR
   if the request takes more than ~5-10 seconds.
6. Cap the local image cache (e.g. last 30 images, LRU eviction) in the app's
   cache directory so the OS can reclaim it under storage pressure.
7. **Design for delivery failure as the default case, not the exception**: several
   Android OEMs (Xiaomi, Oppo, Samsung) kill background FCM delivery unless the
   user manually whitelists the app, and force-stopped apps won't wake at all.
   The widget must always show the last successfully cached photo with a
   "tap to refresh" fallback, and `GET /widget-photos/latest` should be polled
   by a periodic WorkManager job as a pull-based backstop.

Every photo sent this way is also mirrored into the normal Memories/Messages feed
(handled server-side in `widgetPhotos.js`) — the widget is a delivery bonus,
never the only path a photo can reach the partner.
