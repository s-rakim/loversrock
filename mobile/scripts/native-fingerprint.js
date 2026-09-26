// What the installed APK is made of, as one hash.
//
// An over-the-air update is JavaScript only. It can be applied to an
// installed build ONLY if that build's native half is the one the JavaScript
// expects — send JS that calls a native module the APK does not contain and
// the app crashes on launch, on both phones, with no build to roll back to.
//
// app.json's runtimeVersion is the contract: updates go only to builds with
// the same runtimeVersion. It is a plain string, bumped by hand, rather than
// Expo's automatic "fingerprint" policy, because app.config.js injects the
// build's commit hash into the config and that differs between build time and
// update time — an automatic fingerprint would never match, and every update
// would be silently ignored.
//
// A hand-bumped version is only safe if forgetting to bump it is impossible,
// so this hashes everything native and runtime.json records the hash per
// runtimeVersion. test/runtime.mjs fails when they disagree.
//
//   node scripts/native-fingerprint.js          print the current hash
//   node scripts/native-fingerprint.js --stamp  record it (after a bump)
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === 'tools' ? [] : walk(full);
      return [full];
    });
}

/** A dependency has native code if it ships an android or ios folder, or is an Expo module. */
function isNative(name) {
  const dir = path.join(root, 'node_modules', name);
  return ['android', 'ios', 'expo-module.config.json', 'react-native.config.js']
    .some((f) => fs.existsSync(path.join(dir, f)));
}

function fingerprint() {
  const hash = crypto.createHash('sha256');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  // Native dependencies, by resolved version: a patch release of a native
  // module can change what the JS is allowed to call.
  const deps = Object.keys(pkg.dependencies || {}).sort().filter(isNative);
  for (const name of deps) {
    const version = JSON.parse(fs.readFileSync(
      path.join(root, 'node_modules', name, 'package.json'), 'utf8',
    )).version;
    hash.update(`dep:${name}@${version}\n`);
  }

  // The native parts of the app config. Version strings, the update URL and
  // `extra` are deliberately out: none of them changes what the binary can do.
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;
  const { version, runtimeVersion, updates, extra, ...native } = app;
  const android = { ...(native.android || {}) };
  delete android.versionCode;
  const ios = { ...(native.ios || {}) };
  delete ios.buildNumber;
  hash.update(`config:${JSON.stringify({ ...native, android, ios })}\n`);

  // Code that is compiled into the APK rather than bundled as JS.
  //
  // Normalised so the same checkout hashes the same on Windows: forward
  // slashes in paths, and \n line endings in text files, since git may check
  // text out with \r\n. Binary files (the widget preview PNGs) go in as-is.
  for (const file of [...walk(path.join(root, 'widgets')), ...walk(path.join(root, 'plugins'))]) {
    hash.update(`file:${path.relative(root, file).split(path.sep).join('/')}\n`);
    const bytes = fs.readFileSync(file);
    const text = !bytes.includes(0);
    hash.update(text ? bytes.toString('utf8').replace(/\r\n/g, '\n') : bytes);
  }
  return { hash: hash.digest('hex').slice(0, 16), deps, runtimeVersion };
}

module.exports = { fingerprint };

if (require.main === module) {
  const { hash, runtimeVersion } = fingerprint();
  const file = path.join(root, 'runtime.json');
  if (process.argv.includes('--stamp')) {
    const record = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    record[runtimeVersion] = hash;
    fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
    console.log(`runtime ${runtimeVersion} = ${hash} (recorded)`);
  } else {
    console.log(`runtime ${runtimeVersion} = ${hash}`);
  }
}
