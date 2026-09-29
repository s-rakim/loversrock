// Every library the app's own Kotlin imports is one the app declares.
//
// A module's `implementation` dependencies stay off every other module's
// compile classpath. So Kotlin in the app that imports a class from a library
// only some Expo module depends on compiles in the typecheck (whose stubs put
// everything on the classpath) and then fails the real release build, in
// compileReleaseKotlin, after twenty minutes on EAS. That happened with
// firebase-messaging: expo-notifications has it, the app did not.
//
// This maps each third-party package the native code imports to the Gradle
// artifact that provides it, and checks a prebuild adds that artifact.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${d ?? ''}`); } };

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
const voice = require(path.join(root, 'plugins', 'withVoiceNotes.js'));

const walk = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const full = path.join(dir, e.name);
  if (e.isDirectory()) return e.name === 'tools' ? [] : walk(full);
  return e.name.endsWith('.kt') ? [full] : [];
}) : []);
const sources = [...walk(path.join(root, 'native', 'android')), ...walk(path.join(root, 'widgets', 'android'))];
const imports = new Set(sources.flatMap((f) => [...fs.readFileSync(f, 'utf8').matchAll(/^import\s+([\w.]+)/gm)].map((m) => m[1])));

// Packages the app module always has: the platform, the language, and what
// the React Native / Expo template itself puts on the app's classpath.
const PROVIDED = [/^android\./, /^kotlin/, /^java\./, /^javax\./, /^org\.json\./, /^androidx\./,
  /^com\.facebook\.react\./, /^expo\.modules\./, /^com\.loversrock\.app\./];
// Packages that come only through an Expo module's `implementation`, and the
// artifact the app must declare itself to compile against them.
const NEEDS = [{ pkg: /^com\.google\.firebase\.messaging\./, artifact: 'com.google.firebase:firebase-messaging' }];

console.log('=== EVERY IMPORT IS ON THE APP\'S CLASSPATH ===');
const template = 'android {\n}\n\ndependencies {\n    implementation("com.facebook.react:react-android")\n}\n';
const version = voice.firebaseMessagingVersion(root);
const gradle = voice.addFirebaseMessagingDependency(template, version);
for (const name of [...imports].sort()) {
  if (PROVIDED.some((re) => re.test(name))) continue;
  const need = NEEDS.find((n) => n.pkg.test(name));
  check(`${name} comes from a library the app declares`,
    need && gradle.includes(need.artifact), need ? `${need.artifact} not added to app/build.gradle` : 'unknown library: add it to NEEDS or PROVIDED');
}

console.log('\n=== AND THE DEPENDENCY IS ADDED SAFELY ===');
check('the version is read from expo-notifications itself', /^\d+\.\d+\.\d+$/.test(version), version);
const pinned = fs.readFileSync(require.resolve('expo-notifications/android/build.gradle', { paths: [root] }), 'utf8');
check('and matches what expo-notifications compiles against', pinned.includes(`firebase-messaging:${version}`), version);
check('it goes inside the dependencies block', /dependencies \{\n\s+implementation\("com\.google\.firebase:firebase-messaging:/.test(gradle), gradle);
check('adding it twice does not duplicate it', voice.addFirebaseMessagingDependency(gradle, version) === gradle);
let threw = false;
try { voice.addFirebaseMessagingDependency('android {\n}\n', version); } catch { threw = true; }
check('a template with no dependencies block fails loudly, not silently', threw);

// One slow Maven server must not fail the build: jitpack.io timing out once
// took expo-camera's cameraview down with it (plugins/withResilientRepositories.js).
console.log('\n=== A SLOW JITPACK CANNOT FAIL THE BUILD ===');
{
  const plugins = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo.plugins;
  check('the repository guard is one of the app\'s plugins', plugins.includes('./plugins/withResilientRepositories'));
  const { SNIPPET } = require(path.join(root, 'plugins', 'withResilientRepositories.js'));
  check('jitpack is only asked for com.github.* (not org.jitsi or com.google.android)',
    /jitpack\.io[\s\S]*includeGroupByRegex 'com\\\\\.github\\\\\.\.\*'/.test(SNIPPET), SNIPPET);
  check('and it reaches repositories added after it, as React Native adds jitpack',
    /repositories\.withType\(MavenArtifactRepository\)\.configureEach/.test(SNIPPET));
}

console.log(`\nNATIVE DEPS RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
fails.forEach((f) => console.log(`  - ${f}`));
process.exit(fails.length ? 1 : 0);
