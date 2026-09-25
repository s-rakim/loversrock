# Home & lock screen widgets

## What exists on each platform

| | Home screen | Lock screen |
|---|---|---|
| **iOS 16+** | ✅ WidgetKit (`systemSmall`, `systemMedium`, `systemLarge`) | ✅ WidgetKit accessory families (`accessoryCircular`, `accessoryRectangular`, `accessoryInline`) |
| **Android** | ✅ `AppWidgetProvider` × 8 | ⚠️ Not possible — see below |

### The nine widgets

| Widget | Shows | Reads |
|---|---|---|
| **Summary** | Streak, next countdown, distance apart | `/widget/summary` |
| **Partner photo** | The latest locket photo | `/widget/photo` |
| **Together** | Days together, and the next milestone | `daysTogether`, `togetherSince` |
| **Today's question** | The question itself, and whether you have answered | `todaysQuestion`, `promptAnsweredToday` |
| **Next date** | What is planned and how soon | `nextDate` |
| **From them** | Their latest note — sealed ones announced, never printed | `sealedNoteWaiting`, `latestNote` |
| **Quick kiss** | One tap to send; a badge when one is waiting | `unseenKisses`, `POST /widget/kiss` |
| **Latest drawing** | The newest canvas drawing, replayed as vectors | `/widget/drawing` |
| **Lock screen glance** *(iOS)* | Streak, countdown, distance | `/widget/summary` |

The six added after the first two share one provider on each platform
(`GlanceWidgetProvider.kt`, `GlanceProvider` in `GlanceWidgets.swift`) because
they read one payload. Four of them read one payload and differ only in which
three strings they put in it, so they share a layout too — `widget_glance.xml`
and `GlanceCard`.

### The kiss is the only write a widget can do

The widget token lives in `SharedPreferences` / an App Group container, because
a widget process has to be able to read it. That is a weaker place than the
keychain the real session lives in, so the rule is that **anything the widget
token can do must be something you would not mind a thief of that phone doing**:
read a summary, and tell your partner you are thinking of them. It cannot read a
message, post one, see a sealed note, or touch anything else. `test/widget.mjs`
asserts each of those.

On iOS the tap is an `AppIntent`, which is iOS 17+. Before that the only thing a
widget tap could do was open the app — for a one-tap gesture that is the entire
feature gone, so on iOS 16 the heart opens the app instead.

### The drawing is sent as strokes, not an image

`/widget/drawing` returns the stroke list, thinned to ~2400 points, and each
platform replays it — `Canvas`/`Path` on Android, SwiftUI `Path` on iOS. No
image is stored or transferred, and the drawing stays crisp at whatever size
the widget is resized to. Thinning is **geometric**, not every-Nth: a slowly
drawn stroke has hundreds of points a fraction of a pixel apart and loses
nothing, while a fast flick has few points that all matter.

### What can silently go wrong, and the test for it

A widget that is written, committed and reviewed can still be missing from the
gallery on the phone, because one of four lists did not get the new name —
and none of them is a compile error on either platform:

* the Kotlin class exists but there is no `<receiver>` in the manifest
* the receiver points at an `@xml/..._info` that does not exist
* the info xml points at a `@layout` or `@string` that does not
* the Swift file is not copied into the extension target, or the `Widget`
  struct is not in the `@main` bundle

`mobile/test/widgets.mjs` checks all four, plus that every `R.id` a provider
writes to is actually present in the layout it inflates (a missing id is a
silent no-op, not an error). The iOS plugin now **discovers** the extension
sources from the folder rather than listing them, which removes one of the
four failure modes outright.

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

### Verifying the Kotlin without the Android SDK

The widget Kotlin is the only part of this app a normal `npm` workflow can't
check, and a full Android SDK is a multi-gigabyte install that some network
policies block outright. So:

```bash
cd mobile && bash widgets/android/tools/typecheck.sh
```

It compiles every widget source against the **real** Android framework
(Robolectric's `android-all` from Maven Central), a generated `R` that mirrors
what aapt emits from `widgets/android/res`, and hand-written stubs for
`androidx.core` notifications and the React Native bridge — the two artifacts
that publish only to Maven repos outside Maven Central.

It catches syntax errors, type errors, bad framework calls and missing `R`
symbols. It cannot catch a mismatch between a stub and the real androidx/RN
signature, so **green here is strong evidence, not proof** — only a Gradle
build proves it. Dependencies are cached after the first run.

The wiring between "the code exists" and "the widget ships" is checked
separately, and it is the check that matters most — see *What can silently go
wrong* above:

```bash
cd mobile && npm run test:widgets
```

`LOVERSROCK_WIDGETS=0` drops both widget plugins from a build. That is for
bisecting a native failure, not a normal build — widgets ship by default.

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

## Sending a photo (the locket)

Home screen -> the wide photo card -> **Take a photo** or **Choose**, add a
caption, send. It lands on your partner's widget and, because every widget
photo is mirrored into Memories with `source='widget'`, it is never lost
even if native delivery fails.

The chain, and where each part is proven:

| Hop | Proven by |
|---|---|
| App uploads (`POST /widget-photos`) | `test/locket.mjs` |
| Mirrored into Memories | `test/locket.mjs` |
| FCM **data** message wakes the widget | `test/push.mjs` |
| Widget fetches (`GET /widget/photo`, widget token in the query string) | `test/locket.mjs`, including that the bytes are a real PNG |
| Widget paints it on the home screen | **Not proven — needs a device** |

Photos are capped at 1024px and quality 0.5 before upload. That is not
cosmetic: base64 inflates the payload by about a third, and an Android
`RemoteViews` bitmap has to cross a Binder transaction with a hard ~1MB
limit. A full-resolution phone photo fails that and the widget draws
nothing.

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
