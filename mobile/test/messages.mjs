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
  };

  const module_ = { exports: {} };
  const fakeRequire = (id) => {
    if (id === 'react') return React;
    if (id === 'react-native') return rn;
    if (extraStubs[id]) return extraStubs[id];
    if (id.startsWith('.')) {
      const resolved = path.join(path.dirname(relative), id);
      return load(resolved.endsWith('.js') ? resolved : `${resolved}.js`, extraStubs);
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
check('all three delivery paths merge (socket, text send, photo send)',
  setters.length === 3, setters.length);

console.log('\n=== AND THE THREAD SHOWS WHO SAID WHAT ===');
// Every bubble used to be alignSelf: 'flex-start' in one colour, which is
// most of why the screen read as unfinished.
check('a bubble is placed by sender', /item\.sender_id === meId/.test(body), 'no sender comparison');
check('mine and theirs are styled apart', /styles\.mine/.test(body) && /styles\.theirs/.test(body));
check('and the id it compares against is fetched', /setMeId/.test(body));

console.log(`\nMESSAGES RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
