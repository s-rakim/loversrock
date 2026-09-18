# Home & lock screen widgets

## What exists on each platform

| | Home screen | Lock screen |
|---|---|---|
| **iOS 16+** | ✅ WidgetKit (`systemSmall`, `systemMedium`) | ✅ WidgetKit accessory families (`accessoryCircular`, `accessoryRectangular`, `accessoryInline`) |
| **Android** | ✅ `AppWidgetProvider` (summary + photo) | ⚠️ Not possible — see below |

### Why Android has no lock screen widget

Google removed lock screen widgets in **Android 5.0 (2014)** and never brought
them back for phones; Android 15/16 reintroduced them for **tablets only**.
There is no API to target on an Android phone.

The substitute is an ongoing, silent, `IMPORTANCE_LOW` notification
(`LockScreenNotifier.kt`) with `VISIBILITY_PUBLIC`, so the streak, countdown
and distance render on the lock screen without making a sound or a heads-up
banner. It's toggled from Settings → Widgets.

## Architecture

Widgets run in a **separate OS process** from the React Native app, on a
30-minute refresh floor, with a few hundred milliseconds of execution time.
That forces three design choices:

1. **A dedicated credential.** A widget can't hold a 15-minute access token or
   perform the refresh-token dance. `POST /widget/token` issues a long-lived,
   **read-only**, individually revocable token. It works on `GET
   /widget/summary` and `GET /widget/photo` and nothing else — it cannot read
   messages, memories, or raw period logs (there are tests asserting exactly
   that). Only its SHA-256 hash is stored. Revoking it does not log the phone
   out.
2. **One round trip.** `GET /widget/summary` returns everything any widget
   renders — streak, prompt state, soonest countdown, distance apart, latest
   photo presence, partner cycle phase — so no widget ever chains calls.
3. **Cache-first rendering.** Both platforms paint the last good payload
   immediately, then refresh in the background. A widget with no network shows
   stale data rather than a blank box.

Credentials reach the widget process via **SharedPreferences** (Android) and an
**App Group** container (iOS), written by the native bridge in
`services/widgetBridge.js`. The account's access/refresh tokens are never
shared — only the scoped widget token.

The partner's cycle phase obeys the same privacy boundary as the rest of the
app (`docs/SPEC.md` #5): phase and predicted date only, never flow, symptoms,
mood or notes.

## Building

Widgets are native code, so **they cannot run in Expo Go.** You need a
dev-client or production build:

```bash
cd mobile
npm install

# Generates android/ and ios/ and runs the widget config plugins
npx expo prebuild --clean

# Android (needs Android SDK)
npx expo run:android

# iOS (needs macOS + Xcode)
npx expo run:ios
```

Or via EAS, which needs no local toolchain:

```bash
eas build --profile development --platform android
eas build --profile development --platform ios
```

The config plugins (`mobile/plugins/`) do the wiring at prebuild time:
- `withAndroidWidgets.js` — copies the Kotlin sources and `res/`, registers
  both `AppWidgetProvider` receivers and `POST_NOTIFICATIONS`, and adds
  `WidgetBridgePackage` to `MainApplication`.
- `withIosWidgets.js` — copies the Swift sources, writes the extension's
  `Info.plist`/entitlements, adds the App Group to the main app, and creates
  the `LoversRockWidgets` app-extension target in the Xcode project.

## Installing on the device

- **Android:** long-press the home screen → Widgets → loversrock → drag out
  "At a glance" or "Partner photo". For the lock screen glance, enable it in
  Settings → Widgets (and allow notifications on Android 13+).
- **iOS home screen:** long-press → `+` → search loversrock.
- **iOS lock screen:** lock the phone → long-press → Customise → Lock Screen →
  tap a widget slot → choose loversrock.

Widgets populate after you log in — login calls `provisionWidgets()`, which
issues the token and hands it to the native side. Logging out clears it.

## Verified vs. unverified

The **data layer is tested** — `backend/test/widget.mjs` covers token issuing,
the security boundary, the privacy boundary, summary correctness, the photo
endpoint and revocation against a live stack.

The **native code is not compiled or run.** It was written without access to
Xcode or the Android SDK. Expect to need a real build to shake out:

- The iOS Xcode target creation in `withIosWidgets.js` is the most fragile
  part — programmatic `.pbxproj` manipulation often needs a manual nudge in
  Xcode (check the extension's target membership and signing).
- Widget layout/sizing on real devices.
- `MainApplication` patching in `withAndroidWidgets.js` depends on Expo's
  generated file shape; if the regex misses, add `WidgetBridgePackage()`
  manually.
- RemoteViews bitmaps cross a Binder transaction with a ~1MB limit; the photo
  widget downsamples (`inSampleSize = 2`), which may need tuning for very
  large photos.
