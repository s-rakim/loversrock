// The message thread's own logic, run for real.
//
// Two bugs lived here, and both were reported as cosmetic:
//
//   "the messages are double"   — every message the sender wrote appeared
//   twice. The server broadcasts message:new with io.to(room), which includes
//   the sender's own socket, and the screen also appended the POST response.
//   Two delivery routes, one message, two list entries.
//
//   "the photos can't be shared" — see test/serverUrl.mjs; the upload was
//   always fine and the <Image> could not authenticate.
//
// The obvious fix for the first was to make the server exclude the sender.
// That is wrong: the echo is what keeps a second device, and a phone that
// reconnected mid-send, in sync. So the append is made idempotent instead,
// and that is what these exercise.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const babel = require('@babel/core');
const React = require('react');

let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${d ?? ''}`); } };

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function load(relative, extraStubs = {}) {
  const file = path.join(root, relative);
  const { code } = babel.transformSync(fs.readFileSync(file, 'utf8'), {
    filename: file,
    presets: [
      ['@babel/preset-env', { targets: { node: 'current' } }],
      ['@babel/preset-react', { runtime: 'classic' }],
    ],
    babelrc: false, configFile: false,
  });

  const host = (name) => name;
  const rn = {
    View: host('View'), Text: host('Text'), Pressable: host('Pressable'),
    Image: host('Image'), TextInput: host('TextInput'), FlatList: host('FlatList'),
    StyleSheet: { create: (s) => s, absoluteFill: {}, flatten: (s) => s },
    Alert: { alert() {} },
    Platform: { OS: 'android', select: (o) => o.android ?? o.default },
    NativeModules: {},
    AppState: { addEventListener: () => ({ remove() {} }), currentState: 'active' },
    PermissionsAndroid: { request: async () => 'granted', PERMISSIONS: {}, RESULTS: { GRANTED: 'granted' } },
  };

  const module_ = { exports: {} };
  const fakeRequire = (id) => {
    if (id === 'react') return React;
    if (id === 'react-native') return rn;
    if (extraStubs[id]) return extraStubs[id];
    if (id.startsWith('.')) {
      // An image require() is an asset for Metro, not a module to load.
      if (/\.(png|jpe?g|gif|webp)$/i.test(id)) return { __asset: true, uri: id };
      const resolved = path.join(path.dirname(relative), id);
      return load(resolved.endsWith('.js') ? resolved : `${resolved}.js`, extraStubs);
    }
    // expo-notifications is read at MODULE LOAD time — the notification
    // handler is registered on import and the channel table indexes into
    // AndroidImportance — so a bare proxy is not enough: the import throws
    // before any test runs.
    if (id === 'expo-notifications') {
      return {
        AndroidImportance: { DEFAULT: 3, HIGH: 4, MAX: 5, LOW: 2, MIN: 1 },
        setNotificationHandler() {},
        setNotificationChannelAsync: async () => {},
        getPermissionsAsync: async () => ({ status: 'undetermined' }),
        requestPermissionsAsync: async () => ({ status: 'undetermined' }),
        getDevicePushTokenAsync: async () => ({ data: 'test-token' }),
        addNotificationResponseReceivedListener: () => ({ remove() {} }),
        getLastNotificationResponseAsync: async () => null,
        scheduleNotificationAsync: async () => 'id',
        cancelAllScheduledNotificationsAsync: async () => {},
        getAllScheduledNotificationsAsync: async () => [],
        SchedulableTriggerInputTypes: { DAILY: 'daily', TIME_INTERVAL: 'timeInterval' },
      };
    }
    return new Proxy(() => null, {
      get: (_t, prop) => (prop === '__esModule' ? false : host(String(prop))),
      apply: () => null,
    });
  };
  new Function('module', 'exports', 'require', code)(module_, module_.exports, fakeRequire);
  return module_.exports;
}

const stubs = {
  '../services/api': { apiFetch: async () => ({}), connectSocket: async () => ({ on() {}, off() {} }), mediaUrl: (k) => `http://x/media/${k}` },
  // The real crypto module is exercised by test/crypto.mjs against the real
  // primitives. Here it is stubbed, because loading it through this walker
  // would pull tweetnacl in through the catch-all proxy and hand it a string
  // where it expects setPRNG.
  '../services/crypto': {
    getKeyPair: async () => ({ publicKeyBase64: 'stub' }),
    encryptFor: async (_key, text) => `e2ee:v1:${text}`,
    decryptFrom: async (_key, payload) => String(payload).replace('e2ee:v1:', ''),
    isEncrypted: (v) => typeof v === 'string' && v.startsWith('e2ee:v1:'),
  },
  '../components/ThemeContext': { useTheme: () => ({ colors: {}, font: {} }) },
  '../components/Motion': { MorphButton: ({ children }) => children, Stagger: ({ children }) => children },
  '../components/Icon': () => null,
  '../components/Stickers': () => null,
  '../components/Doodle': () => null,
  '../components/Wallpaper': ({ children }) => children,
  '../components/calls/CallButtons': () => null,
  '../theme': { spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 }, radius: { sm: 8, md: 12, pill: 999, icon: 12, card: 16 } },
  '@react-navigation/native': { useFocusEffect: () => {} },
  'expo-image-picker': { MediaTypeOptions: { Images: 'Images' }, launchImageLibraryAsync: async () => ({ canceled: true }), requestMediaLibraryPermissionsAsync: async () => ({ granted: true }) },
};
// The chat's pieces (components/chat/) reach the same modules one folder down.
for (const [from, to] of [
  ['../../services/crypto', '../services/crypto'], ['../../services/api', '../services/api'],
  ['../ThemeContext', '../components/ThemeContext'], ['../Motion', '../components/Motion'],
  ['../Icon', '../components/Icon'], ['../Doodle', '../components/Doodle'], ['../../theme', '../theme'],
]) stubs[from] = stubs[to];

const { mergeMessage } = load('app/MessagesScreen.js', stubs);

console.log('=== A MESSAGE ARRIVES TWICE AND LANDS ONCE ===');
const posted = { id: 'm1', type: 'text', content: 'hello', sender_id: 'me', sent_at: '2026-01-01T10:00:00Z' };

// This is the exact sequence that produced the duplicate: the POST resolves,
// the screen appends, then the server's own broadcast comes back.
let list = [];
list = mergeMessage(list, posted);
list = mergeMessage(list, posted);
check('the socket echo does not duplicate the POST response', list.length === 1, list.length);
check('and the message survives', list[0].content === 'hello');

// The other order is just as likely — the socket is often faster than the
// HTTP response it was triggered by.
let raced = [];
raced = mergeMessage(raced, posted);        // socket first
raced = mergeMessage(raced, posted);        // POST resolves after
check('the reverse order is the same', raced.length === 1, raced.length);

console.log('\n=== BUT GENUINELY DIFFERENT MESSAGES ALL ARRIVE ===');
let thread = [];
for (const id of ['a', 'b', 'c']) thread = mergeMessage(thread, { ...posted, id });
check('three distinct messages make three entries', thread.length === 3, thread.length);
check('in the order they arrived', thread.map((m) => m.id).join('') === 'abc', thread.map((m) => m.id));

console.log('\n=== A REDELIVERY WITH NEWER FIELDS UPDATES IN PLACE ===');
// A seen receipt re-sends the row. It must not append, and must not discard
// the newer field either.
let seen = mergeMessage([], posted);
seen = mergeMessage(seen, { ...posted, seen_at: '2026-01-01T10:05:00Z' });
check('still one entry', seen.length === 1, seen.length);
check('and it carries the update', seen[0].seen_at === '2026-01-01T10:05:00Z', seen[0]);
check('without losing the original fields', seen[0].content === 'hello');

console.log('\n=== JUNK IS IGNORED RATHER THAN CRASHING THE THREAD ===');
const before = mergeMessage([], posted);
check('an undefined message is dropped', mergeMessage(before, undefined) === before);
check('so is a message with no id', mergeMessage(before, { content: 'x' }) === before);
check('the list is never mutated in place', before.length === 1 && before[0].id === 'm1');

console.log('\n=== THE SOURCE STILL GOES THROUGH THE MERGE ===');
// A plain [...prev, message] anywhere in this screen is the bug coming back.
const src = fs.readFileSync(path.join(root, 'app', 'MessagesScreen.js'), 'utf8');
const body = src.slice(src.indexOf('export default function MessagesScreen'));
check('no raw append survives in the screen', !/setMessages\(\(prev\) => \[\.\.\.prev,/.test(body),
  (body.match(/setMessages\([^)]*\)/g) || []).join(' | '));
const setters = body.match(/setMessages\(\(prev\) => mergeMessage\(prev, [^)]+\)\)/g) || [];
check('every delivery path merges (socket new and updated, send, edit, photo)',
  setters.length >= 5, setters.length);

console.log('\n=== AND THE THREAD SHOWS WHO SAID WHAT ===');
// Every bubble used to be alignSelf: 'flex-start' in one colour, which is
// most of why the screen read as unfinished.
check('a bubble is placed by sender', /item\.sender_id === meId/.test(body), 'no sender comparison');

console.log('\n=== AND THE THREAD IS ENCRYPTED ===');
// The failure that matters here is not a crash, it is a silent downgrade:
// sending plaintext while the composer still claims to be encrypted.
check('outgoing text is sealed when a partner key exists', /encryptFor\(partnerKey/.test(body));
check('and marked as encrypted for the server', /encrypted: true/.test(body));
// Decrypting moved into a hook the chat and shared items both use.
const decrypting = fs.readFileSync(path.join(root, 'components', 'chat', 'useDecrypted.js'), 'utf8');
const bubble = fs.readFileSync(path.join(root, 'components', 'chat', 'MessageBubble.js'), 'utf8');
check('incoming ciphertext is opened rather than shown raw',
  /useDecrypted\(messages, partnerKey\)/.test(body) && /decryptFrom\(partnerKey/.test(decrypting));
check('polls and places are sealed like texts', /type: 'poll', \.\.\.\(await seal\(plain\)\)/.test(body) && /type: 'location', \.\.\.\(await seal\(plain\)\)/.test(body));
check('a message that will not open says so instead of rendering blank',
  /keys don&apos;t match|keys don't match/.test(bubble));
check('and the composer states which mode is in force',
  /End-to-end encrypted/.test(body) && /Not encrypted yet/.test(body));
check('mine and theirs are styled apart', /mine\s*\?\s*\{ backgroundColor: colors\.accent/.test(bubble) && /: \{ backgroundColor: colors\.surface/.test(bubble));
check('and the id it compares against is fetched', /setMeId/.test(body));

console.log('\n=== THE CHAT, GROWN UP (Nextcloud Talk\'s features, for two) ===');
{
  const model = load('components/chat/chatModel.js', stubs);
  const me = 'me'; const them = 'them';
  const now = Date.parse('2026-10-06T10:00:00Z');
  const text = { id: 't', type: 'text', sender_id: me, sent_at: new Date(now - 3600e3).toISOString() };
  check('you can edit your own text for a day', model.canEdit(text, me, now));
  check('not theirs', !model.canEdit({ ...text, sender_id: them }, me, now));
  check('not after a day', !model.canEdit({ ...text, sent_at: new Date(now - 25 * 3600e3).toISOString() }, me, now));
  check('not a photo', !model.canEdit({ ...text, type: 'photo' }, me, now));
  check('a scheduled one, any time before it goes', model.canEdit({ ...text, sent_at: new Date(now - 30 * 3600e3).toISOString(), scheduled_for: 'x' }, me, now));
  check('only your own can be deleted', model.canDelete(text, me) && !model.canDelete({ ...text, sender_id: them }, me));

  const poll = { type: 'poll', meta: { optionCount: 3, multi: false }, votes: [{ userId: me, choice: 1 }, { userId: them, choice: 1 }, { userId: them, choice: 2 }] };
  const tally = model.pollTally(poll, me);
  check('a poll tallies each option, and which is yours', tally.options.map((o) => o.votes).join() === '0,2,1' && tally.options[1].mine && !tally.options[2].mine);
  check('and counts people, not votes', tally.voters === 2 && tally.voted);

  check('a reply quote says what it was', model.previewOf({ type: 'poll' }, JSON.stringify({ question: 'Dinner?' })) === 'Poll: Dinner?'
    && model.previewOf({ type: 'location' }, JSON.stringify({ lat: 1, lng: 2, label: 'Home' })) === 'Place: Home'
    && model.previewOf({ type: 'text', deleted_at: 'x' }, 'gone') === 'Message deleted'
    && model.previewOf(null) === 'Original message');

  const thread = [
    { id: 'a', type: 'text', content: 'Pizza tonight?', sender_id: them },
    { id: 'b', type: 'text', content: 'yes PIZZA', sender_id: me, seen_at: 'x' },
    { id: 'c', type: 'text', content: 'pizza', sender_id: me, deleted_at: 'x' },
    { id: 'd', type: 'text', content: 'later', sender_id: me, scheduled_for: 'x' },
  ];
  check('search finds every message with the words, whatever the case, never deleted ones',
    model.searchMatches(thread, (m) => m.content, 'pizza').join() === 'a,b');
  check('"Seen" goes under your last message they have seen (not a scheduled one)', model.lastSeenOwn(thread, me) === 'b');

  check('links are found in a text', model.linksIn('see https://example.com/a?b=1, and http://x.org.').join() === 'https://example.com/a?b=1,http://x.org');
  const parts = model.splitLinks('go to https://a.com now');
  check('and made tappable without losing the words around them', parts.length === 3 && parts[1].url === 'https://a.com' && parts.map((p) => p.text).join('') === 'go to https://a.com now');

  const morning = new Date(2026, 9, 6, 10, 0); // a Tuesday morning, phone time
  const later = model.laterChoices(morning);
  check('send later / remind me: in an hour, this evening, tomorrow, the weekend, next week',
    later.map((c) => c.key).join() === 'hour,evening,tomorrow,weekend,week' && later.every((c) => c.at > morning));
  check('this evening is gone once it is evening', !model.laterChoices(new Date(2026, 9, 6, 19, 0)).some((c) => c.key === 'evening'));
  check('a place opens in the phone\'s maps', model.mapsUrl({ lat: 1.5, lng: 2, label: 'Our café' }) === 'geo:1.5,2?q=1.5,2(Our%20caf%C3%A9)');

  const screen = load('app/MessagesScreen.js', stubs);
  const page = screen.prependPage([{ id: 'c' }, { id: 'd' }], [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  check('an older page goes in front, without doubling the overlap', page.map((m) => m.id).join() === 'a,b,c,d');

  const { pollFrom } = load('components/chat/PollComposer.js', stubs);
  check('a poll needs a question and two options', pollFrom('Q', ['a', ''], false) === null && pollFrom('', ['a', 'b'], false) === null);
  check('and drops the empty ones', pollFrom(' Q ', ['a', ' ', 'b'], true)?.options.join() === 'a,b');

  const shared = load('app/SharedItemsScreen.js', { ...stubs, '../components/chat/useDecrypted': () => ({ textOf: (m) => m.content }) });
  const sharedThread = [
    { id: 'p1', type: 'photo' }, { id: 'p2', type: 'photo', deleted_at: 'x' }, { id: 'l1', type: 'location' },
    { id: 't1', type: 'text', content: 'look https://a.com and https://b.com' }, { id: 'p3', type: 'photo', scheduled_for: 'x' },
  ];
  check('shared items: photos, newest first, nothing deleted or not yet sent',
    shared.sharedOf(sharedThread, 'photo', (m) => m.content).map((i) => i.id).join() === 'p1');
  check('and links pulled out of the texts', shared.sharedOf(sharedThread, 'link', (m) => m.content).map((i) => i.url).join() === 'https://a.com,https://b.com');

  const src2 = fs.readFileSync(path.join(root, 'app', 'MessagesScreen.js'), 'utf8');
  check('holding a message opens its menu; holding Send offers later and silent',
    /onLongPress=\{setMenuFor\}/.test(src2) && /setLaterFor\(\{ kind: 'send' \}\)/.test(src2) && /sendText\(\{ silent: true \}\)/.test(src2));
  check('"typing…" is sent, and shown', /emit\('chat:typing'/.test(src2) && /'typing…'/.test(src2));
  check('the thread is marked seen when it is open', /'\/messages\/seen', \{ method: 'POST' \}/.test(src2));
  check('older messages load as you scroll up', /&before=/.test(src2) && /maintainVisibleContentPosition/.test(src2));
}

console.log(`\nMESSAGES RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
