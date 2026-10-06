// Tablets turn; phones stay upright.
//
// app.json's "orientation" is one setting for every device: "portrait"
// locked tablets upright too, which on a tablet in a stand or a keyboard
// case is the wrong way round. It is now "default" (follow the device), and
// this puts phones back to portrait:
//
// - Android: MainActivity locks to portrait when the screen's shortest side
//   is under 600dp (Android's own line between a phone and a tablet), before
//   anything is drawn.
// - iOS: iPhone orientations are portrait only; iPad keeps all four.
const { withMainActivity, withInfoPlist } = require('@expo/config-plugins');

const MARK = '// loversrock: phones stay portrait';
const LOCK = `
    ${MARK}
    if (resources.configuration.smallestScreenWidthDp < 600) {
      requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
    }`;

function lockPhonesToPortrait(contents) {
  if (contents.includes(MARK)) return contents;
  const call = /super\.onCreate\((null|savedInstanceState)\);?/;
  if (!call.test(contents)) {
    throw new Error('withTabletLayout: no super.onCreate(...) in MainActivity to follow; phones would rotate');
  }
  return contents.replace(call, (m) => `${m}${LOCK}`);
}

function withTabletLayout(config) {
  config = withMainActivity(config, (cfg) => {
    if (cfg.modResults.language !== 'kt') {
      throw new Error('withTabletLayout: expected a Kotlin MainActivity');
    }
    cfg.modResults.contents = lockPhonesToPortrait(cfg.modResults.contents);
    return cfg;
  });
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.UISupportedInterfaceOrientations = ['UIInterfaceOrientationPortrait'];
    cfg.modResults['UISupportedInterfaceOrientations~ipad'] = [
      'UIInterfaceOrientationPortrait',
      'UIInterfaceOrientationPortraitUpsideDown',
      'UIInterfaceOrientationLandscapeLeft',
      'UIInterfaceOrientationLandscapeRight',
    ];
    return cfg;
  });
  return config;
}

module.exports = withTabletLayout;
module.exports.lockPhonesToPortrait = lockPhonesToPortrait;
