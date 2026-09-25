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
check(`the bar knows ${barTabs.length} tabs`, barTabs.length === 6, barTabs);
check('and the navigator has the same ones, in the same order',
  JSON.stringify(barTabs) === JSON.stringify(navTabs), { barTabs, navTabs });
// A tab with no entry in TAB_META falls back to a grey circle and the route
// name, which looks like a bug because it is one.
for (const t of navTabs) check(`  ${t} has an icon and a label`, bar.includes(`  ${t}: { icon:`));

console.log('\n=== THE SIX BUTTONS, AND WHAT IS BEHIND THEM ===');
for (const [name, why] of [
  ['Photos', 'photos, memories and messages'],
  ['Play', 'doodle and games'],
  ['Home', 'home'],
  ['Cycle', 'period tracking'],
  ['Quiz', 'the daily quiz'],
  ['Settings', 'settings'],
]) {
  check(`${why} is a tab`, navTabs.includes(name), navTabs);
}

// Two of the six are SECTIONS — a tab holding several screens behind one
// button. What is inside them is the actual requirement, so it is asserted
// rather than left to the tab name.
const sections = {
  'app/PhotoSectionScreen.js': {
    screens: ['Camera', 'Wall', 'Messages'],
    components: ['PhotoWidgetScreen', 'PhotoHistoryScreen', 'MessagesScreen'],
  },
  'app/PlaySectionScreen.js': {
    screens: ['Drawings', 'Arcade'],
    components: ['CanvasGalleryScreen', 'GamesScreen'],
  },
};
for (const [file, want] of Object.entries(sections)) {
  const src = read(...file.split('/'));
  const inner = [...src.matchAll(/<Stack\.Screen name="(\w+)"/g)].map((m) => m[1]);
  check(`${file} holds ${want.screens.join(', ')}`,
    JSON.stringify(inner) === JSON.stringify(want.screens), inner);
  for (const c of want.components) check(`  and really renders ${c}`, src.includes(c));
  // Every screen in the section must be reachable from its own pill, or one
  // of them is in the build and unreachable.
  const pill = [...src.matchAll(/key: '(\w+)'/g)].map((m) => m[1]);
  check('  every screen is on the section pill',
    JSON.stringify([...pill].sort()) === JSON.stringify([...want.screens].sort()), { pill, inner });
}

// Home in the middle: with six buttons the thumb reaches the centre.
check('the tabs open on Home rather than the first one',
  /initialRouteName="Home"/.test(app), 'Tab.Navigator should pin Home');
check('and Home is in the middle of the bar', barTabs.indexOf('Home') === 2, barTabs);

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

console.log('\n=== PUSH IS ACTUALLY TURNED ON ===');
// Every failure here is the same silent one: notifications simply stop
// arriving, with no error on either side.
const notif = read('services', 'notifications.js');

// Registration used to happen only on the pairing screen. A phone that
// reinstalled — or the partner who ACCEPTED the invite rather than sending it
// — could end up with a token the server had never heard of.
check('the push token is re-registered on every cold start',
  /syncPushToken\(\)/.test(app) && /export async function syncPushToken/.test(notif));
check('and doing so never prompts, so the ask stays where there is context',
  /status !== 'granted'\) return \{ registered: false, reason: 'not-granted' \}/.test(notif));
check('the first ask still happens at pairing', read('app', 'PairingScreen.js').includes('registerForPush'));

// Android shows nothing at all for a message aimed at a channel that does not
// exist, and the channel — not the message — decides importance.
for (const [id, importance] of [['calls', 'MAX'], ['partner', 'HIGH'], ['games', 'HIGH'], ['reminders', 'DEFAULT']]) {
  check(`the ${id} channel exists at ${importance} importance`,
    new RegExp(`${id}: \\{[\\s\\S]{0,200}?AndroidImportance\\.${importance}`).test(notif), id);
}
check('channels are created before the first notification can arrive', /ensureChannels\(\)/.test(app));

// A banner for the message you are currently reading, on the screen you are
// reading it on, is noise — it arrived over the socket a moment earlier.
check('a message banner is suppressed while the thread is open',
  /activeScreen === 'Messages' && type === 'message'/.test(notif));
check('and the thread says when it is open',
  /setActiveScreen\('Messages'\)/.test(read('app', 'MessagesScreen.js')));
check('and says when it is not, or every later message is swallowed',
  /setActiveScreen\(null\)/.test(read('app', 'MessagesScreen.js')));

// A tap has to land somewhere that exists — asserted against the real route
// table above.
check('a message notification opens the photo section, where the thread lives',
  /message: 'Photos'/.test(notif));
check('a call notification opens the call', /call: 'Call'/.test(notif));

console.log('\n=== NOTHING IS BUILT ON THE SERVER AND UNREACHABLE IN THE APP ===');
// This is the gap that found three real features sitting unused: badges,
// three of the four nudge kinds, and reactions that could be shown but never
// added. None of them errors, none of them fails a test — the work is simply
// there and nobody can get to it.
const allSource = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n') + app;

for (const [route, what] of [
  ['/achievements', 'the badge list'],
  ['/achievements/streak', 'the streak and its repair'],
  ['/presence/nudges', 'kisses in the app'],
  ['/presence/reactions', 'reacting to things'],
  ['/feed', 'the joint feed'],
  ['/checkins/current', 'the monthly check-in'],
  ['/checkins/challenge', 'the random challenge'],
  ['/date-ideas/swipe', 'the swipe deck'],
  ['/canvas', 'the drawing gallery'],
  ['/widget/token', 'widget setup'],
]) {
  check(`${what} is actually called from the app`, allSource.includes(route), route);
}

// Every nudge kind the server accepts needs a way in. The widget can only
// send a kiss — a home screen button has no room to ask — so if the app does
// not offer the rest, three quarters of the feature is unreachable.
const nudgeModel = fs.readFileSync(path.join(root, '..', 'backend', 'src', 'models', 'nudges.js'), 'utf8');
const kinds = [...nudgeModel.slice(nudgeModel.indexOf('NUDGE_KINDS')).matchAll(/'(\w+)'/g)].map((m) => m[1]).slice(0, 4);
check(`the server takes ${kinds.length} nudge kinds`, kinds.length === 4, kinds);
for (const kind of kinds) {
  check(`  ${kind} can be sent from the app`, new RegExp(`kind: '${kind}'`).test(allSource), kind);
}

// Reactions: the feed showed them and had no way to add one, which is a list
// that can only ever be empty.
const feed = read('app', 'FeedScreen.js');
check('the feed can ADD a reaction, not just show them', /\/presence\/reactions/.test(feed));
check('and remove one, because reacting is a toggle', /mine \? null : emoji/.test(feed));

// Badges.
check('there is a screen for the badges', fs.existsSync(path.join(root, 'app', 'AchievementsScreen.js')));
check('and a way to reach it', /navigate\('Achievements'\)/.test(allSource));

console.log('\n=== NO PAYWALL, AND NOTHING LEFT TO FLIP ===');
// is_locked shipped 17 of 27 decks behind a Premium badge on a server two
// people run for themselves. It was set false everywhere; the column is gone
// now so there is no flag left for a seed file or a future good idea.
const schema = fs.readFileSync(path.join(root, '..', 'backend', 'src', 'config', 'schema.sql'), 'utf8');
check('the deck lock column is dropped', /ALTER TABLE question_decks DROP COLUMN IF EXISTS is_locked/.test(schema));
check('the game lock column too', /ALTER TABLE games_catalog DROP COLUMN IF EXISTS is_locked/.test(schema));
check('and the "not implemented" flag, since every game has a screen',
  /DROP COLUMN IF EXISTS is_implemented/.test(schema));
check('no seed row carries a lock',
  !fs.readFileSync(path.join(root, '..', 'backend', 'seed', 'question_decks.json'), 'utf8').includes('isLocked')
  && !fs.readFileSync(path.join(root, '..', 'backend', 'seed', 'games_catalog.json'), 'utf8').includes('isLocked'));
check('nothing in the app reads a lock', !/is_locked|isLocked/.test(allSource));
// A promise nobody had made.
check('and no "Coming soon" label survives', !/Coming soon/.test(allSource));

console.log(`\nNAV RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
