// Fable, the group chat with your AI agents, against a live stack AND a live
// room (collaboration-des-esprits).
//
// Needs the backend started with ESPRITS_URL / ESPRITS_TOKEN pointing at a
// running room, and the same two variables here (FABLE_ROOM_URL /
// FABLE_ROOM_TOKEN, defaulting to http://127.0.0.1:4300 and ESPRITS_TOKEN), so
// this test can also act as an AI agent in that room, the way a real one
// joins over MCP or the room's API.
const API = 'http://localhost:4000';
const ROOM = process.env.FABLE_ROOM_URL || 'http://127.0.0.1:4300';
const ROOM_TOKEN = process.env.FABLE_ROOM_TOKEN || process.env.ESPRITS_TOKEN || '';
const stamp = Date.now();
let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${JSON.stringify(d)}`); } };

async function req(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${API}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
async function room(path, body) {
  const res = await fetch(`${ROOM}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(ROOM_TOKEN ? { Authorization: `Bearer ${ROOM_TOKEN}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const signup = async (name) => {
  const u = { email: `fable-${name.replace(/\W/g, '')}${stamp}@t.dev`, password: 'pw123456', name };
  const r = await req('/auth/signup', { method: 'POST', body: u });
  return { ...u, token: r.data.accessToken, id: r.data.user.id };
};

const A = await signup(`Malcolm${stamp % 1000}`);
const B = await signup(`Hobi Rose${stamp % 1000}`);
const C = await signup('Outsider');
const invite = await req('/auth/invite', { method: 'POST', token: A.token, body: { deviceTimezone: 'UTC' } });
await req('/auth/invite/accept', { method: 'POST', token: B.token, body: { inviteCode: invite.data.inviteCode, deviceTimezone: 'UTC' } });

console.log('=== ONLY THE COUPLE GETS IN ===');
check('no login, no Fable', (await req('/fable/feed')).status === 401);
check('someone not paired is turned away', (await req('/fable/feed', { token: C.token })).status === 403);

console.log('\n=== THE ROOM IS THERE ===');
const status = await req('/fable/status', { token: A.token });
check('the server says Fable is set up and answering', status.data?.configured && status.data?.reachable, status.data);
check('your name in the room is your name', status.data?.name === A.name, status.data?.name);
const statusB = await req('/fable/status', { token: B.token });
check('a name with a space still works as an @mention', statusB.data?.name === B.name.replace(' ', '_'), statusB.data?.name);

console.log('\n=== YOU TWO TALK, AN AGENT ANSWERS ===');
const start = await req('/fable/feed', { token: A.token });
check('the feed opens', start.status === 200 && Array.isArray(start.data?.messages), start.data);
const cursor = start.data.head;

const agentName = `scribe-${stamp % 100000}`;
const joined = await room('/api/join', { name: agentName, role: 'generalist', kind: 'agent', model: 'test' });
check('an AI agent joins the same room', joined.status === 200, joined.data);

const sent = await req('/fable/messages', { method: 'POST', token: A.token, body: { body: `@${agentName} plan a date night for us` } });
check('you can post', sent.status === 201 && sent.data?.id, sent.data);
check('and @naming an agent tags it', sent.data?.mentions?.includes(agentName), sent.data?.mentions);

const replied = await room('/api/post', { as: agentName, body: 'Picnic at sunset, then the observatory.' });
check('the agent replies in the room', replied.status === 200, replied.data);

const sentB = await req('/fable/messages', { method: 'POST', token: B.token, body: { body: 'Yes to the observatory!' } });
check('your partner posts too', sentB.status === 201, sentB.data);

const feed = await req(`/fable/feed?since=${cursor}`, { token: A.token });
const bodies = (feed.data?.messages || []).map((m) => `${m.author}:${m.authorKind}:${m.mine}:${m.body}`);
check('everyone is in one conversation, in order',
  bodies.findIndex((b) => b.includes('plan a date night')) < bodies.findIndex((b) => b.includes('Picnic at sunset'))
  && bodies.findIndex((b) => b.includes('Picnic at sunset')) < bodies.findIndex((b) => b.includes('Yes to the observatory')),
  bodies);
check('your message is marked as yours', bodies.some((b) => b === `${A.name}:human:true:@${agentName} plan a date night for us`), bodies);
check('the agent is marked as an agent', bodies.some((b) => b.startsWith(`${agentName}:agent:false:`)), bodies);
check('your partner is a person in the room, not you', bodies.some((b) => b.startsWith(`${B.name.replace(' ', '_')}:human:false:`)), bodies);
check('the feed only returns what is new', !(feed.data?.messages || []).some((m) => m.id <= cursor), feed.data?.head);

const feedB = await req(`/fable/feed?since=${cursor}`, { token: B.token });
const mineB = (feedB.data?.messages || []).filter((m) => m.mine).map((m) => m.body);
check('on your partner\'s phone, their message is theirs', mineB.includes('Yes to the observatory!') && !mineB.some((b) => b.includes('date night')), mineB);

console.log('\n=== WHO IS HERE ===');
const roster = await req('/fable/roster', { token: A.token });
const names = (roster.data?.members || []).map((m) => `${m.name}:${m.kind}`);
check('the roster lists both of you as people', names.includes(`${A.name}:human`) && names.includes(`${B.name.replace(' ', '_')}:human`), names);
check('and the agent as an agent', names.includes(`${agentName}:agent`), names);

console.log('\n=== BAD INPUT IS SAID PLAINLY ===');
const empty = await req('/fable/messages', { method: 'POST', token: A.token, body: { body: '   ' } });
check('an empty message is refused', empty.status === 400 && /Type a message/.test(empty.data?.error), empty.data);
const huge = await req('/fable/messages', { method: 'POST', token: A.token, body: { body: 'x'.repeat(8001) } });
check('an enormous one is refused', huge.status === 400, huge.data);
const noIdea = await req('/fable/messages', { method: 'POST', token: A.token, body: { body: 'hi', idea: 'no-such-idea' } });
check('the room\'s own reason comes back when it refuses', noIdea.status === 400 && noIdea.data?.error, noIdea.data);

console.log(`\nFABLE RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
fails.forEach((f) => console.log(`  - ${f}`));
process.exit(fails.length ? 1 : 0);
