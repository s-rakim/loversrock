# Native Android Widget — Build Notes (not yet implemented)

This is deliberately **not built**. Every feature a widget would expose
(Canvas doodle, Countdown, daily photo drop, Distance Apart) already exists
as a working in-app screen — see `mobile/app/CanvasScreen.js`,
`CountdownScreen.js`, `HomeScreen.js` (widget preview cards), and
`DistanceApartScreen.js`. What's missing is only the literal
launcher-pinnable home-screen tile.

## Why it's deferred

A real Android home-screen widget requires:

1. A native Kotlin `AppWidgetProvider` + `RemoteViews` layout, which is not
   expressible in pure JS/Expo Go.
2. An Expo **config plugin** that injects the `AndroidManifest.xml`
   `<receiver>` entry, `res/xml/*_widget_info.xml`, and the widget's XML
   layout during `expo prebuild`.
3. Switching the mobile app from the Expo Go managed workflow to a
   **dev client** (`expo-dev-client`) or bare workflow, since Expo Go itself
   cannot host custom native widget code.
4. A real Android build (Gradle/Android Studio or EAS Build) to compile and
   verify the widget actually renders and updates — this cannot be compiled
   or tested in a plain Node/JS environment, so implementing it without a way
   to verify it builds would mean shipping unverified native code.

## Planned shape (when picked up)

- `mobile/android-widget/` — Kotlin `AppWidgetProvider` subclasses, one per
  widget type (`CanvasWidgetProvider`, `CountdownWidgetProvider`,
  `PhotoWidgetProvider`, `DistanceWidgetProvider`).
- `mobile/plugins/withAndroidWidgets.js` — Expo config plugin wiring the
  manifest receivers and `res/xml` widget-info files into `expo prebuild`
  output.
- Widgets read the same REST endpoints the in-app screens already use
  (`GET /widget-photos/latest`, `GET /countdowns`, `GET /location/distance`)
  via a lightweight periodic `WorkManager` job, since there is no persistent
  background socket connection available to a widget process.
- `POST /widget-photos` already sends an FCM **data** message (not a
  notification message) specifically so a future widget/background receiver
  can wake and refresh without depending on the app being foregrounded —
  this contract is already in place on the backend side, waiting for a
  native consumer.

## Prerequisites before starting

- Android Studio + a physical or emulated Android device to actually see the
  widget render (Expo Go cannot).
- `eas build --profile development` (or a local Gradle build) to produce an
  installable dev client once `expo-dev-client` is added.
