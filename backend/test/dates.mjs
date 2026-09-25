// The swipe deck and what a match means.
//
// The rule worth testing is the one that makes a match mean anything:
// neither of you sees the other's vote until you have cast your own. Knowing
// they said yes to the pottery class changes whether you say yes to it, and
// then "you both wanted this" is not true any more.
const API = 'http://localhost:4000';
const stamp = Date.now();
let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${JSON.stringify(d)?.slice(0, 250)}`); } };

const req = async (p, o = {}) => {
  const res = await fetch(`${API}${p}`, {
    method: o.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}) },
    body: o.body ? JSON.stringify(o.body) : undefined,
  });
  return { status: res.status, data: res.status === 204 ? null : await res.json().catch(() => null) };
};
const signup = async (n) => {
  const u = { email: `dates-${n}${stamp}@t.dev`, password: 'pw123456', name: n };
  const r = await req('/auth/signup', { method: 'POST', body: u });
  return { ...u, token: r.data.accessToken, id: r.data.user.id };
};

const A = await signup('Ana');
const B = await signup('Ben');
const invite = await req('/auth/invite', { method: 'POST', token: A.token, body: { deviceTimezone: 'UTC' } });
await req('/auth/invite/accept', { method: 'POST', token: B.token, body: { inviteCode: invite.data.inviteCode, deviceTimezone: 'UTC' } });

console.log('=== THE DECK ===');
const deckA = await req('/date-ideas/swipe', { token: A.token });
check('the deck has seeded ideas in it from the start', deckA.data.deck.length > 0, deckA.data.deck?.length);
check('and reports nothing voted yet', deckA.data.votedSoFar === 0, deckA.data.votedSoFar);
check('each card has what the renderer draws',
  deckA.data.deck.every((d) => d.id && d.title), deckA.data.deck[0]);

const deckB = await req('/date-ideas/swipe', { token: B.token });
// Swiping through the deck together on one sofa is most of how this gets
// used, and two different orders makes that impossible.
check('both of you get the same order',
  JSON.stringify(deckA.data.deck.map((d) => d.id)) === JSON.stringify(deckB.data.deck.map((d) => d.id)));

console.log('\n=== A VOTE REMOVES THE CARD FROM YOUR DECK, NOT THEIRS ===');
const first = deckA.data.deck[0];
const voteA = await req(`/date-ideas/${first.id}/vote`, { method: 'PUT', token: A.token, body: { liked: true } });
check('a vote records', voteA.status === 200 && voteA.data.liked === true, voteA.data);
check('no match from one vote', voteA.data.matched === false, voteA.data);
check('and it says the partner has not voted yet', voteA.data.partnerVoted === false, voteA.data);

const deckA2 = await req('/date-ideas/swipe', { token: A.token });
check('the card is gone from MY deck', !deckA2.data.deck.some((d) => d.id === first.id));
check('and my count went up', deckA2.data.votedSoFar === 1, deckA2.data.votedSoFar);
// The bug this prevents: a deck that empties as soon as one of you gets
// through it means whoever opens the app second never votes, and a match
// needs both votes — so the whole feature quietly stops working for one of you.
const deckB2 = await req('/date-ideas/swipe', { token: B.token });
check('but it is STILL in theirs', deckB2.data.deck.some((d) => d.id === first.id));
check('and their count is still zero', deckB2.data.votedSoFar === 0);

console.log('\n=== A MATCH IS BOTH OF YOU, AND NOBODY PEEKS ===');
const voteB = await req(`/date-ideas/${first.id}/vote`, { method: 'PUT', token: B.token, body: { liked: true } });
check('the second yes is a match', voteB.data.matched === true, voteB.data);
check('and now their vote is visible, because this one has been cast', voteB.data.partnerVoted === true);

const matches = await req('/date-ideas/matches', { token: A.token });
check('it shows up in matches for both', matches.data.matches.some((m) => m.id === first.id));
check('and for them too', (await req('/date-ideas/matches', { token: B.token })).data.matches.some((m) => m.id === first.id));

const second = deckB2.data.deck.find((d) => d.id !== first.id);
await req(`/date-ideas/${second.id}/vote`, { method: 'PUT', token: A.token, body: { liked: true } });
const noB = await req(`/date-ideas/${second.id}/vote`, { method: 'PUT', token: B.token, body: { liked: false } });
check('one yes and one no is not a match', noB.data.matched === false, noB.data);
check('and it does not appear in matches',
  !(await req('/date-ideas/matches', { token: A.token })).data.matches.some((m) => m.id === second.id));

const third = deckB2.data.deck.find((d) => d.id !== first.id && d.id !== second.id);
await req(`/date-ideas/${third.id}/vote`, { method: 'PUT', token: A.token, body: { liked: false } });
const yesB = await req(`/date-ideas/${third.id}/vote`, { method: 'PUT', token: B.token, body: { liked: true } });
check('their yes to my no is not a match either', yesB.data.matched === false, yesB.data);

console.log('\n=== CHANGING YOUR MIND ===');
// A vote is upserted, so swiping the same card twice replaces rather than
// stacking — which is what stops a double-tap creating two votes and the
// match count reading 3.
const redo = await req(`/date-ideas/${third.id}/vote`, { method: 'PUT', token: A.token, body: { liked: true } });
check('changing a no to a yes completes the match', redo.data.matched === true, redo.data);
const dedup = (await req('/date-ideas/matches', { token: A.token })).data.matches.filter((m) => m.id === third.id);
check('and the idea appears exactly once', dedup.length === 1, dedup.length);
check('with exactly two yes votes, not three', dedup[0].yes_votes === 2, dedup[0]?.yes_votes);

console.log('\n=== SCHEDULING ONE OUT OF THE DECK ===');
const mine = await req(`/date-ideas/${first.id}/save`, { method: 'POST', token: A.token });
const when = new Date(Date.now() + 5 * 86400000).toISOString();
await req(`/date-ideas/${mine.data.idea.id}/schedule`, { method: 'PATCH', token: A.token, body: { scheduledFor: when, status: 'scheduled' } });
const upcoming = await req('/date-ideas/upcoming', { token: B.token });
check('a scheduled date shows for both of you',
  upcoming.data.upcoming.some((d) => d.id === mine.data.idea.id), upcoming.data);
// Once it is planned it is not an idea any more, so it leaves the deck.
check('and it is not offered for swiping again',
  !(await req('/date-ideas/swipe', { token: B.token })).data.deck.some((d) => d.id === mine.data.idea.id));

console.log('\n=== NOBODY ELSE ===');
const C = await signup('Cal');
check('an unpaired person cannot open the deck', (await req('/date-ideas/swipe', { token: C.token })).status === 403);
check('signed out is a 401', (await req('/date-ideas/swipe')).status === 401);

console.log(`\nDATES RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
