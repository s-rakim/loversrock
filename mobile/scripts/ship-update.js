// Send the app's JavaScript to the installed phones, without a build.
//
//   npm run ship -- "fixed the doodle canvas"
//
// Refuses when native code has changed since the installed build. An update
// is JavaScript only; sent to a build whose native half it does not match, it
// can crash the app on launch on both phones, with no build to fall back to.
// That case needs a real build, and this says so instead of publishing.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { fingerprint } = require('./native-fingerprint');

const root = path.resolve(__dirname, '..');
const message = process.argv.slice(2).join(' ').trim() || 'update';

const { hash, runtimeVersion } = fingerprint();
const record = JSON.parse(fs.readFileSync(path.join(root, 'runtime.json'), 'utf8'));

if (record[runtimeVersion] !== hash) {
  console.error(`
  Not sent: native code has changed since runtime ${runtimeVersion} was built.

  Something compiled into the APK changed (a widget, a plugin, a native
  package, or the native part of app.json). JavaScript alone cannot deliver
  that, and sending it anyway could crash the app on launch on both phones.

  Build instead:   eas build --platform android --profile preview

  (Whoever changes native code bumps runtimeVersion in app.json and runs
  \`node scripts/native-fingerprint.js --stamp\`; this check is what notices
  when that was missed.)
`);
  process.exit(1);
}

// The server address is baked in at bundle time, and the builds get it from
// eas.json. Without the same value here the fallback address inside an update
// would silently become localhost.
const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8'));
const env = { ...process.env, ...(eas.build.preview.env || {}) };

console.log(`Sending "${message}" to the preview channel (runtime ${runtimeVersion}) ...`);
const result = spawnSync(
  'eas',
  ['update', '--branch', 'preview', '--platform', 'android', '--message', JSON.stringify(message)],
  // shell: true so Windows finds eas.cmd.
  { stdio: 'inherit', env, cwd: root, shell: true },
);
process.exit(result.status ?? 1);
