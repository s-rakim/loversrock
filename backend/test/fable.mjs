// Fable, the group chat between the two of you and an AI model: its
// connections (Collaboration des Esprits' connection layer: any address, the
// key cleaned and sealed, Find, the pasted example, the test button) and the
// chat itself (who sees what, when the AI answers, what it is told, and what
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
// Speaks both shapes under /v1 only (so a missing /v1 has to be repaired),
// and treats keys the way Google does: one it does not know is a 400 that
// says "Please pass a valid API key", the error Fable showed before.
const asked = [];
let behaviour = 'ok';
const VALID = new Set();
const fake = http.createServer((q, s) => {
  let raw = '';
  q.on('data', (c) => { raw += c; });
  q.on('end', () => {
    s.setHeader('content-type', 'application/json');
    const path = q.url.split('?')[0];
    if (!path.startsWith('/v1/')) { s.statusCode = 404; return s.end('{"error":"not here"}'); }
    const key = q.headers['x-api-key'] || String(q.headers.authorization || '').replace(/^Bearer /, '');
    if (behaviour === 'badkey') { s.statusCode = 401; return s.end(JSON.stringify({ error: { message: 'Incorrect API key provided' } })); }
    if (!VALID.has(key)) {
      s.statusCode = 400;
      return s.end(JSON.stringify([{ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }]));
    }
    if (q.method === 'GET' && path === '/v1/models') {
      return s.end(JSON.stringify({ data: ['test-model', 'busy-model', 'backup-model', 'text-embedding-3-small', 'tts-1'].map((id) => ({ id })) }));
    }
    const payload = JSON.parse(raw || '{}');
    asked.push({ path, auth: q.headers.authorization, xKey: q.headers['x-api-key'], payload });
    // One model overloaded, the ones it never had or retired unknown: the others answer.
    if (payload.model === 'busy-model') { s.statusCode = 503; return s.end(JSON.stringify({ error: { message: 'The model is overloaded' } })); }
    if (!['test-model', 'backup-model', 'claude-x'].includes(payload.model)) {
      s.statusCode = 404; return s.end(JSON.stringify({ error: { message: `models/${payload.model} is not found for API version v1beta` } }));
    }
    if (behaviour === 'limit') { s.statusCode = 429; return s.end(JSON.stringify({ error: { message: 'Resource exhausted' } })); }
    const text = payload.max_tokens === 1 ? 'H' : `Robo: Hello you two, reply ${asked.length}!`;
    if (path === '/v1/messages') return s.end(JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn' }));
    s.end(JSON.stringify({ choices: [{ message: { content: text } }] }));
  });
});
await new Promise((r) => fake.listen(0, '0.0.0.0', r));
const FAKE_ROOT = `http://${FAKE_HOST}:${fake.address().port}`;
const FAKE_URL = `${FAKE_ROOT}/v1`;
const KEY = `AIzaSyTest${stamp}abcd1234`;
const KEY2 = `gsk_second${stamp}9999`;
const KEY3 = `sk-ant-third${stamp}7777`;
[KEY, KEY2, KEY3].forEach((k) => VALID.add(k));

const A = await signup('Ana');
const B = await signup('Ben');
const C = await signup('Cal');
const invite = await req('/auth/invite', { method: 'POST', token: A.token, body: { deviceTimezone: 'UTC' } });
await req('/auth/invite/accept', { method: 'POST', token: B.token, body: { inviteCode: invite.data.inviteCode, deviceTimezone: 'UTC' } });
const pairId = (await query('SELECT id FROM pairs WHERE user_a_id = $1', [A.id])).rows[0].id;
const conn = (data, name) => data?.connections?.find((c) => c.name === name);

console.log('=== THE SETUP PAGE, BEFORE ANYTHING IS SET ===');
const fresh = await req('/fable/settings', { token: A.token });
check('not saved yet, and not ready', fresh.status === 200 && fresh.data.saved === false && fresh.data.ready === false, fresh.data);
check('presets are offered, free ones first, with where to get a key',
  fresh.data.presets[0].preset === 'Google Gemini' && fresh.data.presets[0].free && /aistudio/.test(fresh.data.presets[0].keyUrl), fresh.data.presets?.[0]);
check('Google\'s preset points at its OpenAI-compatible address', fresh.data.presets[0].baseURL.endsWith('/v1beta/openai'), fresh.data.presets[0].baseURL);
const fcc = fresh.data.presets.find((p) => /Free Claude Code/.test(p.preset));
check('Free Claude Code is a preset to pick, only "when running", needing no key', fcc && /when running/.test(fcc.preset) && fcc.keyOptional, fcc);
check('and nothing is chosen for you: no connection by default', fresh.data.settings.connection === null && fresh.data.connections.length === 0, fresh.data.settings);
const unpairedLook = await req('/fable/settings', { token: C.token });
check('someone without a partner cannot reach it', [400, 403, 409].includes(unpairedLook.status), unpairedLook.status);
const emptyChat = await req('/fable/messages', { token: A.token });
check('the chat says it is not set up', emptyChat.data.ready === false && emptyChat.data.messages.length === 0, emptyChat.data);

console.log('\n=== A CONNECTION: ANY ADDRESS, THE KEY CLEANED AND SEALED ===');
check('a scrap of text is not accepted as a key', (await req('/fable/connections/Gem', { method: 'PUT', token: A.token, body: { baseURL: FAKE_ROOT, apiKey: 'abc' } })).status === 400);
check('nor an address that is not http(s)', (await req('/fable/connections/Gem', { method: 'PUT', token: A.token, body: { baseURL: 'ftp://nope' } })).status === 400);
check('nor a name with a slash in it', (await req(`/fable/connections/${encodeURIComponent('a/b')}`, { method: 'PUT', token: A.token, body: { baseURL: FAKE_ROOT } })).status === 400);
// Pasted the way people paste: the whole header line from the example, and
// the model from the error message, which this endpoint has never served.
const saved = await req('/fable/connections/Gem', {
  method: 'PUT', token: A.token,
  body: { baseURL: FAKE_ROOT, apiKey: `  "Authorization": "Bearer ${KEY}",`, model: 'gemini-3-flash', use: true },
});
const gem = conn(saved.data, 'Gem');
check('it is saved', saved.status === 200 && Boolean(gem), saved.data);
check('the key is cut out of the line it was pasted in: its length and last four show it', gem?.keyLength === KEY.length && gem?.keyPreview === `••••••••${KEY.slice(-4)}`, gem);
check('never the key itself', !JSON.stringify(saved.data).includes(KEY));
const stored = (await query('SELECT key_enc FROM ai_connections WHERE pair_id = $1 AND name = $2', [pairId, 'Gem'])).rows[0].key_enc;
check('the database holds it sealed, not as text', stored.startsWith('v1:') && !stored.includes(KEY), stored.slice(0, 12));
const chosen = await req('/fable/settings', { token: B.token });
check('"use" made it Fable\'s, for both of you', chosen.data.settings.connection === 'Gem' && chosen.data.settings.updatedBy === 'Ana', chosen.data.settings);
await req('/fable/connections/Gem', { method: 'PUT', token: B.token, body: { baseURL: FAKE_ROOT } });
check('re-saving a row without a key keeps the key', conn((await req('/fable/settings', { token: A.token })).data, 'Gem')?.keyLength === KEY.length);

console.log('\n=== FIND: THE ADDRESS REPAIRED, THE REAL MODELS, THE KEY PROVED ===');
const found = await req('/fable/connections/Gem/find', { method: 'POST', token: A.token, body: {} });
check('Find works it out', found.status === 200 && found.data.ok === true, found.data);
check('  the missing /v1 is put back', found.data.baseURL === FAKE_URL && found.data.changed === true, found.data.baseURL);
check('  the model it never had is dropped, and says so', found.data.clearedModel === 'gemini-3-flash' && found.data.model !== 'gemini-3-flash', found.data);
check('  only chat models are listed: no embeddings, no speech', found.data.models.includes('test-model') && !found.data.models.some((m) => /embedding|tts/.test(m)), found.data.models);
check('  and the key is proved on one that answers', found.data.key.ok === true && ['backup-model', 'test-model'].includes(found.data.model), found.data.key);
check('  with the cleaned key, not the pasted line', asked.at(-1).auth === `Bearer ${KEY}`, asked.at(-1).auth);
const after = conn((await req('/fable/settings', { token: A.token })).data, 'Gem');
check('the repaired address and the model are saved', after.baseURL === FAKE_URL && after.model === found.data.model, after);

console.log('\n=== A KEY THE SERVICE REFUSES ===');
await req('/fable/connections/Wrong', { method: 'PUT', token: A.token, body: { baseURL: FAKE_URL, apiKey: 'AIzaSyWrongKey-cut-off0000' } });
const refusedFind = await req('/fable/connections/Wrong/find', { method: 'POST', token: A.token, body: {} });
check('Find says the address is right but the key was refused (Google\'s 400 included)',
  refusedFind.status === 400 && /right address, but the key was refused/.test(refusedFind.data.error) && /valid API key/.test(refusedFind.data.error), refusedFind.data);
check('  and what was sent, so a cut-off key shows itself', /sent 26 characters ending "0000"/.test(refusedFind.data.error), refusedFind.data.error);
const refusedTest = await req('/fable/connections/Wrong/test', { method: 'POST', token: A.token, body: {} });
check('Test on a row with no model says to press Find', refusedTest.status === 400 && /Press Find/.test(refusedTest.data.error), refusedTest.data);
await req('/fable/connections/Wrong', { method: 'DELETE', token: A.token });

console.log('\n=== PASTE THE EXAMPLE ===');
const curl = `curl "${FAKE_URL}/chat/completions" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${KEY2}" \\
  -d '{"model": "backup-model", "max_tokens": 1024, "messages": [{"role": "user", "content": "Hello"}]}'`;
const pasted = await req('/fable/connections/from-snippet', { method: 'POST', token: A.token, body: { snippet: curl, name: 'Pasted', use: false } });
check('a curl example is read: address, model, and how much key arrived',
  pasted.status === 200 && pasted.data.found.baseURL === FAKE_URL && pasted.data.found.model === 'backup-model'
  && pasted.data.found.key === `${KEY2.length} characters ending "9999"`, pasted.data);
check('  and checked straight away', pasted.data.check?.ok === true && pasted.data.check.model === 'backup-model', pasted.data.check);
check('  the parameter name comes along too', conn(pasted.data, 'Pasted')?.extra?.tokenParam === 'max_tokens', conn(pasted.data, 'Pasted'));
check('  never the key in the answer', !JSON.stringify(pasted.data).includes(KEY2));
check('  "use: false" leaves Fable on its connection', (await req('/fable/settings', { token: A.token })).data.settings.connection === 'Gem');
const placeholder = await req('/fable/connections/from-snippet', { method: 'POST', token: A.token, body: { snippet: 'client = OpenAI(base_url="https://integrate.api.nvidia.com/v1", api_key="$NVIDIA_API_KEY")', use: false } });
check('a placeholder is not taken for a key', placeholder.status === 200 && placeholder.data.found.key === null && placeholder.data.name === 'nvidia', placeholder.data.found);
await req('/fable/connections/nvidia', { method: 'DELETE', token: A.token });
check('nothing at all is refused in words', /Nothing in that looked like/.test((await req('/fable/connections/from-snippet', { method: 'POST', token: A.token, body: { snippet: 'hello there' } })).data.error));

console.log('\n=== ANTHROPIC\'S SHAPE (CLAUDE, OR FREE CLAUDE CODE WHEN IT RUNS) ===');
const anth = `curl ${FAKE_URL}/messages -H "x-api-key: ${KEY3}" -H "anthropic-version: 2023-06-01" -H "content-type: application/json" -d '{"model": "claude-x", "max_tokens": 1024, "messages": []}'`;
const claude = await req('/fable/connections/from-snippet', { method: 'POST', token: A.token, body: { snippet: anth, name: 'Claude', use: false } });
check('an Anthropic example is recognised as one', claude.data.found.api === 'messages' && claude.data.check?.ok === true, claude.data);
const claudeTest = await req('/fable/connections/Claude/test', { method: 'POST', token: A.token, body: {} });
check('  and answers through /messages with x-api-key', claudeTest.data.ok && asked.at(-1).path === '/v1/messages' && asked.at(-1).xKey === KEY3, { t: claudeTest.data, last: asked.at(-1) });
await req('/fable/connections/FCC', { method: 'PUT', token: A.token, body: { baseURL: 'http://127.0.0.1:9/v1', extra: { api: 'messages' } } });
const fccDown = await req('/fable/connections/FCC/find', { method: 'POST', token: A.token, body: {} });
check('a proxy that is not running is simply "not answering", nothing else breaks', fccDown.status === 400 && /none of these answered/.test(fccDown.data.error), fccDown.data);
await req('/fable/connections/FCC', { method: 'DELETE', token: A.token });

console.log('\n=== THE TEST BUTTON ===');
const set = await req('/fable/settings', {
  method: 'PUT', token: A.token,
  body: { connection: 'Gem', botName: 'Robo', persona: 'Talk like a pirate.', replyMode: 'always' },
});
check('a working setup is ready', set.status === 200 && set.data.ready === true && set.data.settings.botName === 'Robo', set.data);
check('a connection that does not exist is explained', /no connection called "Ghost"/.test((await req('/fable/settings', { method: 'PUT', token: A.token, body: { connection: 'Ghost' } })).data.problem));
await req('/fable/settings', { method: 'PUT', token: A.token, body: { connection: 'Gem' } });
const tried = await req('/fable/test', { method: 'POST', token: B.token, body: {} });
check('the test button gets a hello back', tried.status === 200 && tried.data.ok && /Hello you two/.test(tried.data.reply) && tried.data.connection === 'Gem', tried.data);
check('with the name stripped off the front', !/^Robo:/.test(tried.data.reply), tried.data.reply);

console.log('\n=== THE CHAT ===');
await req('/fable/connections/Gem', { method: 'PUT', token: A.token, body: { model: 'test-model' } });
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
check('using the connection\'s model', call?.model === 'test-model', call?.model);

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

console.log('\n=== A BUSY OR UNKNOWN MODEL: ANOTHER ONE ANSWERS ===');
await req('/fable/settings', { method: 'PUT', token: A.token, body: { replyMode: 'always' } });
await req('/fable/connections/Gem', { method: 'PUT', token: A.token, body: { model: 'busy-model' } });
const stoodIn = await req('/fable/test', { method: 'POST', token: A.token, body: {} });
check('the test still gets a hello when the chosen model is busy', stoodIn.status === 200 && stoodIn.data.ok && /Hello/.test(stoodIn.data.reply), stoodIn.data);
check('  and says which model stood in, and why', stoodIn.data.fallback?.from === 'busy-model' && stoodIn.data.fallback?.to === 'backup-model'
  && /busy/.test(stoodIn.data.fallback?.why) && stoodIn.data.model === 'backup-model', stoodIn.data);
check('  and the busy model stays chosen (it is only busy)', conn((await req('/fable/settings', { token: A.token })).data, 'Gem').model === 'busy-model');

await req('/fable/connections/Gem', { method: 'PUT', token: A.token, body: { model: 'gemini-3-flash' } });
const unknownChat = await req('/fable/messages', { method: 'POST', token: A.token, body: { body: 'Still there?' } });
const unknownAnswer = await waitFor(async () => {
  const r = await req(`/fable/messages?since=${unknownChat.data.message.id}`, { token: A.token });
  return r.data.messages.find((m) => m.authorKind !== 'user');
}, 20000);
check('a model the service does not have: another answers, not "could not answer"', unknownAnswer?.authorKind === 'ai', unknownAnswer);
const healed = conn((await req('/fable/settings', { token: A.token })).data, 'Gem').model;
check('  and the connection moves onto it, so the next message need not search', healed === 'backup-model', healed);
await req('/fable/connections/Gem', { method: 'PUT', token: A.token, body: { model: 'test-model' } });

console.log('\n=== ONE CONNECTION REFUSED: ANOTHER OF YOURS ANSWERS ===');
VALID.delete(KEY);
const other = await req('/fable/test', { method: 'POST', token: A.token, body: {} });
check('with the chosen key refused, your other connection answers', other.data.ok && other.data.connection === 'Pasted', other.data);
check('  and it says why it went elsewhere: what was sent', /Gem" refused the API key/.test(other.data.fallback?.why) && /ending "1234"/.test(other.data.fallback?.why), other.data.fallback);
VALID.add(KEY);

console.log('\n=== WHEN THE PROVIDER SAYS NO ===');
behaviour = 'badkey';
await req('/fable/settings', { method: 'PUT', token: A.token, body: { replyMode: 'mention' } });
await req('/fable/messages', { method: 'POST', token: A.token, body: { body: '@Robo hello?' } });
const refused = await waitFor(async () => (await req('/fable/messages', { token: A.token })).data.messages.find((m) => m.authorKind === 'system'));
check('the chat says the key was refused, and what was sent', /Robo could not answer: "Gem" refused the API key/.test(refused?.body) && /characters ending "1234"/.test(refused?.body), refused);
behaviour = 'limit';
const limited = await req('/fable/test', { method: 'POST', token: A.token, body: {} });
check('a free-tier limit is explained as one', limited.status === 400 && /hit its limit/.test(limited.data.error), limited.data);
behaviour = 'ok';

console.log('\n=== THE SERVER\'S OWN AI ===');
const server = await req('/fable/settings', { method: 'PUT', token: A.token, body: { source: 'server' } });
const hasServer = Boolean(process.env.QUIZ_LLM_PROVIDER);
check('choosing the server\'s AI works when backend/.env has one, and says so when not',
  hasServer ? server.data.ready === true : (server.data.ready === false && /backend\/.env/.test(server.data.problem)), server.data);
await req('/fable/settings', { method: 'PUT', token: A.token, body: { source: 'key' } });

console.log('\n=== YOUR CONNECTION FOR THE DAILY CONTENT TOO ===');
const { refreshSharedAiConfig } = await import('../src/models/fableAi.js');
const { getSharedAiConfig } = await import('../src/models/aiShared.js');
await refreshSharedAiConfig();
check('with "also use it for daily content" on, the connection is lent to the quiz and prompts',
  getSharedAiConfig()?.baseUrl === FAKE_URL && getSharedAiConfig()?.apiKey === KEY, getSharedAiConfig()?.baseUrl);
await req('/fable/settings', { method: 'PUT', token: A.token, body: { useForContent: false } });
await refreshSharedAiConfig();
check('and turned off, it is not', getSharedAiConfig()?.apiKey !== KEY);

console.log('\n=== KEYS SAVED UNDER THE OLD SETUP ===');
const { sealApiKey } = await import('../src/models/aiConnections.js');
const D = await signup('Dee');
const E = await signup('Eli');
const invite2 = await req('/auth/invite', { method: 'POST', token: D.token, body: { deviceTimezone: 'UTC' } });
await req('/auth/invite/accept', { method: 'POST', token: E.token, body: { inviteCode: invite2.data.inviteCode, deviceTimezone: 'UTC' } });
const pair2 = (await query('SELECT id FROM pairs WHERE user_a_id = $1', [D.id])).rows[0].id;
await query('INSERT INTO ai_keys (pair_id, provider, key_enc, hint, added_by) VALUES ($1, $2, $3, $4, $5)', [pair2, 'custom', sealApiKey(KEY2), '…9999', D.id]);
await query(`INSERT INTO fable_settings (pair_id, source, provider, model, base_url) VALUES ($1, 'key', 'custom', 'test-model', $2)`, [pair2, FAKE_URL]);
const moved = await req('/fable/settings', { token: E.token });
const legacy = conn(moved.data, 'Custom');
check('an old key becomes a connection, with its address and model', legacy?.baseURL === FAKE_URL && legacy?.model === 'test-model' && legacy?.keyLength === KEY2.length, legacy);
check('  chosen for Fable, and ready, without pasting it again', moved.data.settings.connection === 'Custom' && moved.data.ready === true, moved.data);
check('  and it answers', (await req('/fable/test', { method: 'POST', token: D.token, body: {} })).data.ok === true);

console.log('\n=== CLEARING UP ===');
check('the chat can be cleared', (await req('/fable/messages', { method: 'DELETE', token: B.token })).status === 200
  && (await req('/fable/messages', { token: A.token })).data.messages.length === 0);
check('turning Fable off keeps the connections', (await req('/fable/settings', { method: 'DELETE', token: A.token })).status === 200
  && (await req('/fable/settings', { token: A.token })).data.connections.length === 3);
const removed = await req('/fable/connections/Pasted', { method: 'DELETE', token: B.token });
check('a connection can be removed by either of you', removed.status === 200 && !conn(removed.data, 'Pasted'), removed.data);
check('one that is not there is a 404', (await req('/fable/connections/Pasted', { method: 'DELETE', token: B.token })).status === 404);

await query('DELETE FROM users WHERE id = ANY($1)', [[A.id, B.id, C.id, D.id, E.id]]);
fake.close();
await pool.end();
console.log(`\nFABLE RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
fails.forEach((f) => console.log(`  - ${f}`));
process.exit(fails.length ? 1 : 0);
