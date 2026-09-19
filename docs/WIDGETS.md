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

Widgets are native code, so **they cannot run in Expo Go.** You need a real
build.

### Widgets are off by default

The two widget config plugins inject Kotlin and Swift that has never been
through a compiler, and a failure in either blocks the *entire* APK — the
tested, working parts of the app included. So `app.config.js` filters them out
unless `LOVERSROCK_WIDGETS=1` is set.

```bash
# The normal build: no widgets, no hand-written native code.
eas build --profile preview --platform android

# With widgets, once the native code is known to compile.
eas build --profile preview-widgets --platform android
```

Nothing breaks with them off: `services/widgetBridge.js` degrades to a no-op
when `NativeModules.WidgetBridge` is absent, and Settings says widgets need a
dev-client build. Verified by prebuild — with the flag off, the only Kotlin in
the generated project is Expo's own `MainApplication.kt` and `MainActivity.kt`.

### Easiest: EAS Build (no local toolchain)

Expo compiles it in the cloud and hands you an installable file. This is the
recommended path, and the only one that works for iOS without a Mac.

```bash
cd mobile

# 1. Point the build at your server. Edit eas.json and replace
#    100.x.x.x with your Tailscale IP in every profile's EXPO_PUBLIC_API_URL.

# 2. One-time
npm install -g eas-cli
eas login
eas build:configure

# 3. Build an installable APK you can sideload
eas build --profile preview --platform android

# 4. iOS (needs a paid Apple Developer account for device installs)
eas build --profile preview --platform ios
```

`preview` produces a release APK with `distribution: internal` — EAS gives you
a download link/QR, no Play Store involved. Use `--profile development` plus
`expo-dev-client` when you want to iterate on native code with fast refresh.

### Compiling the widget Kotlin without waiting on EAS

A cloud build takes ~7 minutes to tell you about a typo. Compiling locally
takes seconds after the first run, and `compileReleaseKotlin` skips packaging
entirely — it type-checks the Kotlin and stops.

You need a JDK and the Android SDK. Installing **Android Studio** gets you
both; it ships JDK 17 (`jbr`) and an SDK, and Gradle 8.8 / AGP 8.x need
**JDK 17** — Java 8 or 11 will fail with an unsupported class file version.

```powershell
# One-time, adjust paths if you installed elsewhere
setx ANDROID_HOME "$env:LOCALAPPDATA\Android\Sdk"
setx JAVA_HOME "C:\Program Files\Android\Android Studio\jbr"
# reopen the terminal so they take effect
```

```powershell
cd mobile
npx expo prebuild --clean --platform android
cd android
.\gradlew.bat :app:compileReleaseKotlin    # Kotlin only, no APK
.\gradlew.bat :app:assembleRelease         # or the whole APK
```

On Windows it is `gradlew.bat` — the extensionless `gradlew` is the Unix
shell script and PowerShell will not run it. Check that `JAVA_HOME` points at
a JDK that actually exists (`Test-Path $env:JAVA_HOME`): Gradle's error names
the directory but not the fact that it is simply absent.

Errors come out as `file:line: error:` — the same output EAS shows, minutes
sooner.

**The catch that will bite you:** the widget sources live in
`mobile/widgets/android/`, and `withAndroidWidgets.js` *copies* them into
`android/app/src/main/java/com/loversrock/app/widgets/` at prebuild time.
Editing the originals and re-running Gradle changes nothing — Gradle compiles
the copies. Either re-run `expo prebuild` after each edit, or edit the copies
while iterating and port the fix back to `mobile/widgets/android/` before
committing. `android/` is gitignored and regenerated, so anything you leave
only in there is lost.

### Local build (Android only, needs the Android SDK)

```bash
cd mobile
npm install
npx expo prebuild --clean   # generates android/ + ios/, runs the config plugins
npx expo run:android        # needs ANDROID_HOME and the SDK installed
```

`android/` and `ios/` are gitignored on purpose — they are generated output.
Re-run `expo prebuild --clean` after changing `app.json` or either plugin.

iOS additionally needs macOS with Xcode; there is no way around that.

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

**Tested against a live stack** — `backend/test/widget.mjs` (29 assertions):
token issuing, the security boundary (the widget token cannot read messages,
memories or raw period logs), the privacy boundary, summary correctness, the
photo endpoint, and revocation.

**Verified by running `expo prebuild`** — the config plugins were executed for
real and the generated projects inspected:

- Kotlin sources land in `android/app/src/main/java/com/loversrock/app/widgets/`
- `res/layout` + `res/xml` widget resources merge into the app's res tree
- both `AppWidgetProvider` receivers and `POST_NOTIFICATIONS` appear in the
  merged `AndroidManifest.xml`
- `WidgetBridgePackage()` is registered in `MainApplication.getPackages()`
- the iOS `LoversRockWidgets` extension target exists with the right bundle id,
  `Info.plist` and an iOS 16 deployment target
- the App Group entitlement is applied to the main app
- the `.appex` is in the app's embed phase (`dstSubfolderSpec = 13`)

Two bugs were found and fixed this way: `addSourceFile` without a group key
crashed prebuild outright, and the `MainApplication` regex silently failed to
register the bridge package (which would have left `NativeModules.WidgetBridge`
null at runtime, so widgets would never have received credentials).

**Still unverified — nothing has been compiled.** No Xcode, no Android SDK.
What a real build still needs to shake out:

- Kotlin and Swift compilation. Nothing here has been through a compiler.
- Widget layout and sizing on real devices.
- The iOS target dependency silently no-ops on some `xcode` package versions;
  check the app target's Build Phases > Dependencies in Xcode, and its signing.
- RemoteViews bitmaps cross a Binder transaction with a ~1MB limit; the photo
  widget downsamples (`inSampleSize = 2`), which may need tuning for large
  photos.
