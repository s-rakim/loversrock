// Voice notes that play by themselves: the native half.
//
// Copies native/android/voice/*.kt into the generated project and registers:
//
//   * VoiceMessagingService — in FRONT of expo-notifications' own FCM service.
//     FCM hands each push to one service; expo-notifications registers its
//     own at priority -1 so an app can take precedence, and this does. It
//     keeps voice notes and passes everything else straight back.
//   * VoicePlaybackService — a foreground service of type mediaPlayback,
//     which is what Android 14 requires to play audio from the background.
//   * VoiceNotesPackage — the bridge the JS side configures it through.
//
// iOS gets nothing here: it will not let an app that is not running play
// sound by itself, so an iPhone gets an ordinary notification instead
// (backend/src/routes/voice.js).
const fs = require('fs');
const path = require('path');
const {
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
  AndroidConfig,
} = require('@expo/config-plugins');

const PACKAGE_DIR = 'com/loversrock/app/voice';

const PERMISSIONS = [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
  'android.permission.WAKE_LOCK',
  'android.permission.RECORD_AUDIO',
  'android.permission.POST_NOTIFICATIONS',
];

function withVoiceSources(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const source = path.join(cfg.modRequest.projectRoot, 'native', 'android', 'voice');
      const dest = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/java', PACKAGE_DIR);
      fs.mkdirSync(dest, { recursive: true });
      for (const file of fs.readdirSync(source)) {
        if (file.endsWith('.kt')) fs.copyFileSync(path.join(source, file), path.join(dest, file));
      }
      return cfg;
    },
  ]);
}

function withVoiceManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    application.service = application.service || [];

    const has = (name) => application.service.some((s) => s.$?.['android:name'] === name);

    if (!has('.voice.VoiceMessagingService')) {
      application.service.push({
        $: { 'android:name': '.voice.VoiceMessagingService', 'android:exported': 'false' },
        'intent-filter': [
          {
            // Above expo-notifications' -1, so this one receives the push.
            $: { 'android:priority': '10' },
            action: [{ $: { 'android:name': 'com.google.firebase.MESSAGING_EVENT' } }],
          },
        ],
      });
    }

    if (!has('.voice.VoicePlaybackService')) {
      application.service.push({
        $: {
          'android:name': '.voice.VoicePlaybackService',
          'android:exported': 'false',
          'android:foregroundServiceType': 'mediaPlayback',
        },
      });
    }

    manifest.manifest['uses-permission'] = manifest.manifest['uses-permission'] || [];
    for (const name of PERMISSIONS) {
      const present = manifest.manifest['uses-permission'].some((p) => p.$?.['android:name'] === name);
      if (!present) manifest.manifest['uses-permission'].push({ $: { 'android:name': name } });
    }
    return cfg;
  });
}

function withVoicePackage(config) {
  return withMainApplication(config, (cfg) => {
    let contents = cfg.modResults.contents;
    const importLine = 'import com.loversrock.app.voice.VoiceNotesPackage';
    if (!contents.includes(importLine)) {
      contents = contents.replace(/^(package .*)$/m, `$1\n\n${importLine}`);
    }

    if (!contents.includes('VoiceNotesPackage()')) {
      const before = contents;
      // Expo runs mods for the same file LAST-registered first, so this
      // usually sees the untouched template before withAndroidWidgets does.
      // It must leave a shape that plugin still recognises: the
      // `val packages = PackageList(this).packages` form is one of the two it
      // handles, and `.apply { ... }` (what it writes itself) is not.
      contents = contents.replace(
        /(PackageList\(this\)\.packages\.apply\s*\{)/,
        '$1\n              add(VoiceNotesPackage())'
      );
      if (contents === before) {
        contents = contents.replace(
          /return\s+PackageList\(this\)\.packages\s*$/m,
          'val packages = PackageList(this).packages\n'
            + '            packages.add(VoiceNotesPackage())\n'
            + '            return packages'
        );
      }
      if (contents === before) {
        contents = contents.replace(
          /(val packages = PackageList\(this\)\.packages)/,
          '$1\n              packages.add(VoiceNotesPackage())'
        );
      }
      if (contents === before) {
        throw new Error(
          '[withVoiceNotes] Could not register VoiceNotesPackage in MainApplication — ' +
            'the generated template shape changed. Add `packages.add(VoiceNotesPackage())` ' +
            'to getPackages() manually, or update this plugin.'
        );
      }
    }

    cfg.modResults.contents = contents;
    return cfg;
  });
}

module.exports = function withVoiceNotes(config) {
  config = withVoiceSources(config);
  config = withVoiceManifest(config);
  config = withVoicePackage(config);
  return config;
};
module.exports.PERMISSIONS = PERMISSIONS;
