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
// 2. The widget config plugins are OPT-IN. They inject Kotlin and Swift that
//    has never been through a compiler, and a failure there blocks the whole
//    APK — including the parts that are tested and working. Leaving them off by
//    default means a broken widget can never stop the app from shipping.
//
//    Turn them on for a build with:  LOVERSROCK_WIDGETS=1
//    (eas.json sets it per-profile; locally, set it before `expo prebuild`.)
const WIDGETS_ENABLED = process.env.LOVERSROCK_WIDGETS === '1';

const isWidgetPlugin = (plugin) =>
  String(Array.isArray(plugin) ? plugin[0] : plugin).includes('Widgets');

module.exports = ({ config }) => ({
  ...config,
  plugins: (config.plugins || []).filter((p) => WIDGETS_ENABLED || !isWidgetPlugin(p)),
  extra: {
    ...config.extra,
    commit: (process.env.EAS_BUILD_GIT_COMMIT_HASH || '').slice(0, 7) || 'local',
    widgetsEnabled: WIDGETS_ENABLED,
  },
});
