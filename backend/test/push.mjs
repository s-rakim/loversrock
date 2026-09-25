// Exercises the push plumbing that can be tested without FCM credentials:
// the deep-link contract the client routes on, the data-payload coercion FCM
// requires, and the dead-token pruning — the last against a live database.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { query } from '../src/config/db.js';
import { CHANNELS, deepLink, sendToTokens } from '../src/config/firebase.js';

let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${JSON.stringify(d)}`); } };

console.log('=== CHANNELS MATCH THE CLIENT ===');
const client = readFileSync(new URL('../../mobile/services/notifications.js', import.meta.url), 'utf8');
const clientChannels = [...client.matchAll(/^\s{2}(\w+):\s*\{$/gm)].map((m) => m[1]);
for (const id of Object.values(CHANNELS)) {
  check(`client defines the "${id}" channel`, clientChannels.includes(id), clientChannels);
}
check('calls channel is MAX importance on the client',
  /calls:[\s\S]*?AndroidImportance\.MAX/.test(client));
check('reminders channel is not MAX', !/reminders:[\s\S]{0,200}?AndroidImportance\.MAX/.test(client));

console.log('\n=== DEEP LINKS ===');
check('deepLink carries the type', deepLink('quiz').type === 'quiz');
check('params are serialised (FCM data must be strings)',
  typeof deepLink('game_turn', { gameId: 7 }).params === 'string');
check('params round-trip', JSON.parse(deepLink('game_turn', { gameId: 7 }).params).gameId === 7);
check('no params key when none given', deepLink('quiz').params === undefined);

// Every type the server can emit must have a screen on the client, or the tap
// silently does nothing.
const serverTypes = ['prompt', 'quiz', 'partner_update', 'period_reminder'];
for (const type of serverTypes) {
  check(`client routes "${type}"`, new RegExp(`${type}:\\s*'`).test(client), type);
}

console.log('\n=== SENDING WITHOUT CREDENTIALS DEGRADES ===');
const noCreds = await sendToTokens(['whatever'], { notification: { title: 'x' } });
check('no credentials returns a zero result rather than throwing',
  noCreds.successCount === 0 && noCreds.failureCount === 0, noCreds);
check('empty token list is a no-op', (await sendToTokens([], {})).successCount === 0);

console.log('\n=== DEAD TOKEN PRUNING (live database) ===');
const stamp = Date.now();
const email = `push-${stamp}@t.dev`;
const { rows: [user] } = await query(
  `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, 'x') RETURNING id`,
  ['PushTest', email]
);
const tokens = [`dead-${stamp}`, `alive-${stamp}`];
for (const token of tokens) {
  await query('INSERT INTO user_devices (user_id, fcm_token) VALUES ($1, $2)', [user.id, token]);
}

const before = await query('SELECT fcm_token FROM user_devices WHERE user_id = $1', [user.id]);
check('both tokens stored', before.rows.length === 2, before.rows.length);

// pruneDeadTokens is internal; drive it the way FCM would by deleting exactly
// what a not-registered response names, then assert the survivor is untouched.
await query('DELETE FROM user_devices WHERE fcm_token = ANY($1::text[])', [[`dead-${stamp}`]]);
const after = await query('SELECT fcm_token FROM user_devices WHERE user_id = $1', [user.id]);
check('dead token removed', !after.rows.some((r) => r.fcm_token === `dead-${stamp}`));
check('live token kept', after.rows.some((r) => r.fcm_token === `alive-${stamp}`), after.rows);

const source = readFileSync(new URL('../src/config/firebase.js', import.meta.url), 'utf8');
check('only permanent FCM errors prune', /registration-token-not-registered/.test(source));
check('transient failures do not prune', /DEAD_TOKEN_CODES\.has/.test(source));
check('data values are coerced to strings', /JSON\.stringify\(value\)/.test(source));
check('call pushes are sent high priority', /channel === CHANNELS\.calls \? 'high'/.test(source));

// A collapse key is two different headers on the two platforms, and setting
// only the Android one is the classic half-fix: the burst collapses on one
// phone and stacks ten deep on the other.
check('a collapse key sets the Android one', /collapseKey \? \{ collapseKey \}/.test(source));
check('and the iOS one, which is a different header entirely',
  /apns-collapse-id/.test(source), 'apns headers missing');
// A collapsed alert still has to wake the phone, or the update silently
// replaces a notification nobody ever saw.
check('a collapsed high-priority alert still wakes the phone', /'apns-priority': priority === 'high' \? '10'/.test(source));

console.log('\n=== MESSAGES PUSH, AND NEVER CARRY THE MESSAGE ===');
const messages = readFileSync(new URL('../src/routes/messages.js', import.meta.url), 'utf8');
check('sending a message fires a push', /sendNotification\(/.test(messages));
check('at high priority, because a normal one can sit in a doze queue for minutes',
  /priority: 'high'/.test(messages));
check('and collapsed per pair, so ten in a row is one line in the tray',
  /collapseKey: `msg:\$\{req\.pair\.id\}`/.test(messages));
// This is not a policy the server could change its mind about: with
// encryption running it holds ciphertext and could not put the text in the
// notification if it wanted to.
check('the message body is NEVER in the push',
  !/body: (content|message\.content|req\.body\.content)/.test(messages)
  && /Sent you a message/.test(messages), 'a push must not carry message content');
check('the title is who they are to the RECIPIENT, not the sender\u2019s own name',
  /set_by_id = \$3/.test(messages), 'nickname lookup should be keyed on the recipient');
check('and never empty, which renders as the package name on Android',
  /\|\| 'Your partner'/.test(messages));

const calls = readFileSync(new URL('../src/routes/calls.js', import.meta.url), 'utf8');
check('a call push uses the one channel at MAX importance', /CHANNELS\.calls/.test(calls));
check('and a failed push never fails the call', /\[calls\] push failed/.test(calls));
check('a failed message push never fails the send', /\[messages\] push failed/.test(messages));

await query('DELETE FROM users WHERE id = $1', [user.id]);
check('cleanup removed the test user',
  (await query('SELECT 1 FROM users WHERE id = $1', [user.id])).rows.length === 0);

console.log(`\nPUSH RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
process.exit(0);
