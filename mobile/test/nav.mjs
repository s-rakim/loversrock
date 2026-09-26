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
const table = block.slice(0, block.indexOf('};'));

// Two shapes: `type: 'Screen'` for a tab or root screen, and
// `type: { tab: 'X', screen: 'Y' }` for a screen inside a section.
const flat = [...table.matchAll(/^\s*(\w+):\s*'(\w+)'/gm)].map((m) => ({ type: m[1], screen: m[2] }));
const nested = [...table.matchAll(/^\s*(\w+):\s*\{\s*tab:\s*'(\w+)',\s*screen:\s*'(\w+)'\s*\}/gm)]
  .map((m) => ({ type: m[1], tab: m[2], screen: m[3] }));
const routes = [...flat.map((r) => r.screen), ...nested.map((r) => r.tab)];

check(`${flat.length + nested.length} notification types map to a screen`,
  flat.length + nested.length >= 8, { flat: flat.length, nested: nested.length });
const unknownRoutes = routes.filter((r) => !known.has(r) && r !== 'Call');
check('and every one of them is a real route', unknownRoutes.length === 0, unknownRoutes);

// The section screens, read off each section file, so a nested target that
// names a screen the section does not have is caught here rather than as a
// tap that lands on the wrong thing.
const sectionScreens = {};
for (const [tab, file] of [['Photos', 'PhotoSectionScreen.js'], ['Play', 'PlaySectionScreen.js']]) {
  const src = read('app', file);
  sectionScreens[tab] = [...src.matchAll(/<Stack\.Screen name="(\w+)"/g)].map((m) => m[1]);
}
for (const r of nested) {
  check(`  ${r.type} → ${r.tab}/${r.screen}, which that section has`,
    (sectionScreens[r.tab] || []).includes(r.screen),
    `${r.tab} has ${(sectionScreens[r.tab] || []).join(', ')}`);
}

// Naming only the tab lands on whatever that section opens FIRST, which is
// why these three have to be nested rather than flat.
for (const [type, tab, first] of [
  ['message', 'Photos', 'the camera'],
  ['memory', 'Photos', 'the camera'],
  ['game_invite', 'Play', 'the drawings shelf'],
  ['game_turn', 'Play', 'the drawings shelf'],
]) {
  check(`  ${type} does not stop at the ${tab} tab, which would open ${first}`,
    nested.some((r) => r.type === type), table.match(new RegExp(`${type}:.*`))?.[0]);
}

// And the app has to actually nest the navigation, or the inner name is
// carried all the way there and then dropped.
check('App.js passes the inner screen through when there is one',
  /route\.inner/.test(app) && /screen: route\.inner/.test(app),
  'App.js should nest params for a section target');

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
check('a message notification opens the thread itself, not the section',
  /message:\s*\{\s*tab:\s*'Photos',\s*screen:\s*'Messages'\s*\}/.test(notif));
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

console.log('\n=== A SECTION SCREEN COVERS THE ONE IT WAS PUSHED OVER ===');
// The photo section shipped with contentStyle transparent, copied from the
// root stack where it is correct: there, the only thing behind a screen is
// the lava lamp. Inside a section the thing behind is the sibling you just
// came from, so tapping Chat drew the thread over the live camera and read
// as a button that does nothing.
for (const [tab, file] of [
  ['Photos', 'PhotoSectionScreen.js'],
  ['Play', 'PlaySectionScreen.js'],
  ['Cycle', 'PeriodTrackerScreen.js'],
]) {
  const src = read('app', file);
  const style = src.match(/contentStyle:\s*\{([^}]*)\}/)?.[1] || '';
  check(`  the ${tab} section gives its screens a background`,
    /backgroundColor:\s*colors\./.test(style), style.trim());
  check(`  and it is not transparent, which would show the previous screen`,
    !/transparent/.test(style), style.trim());
}

// Wallpaper's default draws nothing by design, so the screen under it is
// the only thing standing between the thread and whatever is behind.
const wallpaper = read('components', 'Wallpaper.js');
check('the default wallpaper is still deliberately see-through',
  /transparent\) return null/.test(wallpaper),
  'if this changed, the section background note above needs revisiting');

console.log('\n=== NO SCREEN IS BUILT FRESH ON EVERY RENDER ===');
// MainTabs was written as
//
//     <Tab.Screen name="Home" component={fadeOnFocus(HomeScreen)} />
//
// which calls the higher-order component IN RENDER, so every render of
// MainTabs produced six brand-new component types. React Navigation compares
// `component` by identity, so a new function is a new screen: it unmounted
// the old one and mounted the new one, which re-rendered MainTabs, which made
// six more. The app died on launch with "Maximum update depth exceeded",
// blaming PreventRemoveProvider inside PhotoSectionScreen's navigator —
// the section with a nested stack of its own was just the first to notice.
//
// A higher-order component belongs at module scope. Called in render it is
// not a wrapper, it is a factory.
const screenFiles = [
  path.join(root, 'App.js'),
  ...walk(path.join(root, 'app')),
];
const inlineFactories = [];
for (const f of screenFiles) {
  const text = fs.readFileSync(f, 'utf8');
  for (const m of text.matchAll(/component=\{\s*(\w+)\s*\(/g)) {
    inlineFactories.push(`${path.relative(root, f)}: component={${m[1]}(…)}`);
  }
}
check('no navigator builds its screen component inside render',
  inlineFactories.length === 0, inlineFactories.join(', '));

// The same mistake, one notch quieter: a new tabBar function every render
// re-creates the bar rather than the screens. Not fatal, but it throws away
// the bar's measured tab centres, so the light jumps instead of sliding.
const tabBarInline = /tabBar=\{\s*\(/.test(app);
check('and the tab bar is not a new function on every render', !tabBarInline,
  app.match(/tabBar=\{[^}]*\}/)?.[0]);

console.log('\n=== NOT BEING PAIRED YET IS NOT AN ERROR ===');
// Opening the thread before pairing put a modal dialog titled "Error" over
// the app, saying "Not currently paired". Most of this app is two people, so
// that is the state everybody starts in — and it has an obvious next step,
// which a dialog with an OK button is not.
const api = read('services', 'api.js');
const declared = api.match(/export const UNPAIRED_ERROR = '([^']+)'/)?.[1];
check('the app knows the exact refusal the server sends', Boolean(declared), declared);

// Read the server's own string rather than trusting a copy of it.
const authMiddleware = fs.readFileSync(
  path.join(root, '..', 'backend', 'src', 'middleware', 'auth.js'), 'utf8',
);
const sent = authMiddleware.match(/status\(403\)\.json\(\{ error: '([^']+)' \}\)/)?.[1];
check('and it is the string requirePair actually sends', declared === sent, { declared, sent });

// 403 alone is not enough: it also covers "not your call" and "not your date
// idea", which are real errors and must keep alerting.
check('isUnpaired checks the message, not just the status',
  /status === 403 && error\?\.message === UNPAIRED_ERROR/.test(api));

// Every screen that showed the raw dialog now has a state for it instead.
for (const file of ['MessagesScreen.js', 'CountdownScreen.js', 'DateIdeasScreen.js']) {
  const src = read('app', file);
  check(`  ${file} treats it as a state`,
    /isUnpaired\(err\)/.test(src) && /<NotPaired/.test(src));
}

// And nothing is left showing a bare "Error" dialog on a first load.
const bare = [];
for (const f of walk(path.join(root, 'app'))) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/Alert\.alert\('Error',[^)]*\)/g)) {
    // Fine if the same statement checks for the unpaired case first.
    const around = src.slice(Math.max(0, m.index - 220), m.index);
    if (!/isUnpaired/.test(around)) bare.push(`${path.relative(root, f)}: ${m[0]}`);
  }
}
check('no first load can still raise a bare "Error" dialog', bare.length === 0, bare.join(', '));

console.log('\n=== THE CYCLE TRACKER KNOWS WHICH SIDE YOU ARE ON ===');
// The tracker is the one asymmetric part of this app: one person keeps a
// health diary, the other is shown the parts of it chosen for them. It used
// to show everybody the same tabs, including the partner's read-only view,
// so the person tracking their own cycle could land on a screen where
// nothing could be changed and reasonably call the page a placeholder.
const home = read('app', 'cycle', 'CycleHomeScreen.js');
const ctx = read('components', 'cycle', 'CycleContext.js');
const login = read('app', 'LoginScreen.js');
const picker = read('app', 'cycle', 'CyclePickRoleScreen.js');

check('sign-up asks which side you are on', /cycleRole/.test(login) && /ROLES/.test(login));
check('and sends the answer with the account', /name, email, password, cycleRole/.test(login));

check('the cycle context carries the role', /role, setRole/.test(ctx));
check('read from the profile, not guessed', /me\?\.cycleRole/.test(ctx));

check('the two sides get different tabs',
  /OWNER_TABS/.test(home) && /PARTNER_TABS/.test(home));
// The partner has no diary of their own, so a log button would open a sheet
// that writes to nothing.
check('only the owner gets the add button', /owner && \(/.test(home));
check('and the partner does not get the daily log or the analysis',
  !/PARTNER_TABS[\s\S]*?analysis[\s\S]*?\];/.test(home));

// Defaulting is the one thing that must not happen: it either hands the
// person tracking a read-only screen, or points someone else's health record
// at the wrong account.
check('an account that has not chosen is asked, not defaulted',
  /!loading && !role/.test(home) && /CyclePickRoleScreen/.test(home));
check('the picker writes the choice to the account',
  /cycleRole: key/.test(picker));

// Hardcoding the first tab was a live bug in waiting: the partner's set has
// no 'today', so a hardcoded default would render an empty screen.
check('the starting tab comes from the set that applies',
  /tabs\[0\]\.key/.test(home), home.match(/const active = [^;]*/)?.[0]);

// A choice made at sign-up has to be reversible without a new account.
const settings = read('app', 'SettingsScreen.js');
check('Settings can switch sides', /changeCycleRole/.test(settings));
check('and says which side you are on now', /You track your own cycle/.test(settings));

// The server is the authority on what the role may be.
const authRoute = fs.readFileSync(path.join(root, '..', 'backend', 'src', 'routes', 'auth.js'), 'utf8');
const profileRoute = fs.readFileSync(path.join(root, '..', 'backend', 'src', 'routes', 'profile.js'), 'utf8');
check('the server validates the role on sign-up', /CYCLE_ROLES\.includes/.test(authRoute));
check('and on a later change', /CYCLE_ROLES\.includes/.test(profileRoute));
const roleSchema = fs.readFileSync(path.join(root, '..', 'backend', 'src', 'config', 'schema.sql'), 'utf8');
check('and the column itself only accepts those two',
  /cycle_role[\s\S]{0,120}CHECK \(cycle_role IN \('owner', 'partner'\)\)/.test(roleSchema));
check('and is nullable, so an existing account is asked rather than assumed',
  !/cycle_role TEXT NOT NULL/.test(roleSchema));

console.log('\n=== ONLY ONE BAR OWNS THE BOTTOM OF THE SCREEN ===');
// The cycle tracker drew its own Today/Calendar bar along the bottom edge,
// where the app's floating bar already lives. The two overlapped: "Today"
// landed on Play, "Calendar" on Quiz, and neither was reliably tappable.
{
  const shell = read('app', 'cycle', 'CycleHomeScreen.js');
  check('the cycle tabs use the same top bar as Photos and Play',
    /<SectionBar items=\{tabs\}/.test(shell));
  check('and nothing in the shell is pinned to the bottom edge as a bar',
    !/styles\.bar\b/.test(shell) && !/borderTopWidth/.test(shell));
  check('the add button floats above the main bar, at its measured height',
    /bottom: clearance\.above/.test(shell));
  check('its size is shared with the screens that have to clear it',
    /FAB_SIZE/.test(shell) && /FAB_SIZE/.test(read('components', 'cycle', 'layout.js')));

  // Each scrolling cycle screen used to pad by a flat 32px.
  for (const f of ['CycleTodayScreen', 'CycleCalendarScreen', 'PartnerCycleScreen', 'CycleAnalysisScreen']) {
    check(`  ${f} scrolls its last row clear of both`,
      /paddingBottom: bottomPad/.test(read('app', 'cycle', `${f}.js`)));
  }

  // The clearance is only as good as the height it assumes. Tie the constant
  // to the styles it describes, so changing one without the other fails here
  // rather than as content hidden behind the bar.
  const tabHeight = Number(bar.match(/tab: \{[\s\S]*?height: (\d+)/)?.[1]);
  const rowPad = bar.match(/row: \{[\s\S]*?paddingVertical: spacing\.(\w+)/)?.[1];
  const border = Number(bar.match(/pill: \{[\s\S]*?borderWidth: (\d+)/)?.[1]);
  const declared = bar.match(/const BAR_HEIGHT = ([^;]+);/)?.[1];
  check('the bar height the clearance uses matches the bar’s own styles',
    tabHeight === 44 && rowPad === 'sm' && border === 1 && declared === '44 + 8 * 2 + 2',
    { tabHeight, rowPad, border, declared });
}

console.log('\n=== THE PARTNER’S CALENDAR IS THEIR PARTNER’S, AND CANNOT WRITE ===');
{
  const cal = read('app', 'cycle', 'CycleCalendarScreen.js');
  const ctx2 = read('components', 'cycle', 'CycleContext.js');
  // The shell passed readOnly and the screen's signature dropped it, so the
  // partner saw their own empty month with Edit on every day.
  check('the calendar actually accepts readOnly', /function CycleCalendarScreen\(\{ navigation, readOnly/.test(cal));
  check('and draws the partner’s month from it', /readOnly \? cycle\.partnerView : cycle/.test(cal));
  check('the Edit button is gone when read-only', /\{!readOnly && \(\s*<MorphButton/.test(cal));
  check('and so is the add-a-note link', /\) : readOnly \? \(/.test(cal));
  check('the partner month comes from the sharing-gated endpoint',
    /\/period\/partner\/calendar\?month=/.test(ctx2));
  check('and goes through the same derivation as your own',
    /periodDatesOf\(partnerCalendar\)/.test(ctx2) && /periodDatesOf\(calendar\)/.test(ctx2));
}

console.log('\n=== NOTHING INSIDE A TAB GUESSES WHERE THE TAB BAR IS ===');
// The tab bar floats over every tab screen, so anything a tab screen pins to
// its bottom has to clear it — and three screens guessed instead: the cycle
// tabs sat under it, "New drawing" sat on top of Quiz and Settings, and the
// message box guessed a 90px margin that is right on one kind of phone and
// wrong on the other. useBarClearance() measures it; nothing should guess.
{
  const tabScreens = [
    'PhotoWidgetScreen', 'PhotoHistoryScreen', 'MessagesScreen', 'CanvasGalleryScreen',
    'GamesScreen', 'HomeScreen', 'QuizScreen', 'SettingsScreen',
  ].map((n) => [n, read('app', `${n}.js`)]);
  for (const f of fs.readdirSync(path.join(root, 'app', 'cycle'))) {
    if (f.endsWith('.js')) tabScreens.push([`cycle/${f.replace('.js', '')}`, read('app', 'cycle', f)]);
  }

  const guesses = [];
  for (const [name, src] of tabScreens) {
    // A floating control: absolute, with a bottom offset that is not zero.
    // Zero is a caption pinned inside its own card, which is fine.
    for (const m of src.matchAll(/\{[^{}]*position: 'absolute'[^{}]*\}/g)) {
      // Offsets under 8px position something inside a small element (the
      // ovulation dot in a calendar cell), not a control above the tab bar.
      const bottom = m[0].match(/bottom: ([^,}\n]+)/)?.[1]?.trim();
      const small = /^\d+$/.test(bottom || '') && Number(bottom) < 8;
      if (bottom && bottom !== '0' && !small) guesses.push(`${name}: absolute, bottom: ${bottom}`);
    }
    // A large literal bottom margin is a guess at the bar's height.
    for (const m of src.matchAll(/marginBottom: (\d+)/g)) {
      if (Number(m[1]) >= 60) guesses.push(`${name}: marginBottom: ${m[1]}`);
    }
  }
  check('no tab screen pins something at a guessed distance from the bottom',
    guesses.length === 0, guesses.join('; '));

  check('the drawing button clears the bar by measurement',
    /bottom: clearance\.above/.test(read('app', 'CanvasGalleryScreen.js')));
  check('and so does the message box',
    /marginBottom: clearance\.above/.test(read('app', 'MessagesScreen.js')));
}

console.log('\n=== A REFUSED LIVE CONNECTION SAYS WHY ===');
// The server refused the socket because nobody was paired, and Diagnostics
// reported it as "Can't reach the server... check Tailscale" — sending
// somebody to debug a network that was fine.
{
  const api = read('services', 'api.js');
  const diag = read('app', 'DiagnosticsScreen.js');
  check('the server’s refusal reason is kept', /socketRefusal = err\?\.message/.test(api));
  check('a refused socket is reported at once, not after a timeout',
    /if \(socketState === 'unauthorized'\) throw refused\(\)/.test(api));
  check('and in the server’s terms, not as a network fault',
    /Live updates start once you are paired/.test(api));
  check('Diagnostics shows "waiting on pairing", not a red failure, for things pairing will fix',
    /isUnpaired\(err\) \? \[WARN, WAITING_ON_PAIR\]/.test(diag)
    && /getSocketRefusal\(\) === UNPAIRED_ERROR/.test(diag));
}

console.log(`\nNAV RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
