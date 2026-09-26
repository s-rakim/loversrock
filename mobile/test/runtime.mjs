// Over-the-air updates: that they are configured, and that they cannot be
// sent to a build they would break.
//
// An update is JavaScript only. It reaches an installed APK only if their
// runtimeVersions match, and it is only SAFE if the APK's native half is the
// one the JavaScript was written against. runtimeVersion is bumped by hand,
// so this test is what stops a native change going out with the old number.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${d ?? ''}`); } };

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;
const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const { fingerprint } = require(path.join(root, 'scripts', 'native-fingerprint.js'));

console.log('=== UPDATES ARE CONFIGURED ===');
check('expo-updates is a dependency', Boolean(pkg.dependencies['expo-updates']));
check('pinned the way the SDK pins it (~, not ^)', /^~/.test(pkg.dependencies['expo-updates'] || ''),
  pkg.dependencies['expo-updates']);
check('the update URL is this project\u2019s',
  app.updates?.url === `https://u.expo.dev/${app.extra?.eas?.projectId}`, app.updates?.url);
check('runtimeVersion is a fixed string, not a policy',
  typeof app.runtimeVersion === 'string' && app.runtimeVersion.length > 0, JSON.stringify(app.runtimeVersion));
for (const profile of ['development', 'preview', 'production']) {
  check(`  the ${profile} build listens on its own channel`, eas.build[profile]?.channel === profile,
    eas.build[profile]?.channel);
}

console.log('\n=== AND CANNOT BE SENT TO A BUILD THEY WOULD BREAK ===');
const record = JSON.parse(fs.readFileSync(path.join(root, 'runtime.json'), 'utf8'));
const { hash, runtimeVersion } = fingerprint();
check(`runtime ${runtimeVersion} has a recorded native fingerprint`, Boolean(record[runtimeVersion]));
check('and the native code still matches it',
  record[runtimeVersion] === hash,
  `native code changed (now ${hash}, recorded ${record[runtimeVersion]}): bump runtimeVersion in app.json, `
  + 'then run node scripts/native-fingerprint.js --stamp');

const ship = fs.readFileSync(path.join(root, 'scripts', 'ship-update.js'), 'utf8');
check('npm run ship refuses when the fingerprint does not match',
  /record\[runtimeVersion\] !== hash/.test(ship) && /process\.exit\(1\)/.test(ship));
check('and bakes in the same server address the builds use',
  /eas\.build\.preview\.env/.test(ship));

// The fingerprint must mean the same thing on a Windows checkout, where git
// may write text files with \r\n. Checked for real in the session that added
// this; pinned here so the normalisation cannot be dropped quietly.
const fp = fs.readFileSync(path.join(root, 'scripts', 'native-fingerprint.js'), 'utf8');
check('line endings are normalised before hashing', /replace\(\/\\r\\n\/g, '\\n'\)/.test(fp));
check('and paths use forward slashes', /split\(path\.sep\)\.join\('\/'\)/.test(fp));

// A native change must actually move the hash, or the guard guards nothing.
{
  const file = path.join(root, 'widgets', 'android', 'GlanceWidgets.kt');
  const before = fs.readFileSync(file);
  try {
    fs.writeFileSync(file, Buffer.concat([before, Buffer.from('\n// probe\n')]));
    check('changing widget code changes the fingerprint', fingerprint().hash !== hash);
  } finally {
    fs.writeFileSync(file, before);
  }
  check('and putting it back restores it', fingerprint().hash === hash);
}

console.log('\n=== AND THE PHONE CAN SAY WHAT IT IS RUNNING ===');
const diag = fs.readFileSync(path.join(root, 'app', 'DiagnosticsScreen.js'), 'utf8');
check('Diagnostics reports built-in code or an update, with channel and runtime',
  /add\('App updates'/.test(diag) && /Updates\.isEmbeddedLaunch/.test(diag));
check('it can fetch an update now instead of waiting for the next launch',
  /checkForUpdateAsync/.test(diag) && /reloadAsync/.test(diag));
check('and opens on a build that does not have the module', /require\('expo-updates'\)/.test(diag)
  && !/^import .*expo-updates/m.test(diag));

console.log(`\nRUNTIME RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
