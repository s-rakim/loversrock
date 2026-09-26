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

const GLANCE_PERMISSIONS = [
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.POST_PROMOTED_NOTIFICATIONS',
];

/** Registers every AppWidgetProvider plus the notification permissions. */
function withWidgetManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);

    application.receiver = application.receiver || [];

    const receivers = [
      { name: '.widgets.SummaryWidgetProvider', info: '@xml/widget_summary_info', label: '@string/widget_summary_label' },
      { name: '.widgets.PhotoWidgetProvider', info: '@xml/widget_photo_info', label: '@string/widget_photo_label' },
      { name: '.widgets.AnniversaryWidgetProvider', info: '@xml/widget_anniversary_info', label: '@string/widget_anniversary_label' },
      { name: '.widgets.DailyQuestionWidgetProvider', info: '@xml/widget_question_info', label: '@string/widget_question_label' },
      { name: '.widgets.NextDateWidgetProvider', info: '@xml/widget_nextdate_info', label: '@string/widget_nextdate_label' },
      { name: '.widgets.SecretMessageWidgetProvider', info: '@xml/widget_secret_info', label: '@string/widget_secret_label' },
      { name: '.widgets.KissWidgetProvider', info: '@xml/widget_kiss_info', label: '@string/widget_kiss_label' },
      { name: '.widgets.CanvasWidgetProvider', info: '@xml/widget_canvas_info', label: '@string/widget_canvas_label' },
      { name: '.widgets.DistanceWidgetProvider', info: '@xml/widget_distance_info', label: '@string/widget_distance_label' },
    ];

    for (const { name, info, label } of receivers) {
      if (application.receiver.some((r) => r.$?.['android:name'] === name)) continue;

      application.receiver.push({
        // The label is the widget's name in the picker. Without it the picker
        // falls back to the app's name, and all nine read "loversrock".
        $: { 'android:name': name, 'android:exported': 'false', 'android:label': label },
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

    // POST_NOTIFICATIONS: the lock screen glance notification on Android 13+.
    // POST_PROMOTED_NOTIFICATIONS: lets Android 16 lift that glance into a
    // Live Update — Samsung's Now Bar, OPPO's lock-screen capsule, the status
    // bar chip. A normal permission, granted at install; phones before
    // Android 16 ignore it.
    manifest.manifest['uses-permission'] = manifest.manifest['uses-permission'] || [];
    for (const name of GLANCE_PERMISSIONS) {
      const has = manifest.manifest['uses-permission'].some((p) => p.$?.['android:name'] === name);
      if (!has) manifest.manifest['uses-permission'].push({ $: { 'android:name': name } });
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
module.exports.GLANCE_PERMISSIONS = GLANCE_PERMISSIONS;
