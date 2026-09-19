const { withAndroidColors, AndroidConfig } = require('@expo/config-plugins');

/**
 * Defines `@color/splashscreen_background`.
 *
 * Expo's Android template unconditionally writes
 * res/drawable/splashscreen.xml, which references that colour — but the colour
 * itself is normally written by the `expo-splash-screen` config plugin. This
 * project doesn't depend on that package, so nothing defined it and
 * `:app:processReleaseResources` failed with:
 *
 *   AAPT: error: resource color/splashscreen_background
 *   (aka com.loversrock.app:color/splashscreen_background) not found.
 *
 * Defining it here keeps the splash the app's own background colour without
 * pulling in a native module purely to declare one colour.
 */
const FALLBACK = '#F7F4F2'; // theme.js colors.bg

module.exports = function withSplashScreenColor(config) {
  return withAndroidColors(config, (cfg) => {
    cfg.modResults = AndroidConfig.Colors.assignColorValue(cfg.modResults, {
      name: 'splashscreen_background',
      value: config.android?.backgroundColor || config.backgroundColor || FALLBACK,
    });
    return cfg;
  });
};
