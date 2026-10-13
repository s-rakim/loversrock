const fs = require('fs');
const path = require('path');
const {
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
  AndroidConfig,
} = require('@expo/config-plugins');

const PACKAGE_DIR = 'com/loversrock/app/widgets';

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

/** Copies the Kotlin sources and widget resources into the generated project. */
function withWidgetSources(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const androidRoot = cfg.modRequest.platformProjectRoot;
      const source = path.join(projectRoot, 'widgets', 'android');

      const kotlinDest = path.join(androidRoot, 'app/src/main/java', PACKAGE_DIR);
      fs.mkdirSync(kotlinDest, { recursive: true });
      for (const file of fs.readdirSync(source)) {
        if (file.endsWith('.kt')) {
          fs.copyFileSync(path.join(source, file), path.join(kotlinDest, file));
        }
      }

      // res/ is merged into the app's own res tree.
      copyDir(path.join(source, 'res'), path.join(androidRoot, 'app/src/main/res'));

      return cfg;
    },
  ]);
}

/** Registers both AppWidgetProviders plus the notification permission. */
function withWidgetManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);

    application.receiver = application.receiver || [];

    const receivers = [
      { name: '.widgets.SummaryWidgetProvider', info: '@xml/widget_summary_info' },
      { name: '.widgets.PhotoWidgetProvider', info: '@xml/widget_photo_info' },
      // Candle-style glance widgets (MomentWidgets.kt) + the shared Canvas.
      { name: '.widgets.DaysTogetherWidget', info: '@xml/widget_days_together_info' },
      { name: '.widgets.AnniversaryWidget', info: '@xml/widget_anniversary_info' },
      { name: '.widgets.StreakWidget', info: '@xml/widget_streak_info' },
      { name: '.widgets.CountdownWidget', info: '@xml/widget_countdown_info' },
      { name: '.widgets.DistanceWidget', info: '@xml/widget_distance_info' },
      { name: '.widgets.PartnerMoodWidget', info: '@xml/widget_partner_mood_info' },
      { name: '.widgets.NextDateWidget', info: '@xml/widget_next_date_info' },
      { name: '.widgets.LoveNoteWidget', info: '@xml/widget_love_note_info' },
      { name: '.widgets.SecretMessageWidget', info: '@xml/widget_secret_message_info' },
      { name: '.widgets.DailyQuestionWidget', info: '@xml/widget_daily_question_info' },
      { name: '.widgets.QuickKissWidget', info: '@xml/widget_quick_kiss_info' },
      { name: '.widgets.CanvasWidget', info: '@xml/widget_canvas_info' },
    ];

    for (const { name, info } of receivers) {
      if (application.receiver.some((r) => r.$?.['android:name'] === name)) continue;

      application.receiver.push({
        $: { 'android:name': name, 'android:exported': 'false' },
        'intent-filter': [
          { action: [{ $: { 'android:name': 'android.appwidget.action.APPWIDGET_UPDATE' } }] },
        ],
        'meta-data': [
          {
            $: {
              'android:name': 'android.appwidget.provider',
              'android:resource': info,
            },
          },
        ],
      });
    }

    // Needed for the lock screen glance notification on Android 13+.
    manifest.manifest['uses-permission'] = manifest.manifest['uses-permission'] || [];
    const hasPermission = manifest.manifest['uses-permission'].some(
      (p) => p.$?.['android:name'] === 'android.permission.POST_NOTIFICATIONS'
    );
    if (!hasPermission) {
      manifest.manifest['uses-permission'].push({
        $: { 'android:name': 'android.permission.POST_NOTIFICATIONS' },
      });
    }

    return cfg;
  });
}

/** Registers the RN bridge package so JS can hand credentials to the widgets. */
function withBridgePackage(config) {
  return withMainApplication(config, (cfg) => {
    let contents = cfg.modResults.contents;
    const importLine = 'import com.loversrock.app.widgets.WidgetBridgePackage';

    if (!contents.includes(importLine)) {
      contents = contents.replace(/^(package .*)$/m, `$1\n\n${importLine}`);
    }

    // Expo SDK 51 generates `return PackageList(this).packages`; older
    // templates used `val packages = PackageList(this).packages`. Handle both,
    // and fail loudly rather than silently shipping an unregistered module —
    // a missing package means NativeModules.WidgetBridge is null at runtime
    // and the widgets never receive credentials.
    if (!contents.includes('WidgetBridgePackage()')) {
      const before = contents;

      contents = contents.replace(
        /return\s+PackageList\(this\)\.packages\s*$/m,
        'return PackageList(this).packages.apply {\n              add(WidgetBridgePackage())\n            }'
      );

      if (contents === before) {
        contents = contents.replace(
          /(val packages = PackageList\(this\)\.packages)/,
          '$1\n              packages.add(WidgetBridgePackage())'
        );
      }

      if (contents === before) {
        throw new Error(
          '[withAndroidWidgets] Could not register WidgetBridgePackage in MainApplication — ' +
            'the generated template shape changed. Add `packages.add(WidgetBridgePackage())` ' +
            'to getPackages() manually, or update this plugin.'
        );
      }
    }

    cfg.modResults.contents = contents;
    return cfg;
  });
}

module.exports = function withAndroidWidgets(config) {
  config = withWidgetSources(config);
  config = withWidgetManifest(config);
  config = withBridgePackage(config);
  return config;
};
