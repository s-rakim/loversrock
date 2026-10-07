// The AI room (Collaboration des Esprits) through the backend.
//
// Needs: the backend on :4000 started with ESPRITS_URL/ESPRITS_TOKEN pointing
// at a running Esprits, with a model seated (a stand-in for Free Claude Code
// will do: anything that answers /v1/messages), and the same two variables
// set for this test (default http://127.0.0.1:4399 and testtoken).
import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io } from 'socket.io-client';
import { handleFor, espritsToken, esprits, EspritsError } from '../src/models/esprits.js';
import { notificationsFor, startEspritsWatcher } from '../src/models/espritsWatcher.js';
import { fccLlmConfig, quizLlmConfig } from '../src/models/quizGenerator.js';

const API = 'http://localhost:4000';
const stamp = Date.now();
let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${JSON.stringify(d)}`); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(p, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data };
}
const signup = async (name) => {
  const u = { email: `esprits-${name.replace(/\s/g, '')}${stamp}@t.dev`, password: 'pw123456', name };
  const r = await req('/auth/signup', { method: 'POST', body: u });
  return { ...u, token: r.data.accessToken, id: r.data.user.id };
};

console.log('=== NAMES IN THE ROOM ===');
check('your first name, lower case', handleFor({ id: 'a1b2c3d4', name: 'Malcolm Rakim' }, { name: 'Hobi' }) === 'malcolm');
check('accents and symbols dropped', handleFor({ id: 'x', name: 'Zoë!' }, null) === 'zoe');
check('two of you with one name are told apart', handleFor({ id: 'abcd1234', name: 'Sam' }, { name: 'sam' }) === 'sam-abcd');
check('no name at all still gets one', handleFor({ id: 'x', name: '' }, null) === 'me');

console.log('\n=== THE TOKEN STAYS ON THE SERVER ===');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'esprits-'));
fs.writeFileSync(path.join(dir, 'token'), 'from-the-volume\n');
check('read from the file the esprits container made', espritsToken({ ESPRITS_TOKEN_FILE: path.join(dir, 'token') }, { fresh: true }) === 'from-the-volume');
check('ESPRITS_TOKEN wins when set', espritsToken({ ESPRITS_TOKEN: 'set', ESPRITS_TOKEN_FILE: path.join(dir, 'token') }) === 'set');
let down;
try { await esprits('/health', { env: { ESPRITS_URL: 'http://127.0.0.1:1' } }); } catch (err) { down = err; }
check('a room that is down is a sentence, not a crash', down instanceof EspritsError && /not answering/.test(down.message) && down.status === 503, down?.message);

console.log('\n=== DAILY CONTENT THROUGH FREE CLAUDE CODE ===');
const fcc = fccLlmConfig({ FCC_URL: 'http://host.docker.internal:8082/v1/' });
check('FCC is the anthropic provider at its address, with no key needed', fcc?.provider === 'anthropic' && fcc.baseUrl === 'http://host.docker.internal:8082' && Boolean(fcc.apiKey));
check('QUIZ_LLM_* in backend/.env still wins', quizLlmConfig({ QUIZ_LLM_PROVIDER: 'groq', QUIZ_LLM_API_KEY: 'k', QUIZ_LLM_MODEL: 'llama-3.3-70b-versatile', FCC_URL: 'http://x' }).provider === 'groq');
check('and with neither, the generator is off', quizLlmConfig({}) === null);

console.log('\n=== WHO GETS TOLD ===');
const people = [{ user_id: 'u1', handle: 'malcolm', name: 'Malcolm' }, { user_id: 'u2', handle: 'hobi', name: 'Hobi' }];
const sends = notificationsFor([
  { authorKind: 'system', kind: 'system', author: 'esprits', body: 'critic joined' },
  { authorKind: 'human', kind: 'message', author: 'malcolm', body: 'Dinner ideas?' },
  { authorKind: 'agent', kind: 'message', author: 'architect', body: 'x'.repeat(400) },
], people);
check('a person\'s message goes to the other person only', sends.filter((s) => s.title === 'Malcolm in the AI room').map((s) => s.userId).join() === 'u2');
check('a model\'s reply goes to both of you, shortened', sends.filter((s) => s.title === 'architect replied').length === 2 && sends.every((s) => s.body.length <= 140));
check('the room\'s own notices go to nobody', !sends.some((s) => /joined/.test(s.body)));

console.log('\n=== THROUGH THE BACKEND ===');
const A = await signup('Ana Test');
const B = await signup('Ben');
const C = await signup('Cal');
const inv = await req('/auth/invite', { method: 'POST', token: A.token, body: { deviceTimezone: 'UTC' } });
await req('/auth/invite/accept', { method: 'POST', token: B.token, body: { inviteCode: inv.data.inviteCode, deviceTimezone: 'UTC' } });

check('only for a pair', (await req('/esprits/status', { token: C.token })).status === 403);
check('and only when signed in', (await req('/esprits/status')).status === 401);

const status = await req('/esprits/status', { token: A.token });
check('the room is reachable, with its models and your name in it',
  status.status === 200 && status.data.reachable === true && status.data.me === 'ana' && status.data.seats.length >= 1, status.data);
check('ready when a model has a seat and FCC answers', status.data.ready === true && status.data.fcc.running === true, status.data);
check('and where its full pages are', /^http:\/\/localhost:\d+\/$/.test(status.data.webUrl), status.data.webUrl);

const sockB = io(API, { auth: { token: B.token }, transports: ['websocket'] });
await new Promise((r) => sockB.on('connect', r));
let nudged = 0;
sockB.on('esprits:new', () => { nudged += 1; });

const said = `What should we cook tonight ${stamp}?`;
const posted = await req('/esprits/post', { method: 'POST', token: A.token, body: { body: said, as: 'architect' } });
check('a message goes in under your own name, whatever the phone says', posted.status === 201 && posted.data.message.author === 'ana', posted.data);
check('an empty one does not', (await req('/esprits/post', { method: 'POST', token: A.token, body: { body: '  ' } })).status === 400);

let feed = null;
for (let i = 0; i < 20; i += 1) {
  // eslint-disable-next-line no-await-in-loop
  feed = (await req('/esprits/feed', { token: B.token })).data;
  if (feed.messages.some((m) => m.authorKind === 'agent' && m.id > posted.data.message.id)) break;
  // eslint-disable-next-line no-await-in-loop
  await wait(500);
}
const mine = feed.messages.find((m) => m.body === said);
check('your partner sees it, by the name you have in the app', mine && mine.name === 'Ana Test' && mine.mine === false, mine);
check('and the models answer it', feed.messages.some((m) => m.authorKind === 'agent' && m.id > posted.data.message.id), feed.messages.slice(-3));
const since = await req(`/esprits/feed?since=${feed.head}`, { token: A.token });
check('"since" gives only what is newer', since.status === 200 && since.data.messages.every((m) => m.id > feed.head));
const asA = (await req('/esprits/feed', { token: A.token })).data.messages.find((m) => m.body === said);
check('and on your own phone it is yours', asA?.mine === true);

const idea = await req('/esprits/ideas', { method: 'POST', token: B.token, body: { title: 'Plan our anniversary', raw: 'Somewhere by the sea' } });
check('an idea can be dropped', idea.status === 201, idea.data);
check('an idea needs a title', (await req('/esprits/ideas', { method: 'POST', token: B.token, body: { raw: 'x' } })).status === 400);
check('stop ends replies in progress', (await req('/esprits/stop', { method: 'POST', token: A.token })).status === 200);
const badConnect = await req('/esprits/connect', { method: 'POST', token: A.token, body: { baseURL: 'ftp://nope' } });
check('connect wants an http address', badConnect.status === 400);
const noFcc = await req('/esprits/connect', { method: 'POST', token: A.token, body: { baseURL: 'http://127.0.0.1:1/v1' } });
check('and says so when Free Claude Code is not there', noFcc.status === 400 && /not answering/.test(noFcc.data.error), noFcc.data);

console.log('\n=== NUDGES AND NOTIFICATIONS ===');
// The test's own watcher needs to know where the room is: the same place
// the backend was started with (ESPRITS_URL / ESPRITS_TOKEN for this test).
process.env.ESPRITS_URL ||= 'http://127.0.0.1:4399';
process.env.ESPRITS_TOKEN ||= 'testtoken';
const emitted = [];
const stop = startEspritsWatcher({ emit: (e, d) => emitted.push([e, d]) }, { everyMs: 200 });
await wait(400);
await req('/esprits/post', { method: 'POST', token: B.token, body: { body: 'and dessert?' } });
await wait(1500);
stop();
check('the watcher sees new messages and nudges the apps', emitted.some(([e]) => e === 'esprits:new'), emitted);
check('(and the backend\'s own watcher reached the open app)', nudged > 0, nudged);
sockB.disconnect();

console.log(`\nESPRITS RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
process.exit(0);
