// Picture in picture for calls (native/android/voice/PictureInPicture.kt).
//
// - The activity is allowed into the small window, and handles the size
//   change itself rather than restarting (which would drop the call screen).
// - Android 8-11 have no auto-enter: MainActivity's onUserLeaveHint (leaving
//   the app with Home or Recents) asks PictureInPicture whether a video call
//   should shrink. Android 12+ do it from the params the app sets.
const { withAndroidManifest, withMainActivity, AndroidConfig } = require('@expo/config-plugins');

const MARK = '// loversrock: picture in picture';
const HOOK = `
  ${MARK}
  override fun onUserLeaveHint() {
    super.onUserLeaveHint()
    com.loversrock.app.voice.PictureInPicture.onUserLeaveHint(this)
  }
`;

function addLeaveHint(contents) {
  if (contents.includes(MARK)) return contents;
  const end = contents.lastIndexOf('}');
  if (end < 0) throw new Error('withPictureInPicture: MainActivity has no class body');
  return `${contents.slice(0, end).replace(/\s*$/, '\n')}${HOOK}}\n`;
}

function allowSmallWindow(manifest) {
  const activity = AndroidConfig.Manifest.getMainActivityOrThrow(manifest);
  activity.$['android:supportsPictureInPicture'] = 'true';
  activity.$['android:resizeableActivity'] = 'true';
  const changes = new Set(String(activity.$['android:configChanges'] || '').split('|').filter(Boolean));
  for (const c of ['screenSize', 'smallestScreenSize', 'screenLayout', 'orientation']) changes.add(c);
  activity.$['android:configChanges'] = [...changes].join('|');
  return manifest;
}

function withPictureInPicture(config) {
  config = withAndroidManifest(config, (cfg) => {
    cfg.modResults = allowSmallWindow(cfg.modResults);
    return cfg;
  });
  config = withMainActivity(config, (cfg) => {
    cfg.modResults.contents = addLeaveHint(cfg.modResults.contents);
    return cfg;
  });
  return config;
}

module.exports = withPictureInPicture;
module.exports.addLeaveHint = addLeaveHint;
module.exports.allowSmallWindow = allowSmallWindow;
