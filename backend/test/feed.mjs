// The joint feed.
//
// The feed is DERIVED from nine source tables rather than written to a
// feed_items table, so the risks are different from the usual ones. There is
// no possibility of a missing row — but there is every possibility of a row
// appearing that should not (half-finished things), of the same row appearing
// twice, and of the cursor losing or repeating items when both of you are
// adding things while the other scrolls. Those are what this hammers.
const API = 'http://localhost:4000';
const stamp = Date.now();
let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${JSON.stringify(d)?.slice(0, 300)}`); } };

const req = async (p, o = {}) => {
  const res = await fetch(`${API}${p}`, {
    method: o.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}) },
    body: o.body ? JSON.stringify(o.body) : undefined,
  });
  return { status: res.status, data: res.status === 204 ? null : await res.json().catch(() => null) };
};
const signup = async (n) => {
  const u = { email: `feed-${n}${stamp}@t.dev`, password: 'pw123456', name: n };
  const r = await req('/auth/signup', { method: 'POST', body: u });
  return { ...u, token: r.data.accessToken, id: r.data.user.id };
};
const A = await signup('Ana');
const B = await signup('Ben');
const invite = await req('/auth/invite', { method: 'POST', token: A.token, body: { deviceTimezone: 'UTC' } });
await req('/auth/invite/accept', { method: 'POST', token: B.token, body: { inviteCode: invite.data.inviteCode, deviceTimezone: 'UTC' } });

const kinds = (items) => items.map((i) => i.kind);

console.log('=== AN EMPTY FEED IS EMPTY, NOT AN ERROR ===');
const empty = await req('/feed', { token: A.token });
// A new couple opening the feed is the very first thing that happens, and a
// query with nine UNION branches has nine chances to throw on no rows.
check('a brand new pair gets an empty feed', empty.status === 200 && empty.data.items.length === 0, empty.data);
check('and no cursor', empty.data.nextCursor === null);

console.log('\n=== HALF-DONE THINGS ARE NOT EVENTS ===');
await req('/daily-prompt/today/respond', { method: 'POST', token: A.token, body: { answerText: 'my answer' } });
const half = await req('/feed', { token: A.token });
// One answer is not something that happened to the two of you, it is half of
// something. Worse, the feed shows both answers — so an item here would leak
// one person's answer before the other had given theirs.
check('a prompt only one of us answered is NOT in the feed', !kinds(half.data.items).includes('prompt'), half.data.items);
check('and neither is my answer anywhere in the payload', !JSON.stringify(half.data).includes('my answer'));

await req('/daily-prompt/today/respond', { method: 'POST', token: B.token, body: { answerText: 'their answer' } });
const whole = await req('/feed', { token: A.token });
const prompt = whole.data.items.find((i) => i.kind === 'prompt');
check('once both answered it appears', Boolean(prompt), kinds(whole.data.items));
check('with both answers on it', prompt.meta.answers.length === 2, prompt.meta);
check('and the question', typeof prompt.title === 'string' && prompt.title.length > 0, prompt.title);
check('exactly once, not once per answer', whole.data.items.filter((i) => i.kind === 'prompt').length === 1);

console.log('\n=== EVERY SOURCE LANDS IN IT ===');
await req('/memories', { method: 'POST', token: A.token, body: { image: `data:image/png;base64,${Buffer.from('x'.repeat(40)).toString('base64')}`, caption: 'a memory' } });
await req('/canvas', { method: 'POST', token: B.token, body: { strokeData: { strokes: [{ points: [{ x: 1, y: 1 }, { x: 5, y: 9 }], color: '#FF5C8D', width: 6, tool: 'pen' }] }, title: 'a drawing' } });
const bucket = await req('/bucket-list', { method: 'POST', token: A.token, body: { title: 'see the northern lights' } });
await req(`/bucket-list/${bucket.data.item.id}`, { method: 'PATCH', token: B.token, body: { isCompleted: true } });
const browse = await req('/date-ideas', { token: A.token });
const saved = await req(`/date-ideas/${browse.data.ideas[0].id}/save`, { method: 'POST', token: A.token });
await req(`/date-ideas/${saved.data.idea.id}/schedule`, { method: 'PATCH', token: A.token, body: { scheduledFor: new Date(Date.now() + 86400000).toISOString(), status: 'scheduled' } });
const drawn = await req('/checkins/challenge/draw', { method: 'POST', token: A.token });
await req(`/checkins/challenge/${drawn.data.challenge.id}/close`, { method: 'POST', token: A.token, body: { status: 'done' } });

const full = await req('/feed', { token: B.token, });
const present = new Set(kinds(full.data.items));
for (const k of ['prompt', 'memory', 'drawing', 'bucket', 'date', 'challenge']) {
  check(`${k} is in the feed`, present.has(k), [...present]);
}
check('a memory carries its image', full.data.items.find((i) => i.kind === 'memory')?.image, full.data.items.find((i) => i.kind === 'memory'));
check('a drawing carries its stroke count',
  full.data.items.find((i) => i.kind === 'drawing')?.meta?.strokeCount === 1,
  full.data.items.find((i) => i.kind === 'drawing')?.meta);

console.log('\n=== NEWEST FIRST, AND NOTHING TWICE ===');
const all = full.data.items;
const sorted = all.every((item, i) => i === 0 || new Date(all[i - 1].at) >= new Date(item.at));
check('strictly newest first across every source', sorted, all.map((i) => [i.kind, i.at]));
const ids = all.map((i) => `${i.kind}:${i.id}`);
check('no item appears twice', new Set(ids).size === ids.length, ids);
check('and every item has a timestamp', all.every((i) => i.at), all.filter((i) => !i.at));

console.log('\n=== COMMENTS ===');
const target = all[0];
const posted = await req(`/feed/${target.kind}/${target.id}/comments`, { method: 'POST', token: A.token, body: { body: 'I remember this' } });
check('a comment posts', posted.status === 201 && posted.data.comment.body === 'I remember this', posted.data);
const withComment = await req('/feed', { token: B.token });
const commented = withComment.data.items.find((i) => i.id === target.id && i.kind === target.kind);
check('and appears on the item for both of you', commented.comments.length === 1, commented?.comments);
check('with who said it', commented.comments[0].authorId === A.id, commented.comments[0]);
check('an empty comment is refused',
  (await req(`/feed/${target.kind}/${target.id}/comments`, { method: 'POST', token: A.token, body: { body: '  ' } })).status === 400);

await req(`/feed/${target.kind}/${target.id}/comments`, { method: 'POST', token: B.token, body: { body: 'so do I' } });
const two = await req('/feed', { token: A.token });
const both = two.data.items.find((i) => i.id === target.id);
check('two comments both appear', both.comments.length === 2, both.comments);
check('oldest first, like a thread', new Date(both.comments[0].createdAt) <= new Date(both.comments[1].createdAt));

// Deleting each other's words is not a feature a two-person app needs, and is
// a bad thing to have available during an argument.
const theirs = both.comments.find((c) => c.authorId === B.id);
check('I cannot delete their comment',
  (await req(`/feed/comments/${theirs.id}`, { method: 'DELETE', token: A.token })).status === 404);
const mine = both.comments.find((c) => c.authorId === A.id);
check('I can delete my own', (await req(`/feed/comments/${mine.id}`, { method: 'DELETE', token: A.token })).status === 204);
check('and it is gone',
  (await req('/feed', { token: A.token })).data.items.find((i) => i.id === target.id).comments.length === 1);

console.log('\n=== REACTIONS RIDE ALONG ===');
const react = await req('/presence/reactions', { method: 'PUT', token: B.token, body: { targetKind: target.kind, targetId: target.id, emoji: '❤️' } });
check('every feed kind is reactable', react.status === 200, react.data);
const reacted = await req('/feed', { token: A.token });
const item = reacted.data.items.find((i) => i.id === target.id);
check('a reaction shows on the feed item', item.reactions.length === 1 && item.reactions[0].emoji === '❤️', item.reactions);

console.log('\n=== PAGING WITH A MOVING TARGET ===');
// The reason for keyset rather than OFFSET: both of you add things while the
// other scrolls. An offset window shifts under you and you see an item twice,
// or miss one entirely.
const page1 = await req('/feed?limit=5', { token: A.token });
check('a page comes back at the size asked for', page1.data.items.length === 5, page1.data.items.length);
check('with a cursor', Boolean(page1.data.nextCursor), page1.data.nextCursor);

// Something new lands between the two requests.
await req('/memories', { method: 'POST', token: B.token, body: { image: `data:image/png;base64,${Buffer.from('y'.repeat(40)).toString('base64')}`, caption: 'added mid-scroll' } });

const c = page1.data.nextCursor;
const page2 = await req(`/feed?limit=5&cursorAt=${encodeURIComponent(c.at)}&cursorId=${c.id}`, { token: A.token });
const firstIds = page1.data.items.map((i) => `${i.kind}:${i.id}`);
const secondIds = page2.data.items.map((i) => `${i.kind}:${i.id}`);
check('the second page repeats nothing from the first',
  secondIds.every((id) => !firstIds.includes(id)), { firstIds, secondIds });
check('and the item added mid-scroll does not appear below the cursor',
  !page2.data.items.some((i) => i.body === 'added mid-scroll'), page2.data.items.map((i) => i.body));
check('the second page is still newest-first',
  page2.data.items.every((it, i) => i === 0 || new Date(page2.data.items[i - 1].at) >= new Date(it.at)));

// Walking the whole thing must terminate and cover everything exactly once.
let cursor = null; const walked = []; let guard = 0;
do {
  const qs = cursor ? `?limit=4&cursorAt=${encodeURIComponent(cursor.at)}&cursorId=${cursor.id}` : '?limit=4';
  const page = await req(`/feed${qs}`, { token: A.token });
  walked.push(...page.data.items.map((i) => `${i.kind}:${i.id}`));
  cursor = page.data.nextCursor;
} while (cursor && ++guard < 25);
check('walking the whole feed terminates', guard < 25, guard);
check('and visits every item exactly once', new Set(walked).size === walked.length, walked.length - new Set(walked).size);

console.log('\n=== NOBODY ELSE ===');
const C = await signup('Cal');
check('an unpaired person has no feed', (await req('/feed', { token: C.token })).status === 403);
check('signed out is a 401', (await req('/feed')).status === 401);
const D = await signup('Dee');
const inv2 = await req('/auth/invite', { method: 'POST', token: C.token, body: { deviceTimezone: 'UTC' } });
await req('/auth/invite/accept', { method: 'POST', token: D.token, body: { inviteCode: inv2.data.inviteCode, deviceTimezone: 'UTC' } });
const otherFeed = await req('/feed', { token: C.token });
check('another couple sees none of it', otherFeed.data.items.length === 0, otherFeed.data.items);
check('and cannot comment on it',
  (await req(`/feed/${target.kind}/${target.id}/comments`, { method: 'POST', token: C.token, body: { body: 'hello' } })).status === 201
  && !(await req('/feed', { token: A.token })).data.items.find((i) => i.id === target.id).comments.some((cm) => cm.body === 'hello'),
  'a comment written by another pair must not appear on our item');

console.log('\n=== THE ROUTE AND THE DATABASE AGREE ON WHAT IS REACTABLE ===');
// These two lists cannot be generated from one another — one is SQL and one
// is JS — and the failure is quiet either way: the route accepts a kind the
// database rejects (a 500 on react), or the database accepts one the route
// refuses (the feature silently does nothing on that item type).
const fs = await import('node:fs');
const schema = fs.readFileSync(new URL('../src/config/schema.sql', import.meta.url), 'utf8');
const constraint = schema.slice(schema.lastIndexOf('reactions_target_kind_check'));
const sqlKinds = [...constraint.slice(0, constraint.indexOf('));')).matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
const { REACTION_TARGETS } = await import('../src/models/reactions.js');
check(`the schema allows ${sqlKinds.length} kinds`, sqlKinds.length > 4, sqlKinds);
check('and the route allows exactly the same ones',
  JSON.stringify([...sqlKinds].sort()) === JSON.stringify([...REACTION_TARGETS].sort()),
  { sqlKinds, REACTION_TARGETS });
// And every kind the feed can emit must be in both.
for (const k of ['prompt', 'quiz', 'drawing', 'date', 'challenge', 'checkin', 'milestone', 'memory', 'locket']) {
  check(`  ${k} is reactable`, REACTION_TARGETS.includes(k) && sqlKinds.includes(k));
}

console.log(`\nFEED RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
