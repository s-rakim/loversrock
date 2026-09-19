// Extends app.json rather than replacing it: Expo reads this file and passes
// the static app.json config in as `config`.
//
// Two things happen here.
//
// 1. `extra.commit` — EAS sets EAS_BUILD_GIT_COMMIT_HASH on the build machine,
//    so the exact commit a binary came from is baked into the bundle and shown
//    on the login screen. Without it, "is this the latest build?" can only be
//    answered by hand against the EAS dashboard.
//
// 2. Widgets are ON. They are the point of this app, so the build includes
//    them by default. `LOVERSROCK_WIDGETS=0` drops both plugins — an escape
//    hatch for bisecting a native build failure, never the normal path.
const WIDGETS_ENABLED = process.env.LOVERSROCK_WIDGETS !== '0';

// 3. The icon is wired up only if the file is actually there. Expo fails the
//    build outright when `icon` points at a missing PNG, so declaring it
//    unconditionally in app.json would break the build for anyone who hasn't
//    added artwork yet. Drop a 1024x1024 PNG at assets/icon.png (and
//    optionally assets/adaptive-icon.png / assets/splash-icon.png) and it is
//    picked up on the next build with no config change.
const fs = require('fs');
const path = require('path');

const asset = (name) => {
  const file = path.join(__dirname, 'assets', name);
  return fs.existsSync(file) ? `./assets/${name}` : null;
};

// FCM needs google-services.json from the Firebase project. Declared only when
// the file is present: naming a missing one fails the build, and without it
// getDevicePushTokenAsync() simply returns no token and push stays off.
const googleServices = fs.existsSync(path.join(__dirname, 'google-services.json'))
  ? './google-services.json'
  : null;

const icon = asset('icon.png');
// Android crops the adaptive foreground to a mask; fall back to the plain
// icon if no dedicated foreground was supplied.
const adaptiveIcon = asset('adaptive-icon.png') || icon;
const splashIcon = asset('splash-icon.png') || icon;

const isWidgetPlugin = (plugin) =>
  String(Array.isArray(plugin) ? plugin[0] : plugin).includes('Widgets');

module.exports = ({ config }) => ({
  ...config,
  plugins: (config.plugins || []).filter((p) => WIDGETS_ENABLED || !isWidgetPlugin(p)),
  ...(icon ? { icon } : {}),
  ...(splashIcon
    ? { splash: { image: splashIcon, resizeMode: 'contain', backgroundColor: config.backgroundColor } }
    : {}),
  android: {
    ...config.android,
    ...(googleServices ? { googleServicesFile: googleServices } : {}),
    ...(adaptiveIcon
      ? { adaptiveIcon: { foregroundImage: adaptiveIcon, backgroundColor: config.backgroundColor } }
      : {}),
  },
  extra: {
    ...config.extra,
    commit: (process.env.EAS_BUILD_GIT_COMMIT_HASH || '').slice(0, 7) || 'local',
    widgetsEnabled: WIDGETS_ENABLED,
  },
});
