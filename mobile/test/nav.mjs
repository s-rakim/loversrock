// Navigation wiring.
//
// Every failure this catches looks the same at runtime: a tap, or a tapped
// notification, that does nothing at all. React Navigation does not throw on
// navigate() to a name it cannot find — it warns to the console, which nobody
// reads on a phone.
import fs from 'node:fs';
import path from 'node:path';

let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${d ?? ''}`); } };

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const app = read('App.js');
const bar = read('components', 'LumaBar.js');

console.log('=== THE TAB BAR AND THE NAVIGATOR AGREE ===');
const barTabs = [...bar.matchAll(/^ {2}(\w+): \{ icon:/gm)].map((m) => m[1]);
const navTabs = [...app.matchAll(/<Tab\.Screen name="(\w+)"/g)].map((m) => m[1]);
check(`the bar knows ${barTabs.length} tabs`, barTabs.length === 7, barTabs);
check('and the navigator has the same ones, in the same order',
  JSON.stringify(barTabs) === JSON.stringify(navTabs), { barTabs, navTabs });
// A tab with no entry in TAB_META falls back to a grey circle and the route
// name, which looks like a bug because it is one.
for (const t of navTabs) check(`  ${t} has an icon and a label`, bar.includes(`  ${t}: { icon:`));

console.log('\n=== THE SEVEN THE APP IS FOR ===');
for (const [name, why] of [
  ['Home', 'home'],
  ['Locket', 'the photo widget'],
  ['Doodle', 'the doodle widget'],
  ['Games', 'games'],
  ['Messages', 'messaging'],
  ['Cycle', 'period tracking'],
  ['Settings', 'settings'],
]) {
  check(`${why} is a tab`, navTabs.includes(name), navTabs);
}

console.log('\n=== NOTHING IS BOTH A TAB AND A STACK SCREEN ===');
// Two navigable copies of the camera means two entries on the back stack and
// a Done button that returns you to the wrong one.
const stackScreens = [...app.matchAll(/<Stack\.Screen name="(\w+)"/g)].map((m) => m[1]);
const duplicated = navTabs.filter((t) => stackScreens.includes(t));
check('no route is registered twice', duplicated.length === 0, duplicated);

console.log('\n=== EVERY navigate() TARGET EXISTS ===');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  (e.isDirectory() ? walk(path.join(dir, e.name))
    : (e.name.endsWith('.js') ? [path.join(dir, e.name)] : [])));
const files = [...walk(path.join(root, 'app')), ...walk(path.join(root, 'components')), ...walk(path.join(root, 'services'))];

// Screens registered anywhere, including NESTED navigators — the cycle
// tracker has its own stack inside its tab, and its screens are navigable
// from within it.
const known = new Set([...navTabs, ...stackScreens, 'MainTabs']);
for (const file of files) {
  for (const m of fs.readFileSync(file, 'utf8').matchAll(/<Stack\.Screen\s+name="(\w+)"|name="(\w+)"\s*\n?\s*component=/g)) {
    known.add(m[1] || m[2]);
  }
}

const missing = [];
let targets = 0;
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/navigat(?:e|ion\.navigate)\(\s*'(\w+)'/g)) {
    targets++;
    if (!known.has(m[1])) missing.push(`${path.relative(root, file)} → ${m[1]}`);
  }
}
check(`all ${targets} navigate() targets are registered`, missing.length === 0, missing.join(', '));

console.log('\n=== NOTIFICATION TARGETS TOO ===');
// A notification aimed at a screen that no longer exists opens nothing, and
// the only symptom is a tap that does not work.
const notifications = read('services', 'notifications.js');
const block = notifications.slice(notifications.indexOf('SCREEN_FOR_TYPE'));
const routes = [...block.slice(0, block.indexOf('};')).matchAll(/:\s*'(\w+)'/g)].map((m) => m[1]);
check(`${routes.length} notification types map to a screen`, routes.length >= 8, routes);
const unknownRoutes = routes.filter((r) => !known.has(r) && r !== 'Call');
check('and every one of them is a real route', unknownRoutes.length === 0, unknownRoutes);

// The tab/stack split is decided at runtime from this list, and a second
// hardcoded copy of it is how one notification quietly stops working.
check('App.js takes the tab list FROM the tab bar rather than repeating it',
  /TAB_ROUTES.*from '.\/components\/LumaBar'/.test(app) && /new Set\(TAB_ROUTES\)/.test(app),
  'App.js should import TAB_ROUTES');

console.log('\n=== THE OLD BAR IS GONE ===');
check('GlassTabBar no longer exists', !fs.existsSync(path.join(root, 'components', 'GlassTabBar.js')));
check('and nothing still imports it', !files.some((f) => fs.readFileSync(f, 'utf8').includes('GlassTabBar')));
// The blur-intensity slider in Settings is a real persisted preference and
// must survive the bar being replaced.
check('the glass intensity setting still drives the new bar', /useGlass\(\)/.test(bar));
check('and reduce-motion still stops the slide', /reduceMotion/.test(bar));

console.log(`\nNAV RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
