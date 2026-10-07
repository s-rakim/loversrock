// Fable, the group chat between the two of you and an AI model: the setup
// page (your own keys, sealed; the model; the test button) and the chat
// itself (who sees what, when the AI answers, what it is told, and what
// happens when the provider says no).
//
// Against a live backend (npm start) and database. The "AI" is a stand-in
// OpenAI-compatible server started here, so no key is spent; the backend
// must be able to reach it at FABLE_FAKE_HOST (default 127.0.0.1, i.e. a
// backend running on this machine, not in Docker).
import 'dotenv/config';
import http from 'node:http';
import { query, pool } from '../src/config/db.js';

const API = process.env.API_URL || 'http://localhost:4000';
const FAKE_HOST = process.env.FABLE_FAKE_HOST || '127.0.0.1';
const stamp = Date.now();
let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${JSON.stringify(d)}`); } };

async function req(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data };
}
const signup = async (name) => {
  const u = { email: `fable-${name}${stamp}@t.dev`, password: 'pw123456', name };
  const r = await req('/auth/signup', { method: 'POST', body: u });
  return { ...u, token: r.data.accessToken, id: r.data.user.id };
};
const waitFor = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 150)); }
  return null;
};

// ------------------------------------------------------- the stand-in AI
const asked = [];
let behaviour = 'ok';
const fake = http.createServer((q, s) => {
  let raw = '';
  q.on('data', (c) => { raw += c; });
  q.on('end', () => {
    s.setHeader('content-type', 'application/json');
    // The provider's list of models, as every OpenAI-compatible API has.
    if (q.method === 'GET' && q.url.endsWith('/models')) {
      return s.end(JSON.stringify({ data: ['test-model', 'busy-model', 'backup-model', 'text-embedding-3-small', 'tts-1'].map((id) => ({ id })) }));
    }
    const payload = JSON.parse(raw || '{}');
    asked.push({ auth: q.headers.authorization, payload });
    // One model overloaded, one retired: the others answer.
    if (payload.model === 'busy-model') { s.statusCode = 503; return s.end(JSON.stringify({ error: { message: 'The model is overloaded' } })); }
    if (payload.model === 'retired-model') { s.statusCode = 404; return s.end(JSON.stringify({ error: { message: 'The model retired-model does not exist' } })); }
    if (behaviour === 'badkey') { s.statusCode = 401; return s.end(JSON.stringify({ error: { message: 'Incorrect API key provided' } })); }
    if (behaviour === 'limit') { s.statusCode = 429; return s.end(JSON.stringify({ error: { message: 'Resource exhausted' } })); }
    const n = asked.length;
    s.end(JSON.stringify({ choices: [{ message: { content: `Robo: Hello you two, reply ${n}!` } }] }));
  });
});
await new Promise((r) => fake.listen(0, '0.0.0.0', r));
const FAKE_URL = `http://${FAKE_HOST}:${fake.address().port}/v1`;
const KEY = `sk-test-${stamp}-abcd1234`;

const A = await signup('Ana');
const B = await signup('Ben');
const C = await signup('Cal');
const invite = await req('/auth/invite', { method: 'POST', token: A.token, body: { deviceTimezone: 'UTC' } });
await req('/auth/invite/accept', { method: 'POST', token: B.token, body: { inviteCode: invite.data.inviteCode, deviceTimezone: 'UTC' } });
const pairId = (await query('SELECT id FROM pairs WHERE user_a_id = $1', [A.id])).rows[0].id;

console.log('=== THE SETUP PAGE, BEFORE ANYTHING IS SET ===');
const fresh = await req('/fable/settings', { token: A.token });
check('not saved yet, and not ready', fresh.status === 200 && fresh.data.saved === false && fresh.data.ready === false, fresh.data);
check('the providers are offered, free ones included', fresh.data.providers.some((p) => p.id === 'gemini' && p.free && p.keyUrl), fresh.data.providers?.map((p) => p.id));
check('defaults to Gemini', fresh.data.settings.provider === 'gemini' && fresh.data.settings.botName === 'Fable', fresh.data.settings);
const unpairedLook = await req('/fable/settings', { token: C.token });
check('someone without a partner cannot reach it', unpairedLook.status === 403 || unpairedLook.status === 409 || unpairedLook.status === 400, unpairedLook.status);
const emptyChat = await req('/fable/messages', { token: A.token });
check('the chat says it is not set up', emptyChat.data.ready === false && emptyChat.data.messages.length === 0, emptyChat.data);

console.log('\n=== YOUR OWN KEYS ===');
check('a scrap of text is not accepted as a key', (await req('/fable/keys/custom', { method: 'PUT', token: A.token, body: { apiKey: 'abc' } })).status === 400);
check('nor is a key with a space in it', (await req('/fable/keys/custom', { method: 'PUT', token: A.token, body: { apiKey: 'sk-abc def-12345' } })).status === 400);
check('nor a provider that does not exist', (await req('/fable/keys/skynet', { method: 'PUT', token: A.token, body: { apiKey: KEY } })).status === 400);
const saved = await req('/fable/keys/custom', { method: 'PUT', token: A.token, body: { apiKey: KEY } });
check('a real-looking key is saved', saved.status === 200 && saved.data.keys.some((k) => k.provider === 'custom'), saved.data);
check('only a hint comes back, never the key', saved.data.keys[0].hint === '…1234' && !JSON.stringify(saved.data).includes(KEY), saved.data.keys);
await req('/fable/keys/groq', { method: 'PUT', token: B.token, body: { apiKey: 'gsk_second-key-9999' } });
const both = await req('/fable/settings', { token: B.token });
check('a key per provider, from either of you', both.data.keys.length === 2 && both.data.keys.some((k) => k.addedBy === 'Ben'), both.data.keys);
check('the settings page never carries a key either', !JSON.stringify(both.data).includes(KEY) && !JSON.stringify(both.data).includes('second-key'));
const stored = (await query('SELECT key_enc FROM ai_keys WHERE pair_id = $1 AND provider = $2', [pairId, 'custom'])).rows[0].key_enc;
check('the database holds it sealed, not as text', stored.startsWith('v1:') && !stored.includes(KEY), stored.slice(0, 12));
const gone = await req('/fable/keys/groq', { method: 'DELETE', token: A.token });
check('a key can be removed', gone.data.keys.length === 1, gone.data.keys);

console.log('\n=== CHOOSING THE MODEL, AND THE TEST BUTTON ===');
const tts = await req('/fable/settings', { method: 'PUT', token: A.token, body: { source: 'key', provider: 'custom', baseUrl: FAKE_URL, model: 'gemini-9-flash-tts' } });
check('a speech model is saved but explained, not "ready"', tts.status === 200 && tts.data.ready === false && /text-to-speech/.test(tts.data.problem), tts.data);
check('a bad address is refused', (await req('/fable/settings', { method: 'PUT', token: A.token, body: { baseUrl: 'ftp://nope' } })).status === 400);
const set = await req('/fable/settings', {
  method: 'PUT', token: A.token,
  body: { source: 'key', provider: 'custom', baseUrl: FAKE_URL, model: 'test-model', botName: 'Robo', persona: 'Talk like a pirate.', replyMode: 'always' },
});
check('a working setup is ready', set.status === 200 && set.data.ready === true && set.data.settings.botName === 'Robo', set.data);
check('it says who set it up', set.data.settings.updatedBy === 'Ana', set.data.settings);
const tried = await req('/fable/test', { method: 'POST', token: B.token, body: {} });
check('the test button gets a hello back', tried.status === 200 && tried.data.ok && /Hello you two/.test(tried.data.reply), tried.data);
check('with the name stripped off the front', !/^Robo:/.test(tried.data.reply), tried.data.reply);
check('and it used the saved key', asked.at(-1).auth === `Bearer ${KEY}`, asked.at(-1).auth);
await req('/fable/test', { method: 'POST', token: B.token, body: { apiKey: 'sk-typed-on-page-5678' } });
check('a key typed on the page is tried before it is saved', asked.at(-1).auth === 'Bearer sk-typed-on-page-5678', asked.at(-1).auth);
const noKey = await req('/fable/test', { method: 'POST', token: B.token, body: { provider: 'openrouter', model: 'x/y' } });
check('a provider with no key says to add one', noKey.status === 400 && /Add a OpenRouter API key/.test(noKey.data.error), noKey.data);

console.log('\n=== THE CHAT ===');
const before = asked.length;
const sentA = await req('/fable/messages', { method: 'POST', token: A.token, body: { body: 'What should we cook tonight?' } });
check('a message is accepted, and the AI will answer', sentA.status === 201 && sentA.data.aiReplying === true && sentA.data.message.mine === true, sentA.data);
const answered = await waitFor(async () => {
  const r = await req('/fable/messages', { token: B.token });
  return r.data.messages.find((m) => m.authorKind === 'ai') ? r.data : null;
});
check('the AI answers in the chat', Boolean(answered), answered);
const ai = answered?.messages.find((m) => m.authorKind === 'ai');
check('under its own name', ai?.author === 'Robo' && /^Hello you two/.test(ai?.body), ai);
const fromA = answered?.messages.find((m) => m.authorKind === 'user');
check('the partner sees who wrote what, and that it is not theirs', fromA?.author === 'Ana' && fromA?.mine === false, fromA);
const call = asked[before]?.payload;
check('the model is told both of your names', /Ana/.test(call?.messages?.[0]?.content) && /Ben/.test(call?.messages?.[0]?.content), call?.messages?.[0]?.content);
check('and the personality you gave it', /pirate/.test(call?.messages?.[0]?.content));
check('and the conversation, labelled by who said it', /Ana: What should we cook tonight\?/.test(call?.messages?.[1]?.content), call?.messages?.[1]?.content);
check('using the model you chose', call?.model === 'test-model', call?.model);

await req('/fable/messages', { method: 'POST', token: B.token, body: { body: 'Pasta?' } });
await waitFor(async () => (await req('/fable/messages', { token: A.token })).data.messages.filter((m) => m.authorKind === 'ai').length >= 2);
const second = asked.at(-1).payload.messages[1].content;
check('the next question sees the whole thread, its own reply included', /Ana: What should we cook/.test(second) && /Robo: Hello you two/.test(second) && /Ben: Pasta\?/.test(second), second);

const latest = await req('/fable/messages', { token: A.token });
const lastId = latest.data.messages.at(-1).id;
const none = await req(`/fable/messages?since=${lastId}`, { token: A.token });
check('"since" returns only what is new', none.data.messages.length === 0, none.data);
check('an empty message is refused', (await req('/fable/messages', { method: 'POST', token: A.token, body: { body: '   ' } })).status === 400);
check('someone outside the pair sees nothing', (await req('/fable/messages', { token: C.token })).status !== 200);

console.log('\n=== ONLY WHEN NAMED ===');
await req('/fable/settings', { method: 'PUT', token: B.token, body: { replyMode: 'mention' } });
const quiet = await req('/fable/messages', { method: 'POST', token: A.token, body: { body: 'love you' } });
check('a message not naming it gets no reply', quiet.data.aiReplying === false, quiet.data);
const loud = await req('/fable/messages', { method: 'POST', token: A.token, body: { body: 'hey @robo, a film for tonight?' } });
check('@name anywhere gets one', loud.data.aiReplying === true, loud.data);
const lead = await req('/fable/messages', { method: 'POST', token: B.token, body: { body: 'Robo, settle this' } });
check('so does starting with its name', lead.data.aiReplying === true, lead.data);
const notName = await req('/fable/messages', { method: 'POST', token: B.token, body: { body: 'Robotics is fun' } });
check('but not a word that merely starts with it', notName.data.aiReplying === false, notName.data);
await waitFor(async () => (await req('/fable/messages', { token: A.token })).data.thinking === false);

console.log('\n=== THE MODELS YOUR KEY CAN USE ===');
const listed = await req('/fable/models', { method: 'POST', token: A.token, body: { provider: 'custom', baseUrl: FAKE_URL } });
check('the provider is asked which models there are', listed.status === 200 && listed.data.models.includes('test-model') && listed.data.models.includes('backup-model'), listed.data);
check('only chat models: no embeddings, no speech', !listed.data.models.some((m) => /embedding|tts/.test(m)), listed.data.models);
check('with a half-typed model in the box, the list still comes', (await req('/fable/models', { method: 'POST', token: A.token, body: { provider: 'custom', baseUrl: FAKE_URL, model: 'gemini-tts' } })).status === 200);

console.log('\n=== A BUSY OR RETIRED MODEL: ANOTHER ONE ANSWERS ===');
await req('/fable/settings', { method: 'PUT', token: A.token, body: { model: 'busy-model', replyMode: 'always' } });
const stoodIn = await req('/fable/test', { method: 'POST', token: A.token, body: {} });
check('the test still gets a hello when the chosen model is busy', stoodIn.status === 200 && stoodIn.data.ok && /Hello/.test(stoodIn.data.reply), stoodIn.data);
check('  and says which model stood in, and why', stoodIn.data.fallback?.from === 'busy-model' && stoodIn.data.fallback?.to === 'backup-model'
  && /busy/.test(stoodIn.data.fallback?.why) && stoodIn.data.model === 'backup-model', stoodIn.data);
const busyChat = await req('/fable/messages', { method: 'POST', token: A.token, body: { body: 'Are you there?' } });
const busyAnswer = await waitFor(async () => {
  const r = await req(`/fable/messages?since=${busyChat.data.message.id}`, { token: A.token });
  return r.data.messages.find((m) => m.authorKind !== 'user');
}, 20000);
check('the chat gets an answer, not "could not answer"', busyAnswer?.authorKind === 'ai', busyAnswer);
check('  and the busy model stays chosen (it is only busy)', (await req('/fable/settings', { token: A.token })).data.settings.model === 'busy-model');

await req('/fable/settings', { method: 'PUT', token: A.token, body: { model: 'retired-model' } });
const retiredChat = await req('/fable/messages', { method: 'POST', token: A.token, body: { body: 'Still there?' } });
const retiredAnswer = await waitFor(async () => {
  const r = await req(`/fable/messages?since=${retiredChat.data.message.id}`, { token: A.token });
  return r.data.messages.find((m) => m.authorKind !== 'user');
}, 20000);
check('a model that no longer exists: another answers', retiredAnswer?.authorKind === 'ai', retiredAnswer);
const healed = (await req('/fable/settings', { token: A.token })).data.settings.model;
check('  and the setup moves onto it, so the next message need not search', healed === 'backup-model', healed);
await req('/fable/settings', { method: 'PUT', token: A.token, body: { model: 'test-model', replyMode: 'mention' } });
await waitFor(async () => (await req('/fable/messages', { token: A.token })).data.thinking === false);

console.log('\n=== WHEN THE PROVIDER SAYS NO ===');
behaviour = 'badkey';
await req('/fable/messages', { method: 'POST', token: A.token, body: { body: '@Robo hello?' } });
const refused = await waitFor(async () => (await req('/fable/messages', { token: A.token })).data.messages.find((m) => m.authorKind === 'system'));
check('the chat says the key was refused, in words', /Robo could not answer: .*refused the API key/.test(refused?.body), refused);
behaviour = 'limit';
const limited = await req('/fable/test', { method: 'POST', token: A.token, body: {} });
check('a free-tier limit is explained as one', limited.status === 400 && /limit was reached/.test(limited.data.error), limited.data);
behaviour = 'ok';

console.log('\n=== THE SERVER\'S OWN AI ===');
const server = await req('/fable/settings', { method: 'PUT', token: A.token, body: { source: 'server' } });
const hasServer = Boolean(process.env.QUIZ_LLM_PROVIDER);
check('choosing the server\'s AI works when backend/.env has one, and says so when not',
  hasServer ? server.data.ready === true : (server.data.ready === false && /backend\/.env/.test(server.data.problem)), server.data);
await req('/fable/settings', { method: 'PUT', token: A.token, body: { source: 'key' } });

console.log('\n=== YOUR KEY FOR THE DAILY CONTENT TOO ===');
const { refreshSharedAiConfig } = await import('../src/models/fableAi.js');
const { getSharedAiConfig } = await import('../src/models/aiShared.js');
await refreshSharedAiConfig();
check('with "also use it for daily content" on, the key is lent to the quiz and prompts',
  getSharedAiConfig()?.provider === 'custom' && getSharedAiConfig()?.apiKey === KEY, getSharedAiConfig()?.provider);
await req('/fable/settings', { method: 'PUT', token: A.token, body: { useForContent: false } });
await refreshSharedAiConfig();
check('and turned off, it is not', getSharedAiConfig()?.apiKey !== KEY);

console.log('\n=== CLEARING UP ===');
check('the chat can be cleared', (await req('/fable/messages', { method: 'DELETE', token: B.token })).status === 200
  && (await req('/fable/messages', { token: A.token })).data.messages.length === 0);
check('turning Fable off keeps the keys', (await req('/fable/settings', { method: 'DELETE', token: A.token })).status === 200
  && (await req('/fable/settings', { token: A.token })).data.keys.length === 1);

await query('DELETE FROM users WHERE id = ANY($1)', [[A.id, B.id, C.id]]);
fake.close();
await pool.end();
console.log(`\nFABLE RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
fails.forEach((f) => console.log(`  - ${f}`));
process.exit(fails.length ? 1 : 0);
