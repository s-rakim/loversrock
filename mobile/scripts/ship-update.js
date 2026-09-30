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

// The server address is baked in at bundle time. It is an EAS environment
// variable (EXPO_PUBLIC_API_URL, the "preview" environment), not a line in
// eas.json, so it never lands in the public repository; --environment gives
// this update the same value the builds get. Without it the fallback address
// inside an update would silently become localhost.
const env = process.env;

// An update carries every asset it has not sent before: the live skies are a
// few hundred pictures and two videos. On a home connection one of those
// uploads can drop ("Failed to upload ... storage.googleapis.com ... failed,
// reason:"), and that fails the whole command. The files already sent stay
// on the server and are skipped next time, so trying again carries on where
// it stopped: a few tries, spaced out, before giving up.
const ATTEMPTS = 3;
const PAUSE_S = [15, 45];

function pause(seconds) {
  // Synchronous on purpose: this is a one-shot command-line script.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);
}

console.log(`Sending "${message}" to the preview channel (runtime ${runtimeVersion}) ...`);
let status = 1;
for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
  const result = spawnSync(
    'eas',
    ['update', '--branch', 'preview', '--environment', 'preview', '--platform', 'android',
      '--message', JSON.stringify(message)],
    // shell: true so Windows finds eas.cmd.
    { stdio: 'inherit', env, cwd: root, shell: true },
  );
  status = result.status ?? 1;
  if (status === 0) break;
  if (attempt < ATTEMPTS) {
    const wait = PAUSE_S[attempt - 1];
    console.log(`\n  That did not go through (try ${attempt} of ${ATTEMPTS}). Files already uploaded are kept;`
      + ` trying again in ${wait}s ...\n`);
    pause(wait);
  }
}
if (status !== 0) {
  console.error(`
  Not sent after ${ATTEMPTS} tries. If it failed while uploading ("Failed to
  upload"), it is the connection to Expo's storage: run npm run ship again
  when the connection is steadier, and it will carry on from what already
  went up. Anything else (not logged in, a JavaScript error) is in the
  output above.
`);
}
process.exit(status);
