// Badges, streak repair, and date matching.
//
// The rule worth defending here is that a streak means something. A repair
// you can use whenever makes the number decorative, so it is bounded — once a
// month, and only within a couple of days of the break — and the tests below
// hold both of those lines.
import { query } from '../src/config/db.js';

const API = 'http://localhost:4000';
const stamp = Date.now();
let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${JSON.stringify(d)}`); } };

const req = async (p, o = {}) => {
  const res = await fetch(`${API}${p}`, {
    method: o.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}) },
    body: o.body ? JSON.stringify(o.body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const signup = async (n) => {
  const u = { email: `ach-${n}${stamp}@t.dev`, password: 'pw123456', name: n };
  const r = await req('/auth/signup', { method: 'POST', body: u });
  return { ...u, token: r.data.accessToken, id: r.data.user.id };
};

const A = await signup('Ana');
const B = await signup('Ben');
const invite = await req('/auth/invite', { method: 'POST', token: A.token, body: { deviceTimezone: 'UTC' } });
await req('/auth/invite/accept', { method: 'POST', token: B.token, body: { inviteCode: invite.data.inviteCode, deviceTimezone: 'UTC' } });
const { rows: pairRows } = await query(
  'SELECT id FROM pairs WHERE user_a_id = $1 AND unlinked_at IS NULL ORDER BY created_at DESC LIMIT 1', [A.id]);
const pairId = pairRows[0].id;

console.log('=== ACHIEVEMENTS ===');
const first = await req('/achievements', { token: A.token });
check('the catalogue loads', first.status === 200 && first.data.achievements.length > 15,
  first.data.achievements?.length);
check('pairing is earned just by being here',
  first.data.achievements.find((a) => a.slug === 'paired')?.earned === true);
check('and is reported as newly earned the first time',
  first.data.newlyEarned.some((a) => a.slug === 'paired'), first.data.newlyEarned);
check('things not done yet are not earned',
  first.data.achievements.find((a) => a.slug === 'messages-1000')?.earned === false);

// Awarding is idempotent: the screen runs this on every open.
const second = await req('/achievements', { token: B.token });
check('a second look awards nothing new', second.data.newlyEarned.length === 0, second.data.newlyEarned);
check('but still reports what is held', second.data.earnedCount === first.data.earnedCount,
  { first: first.data.earnedCount, second: second.data.earnedCount });

await req('/messages', { method: 'POST', token: A.token, body: { type: 'text', content: 'hello' } });
const afterMsg = await req('/achievements', { token: A.token });
check('sending a message earns the badge for it',
  afterMsg.data.achievements.find((a) => a.slug === 'first-message')?.earned === true);
check('and it is announced once', afterMsg.data.newlyEarned.some((a) => a.slug === 'first-message'));
check('with something to show on screen',
  Boolean(afterMsg.data.newlyEarned[0]?.title && afterMsg.data.newlyEarned[0]?.icon),
  afterMsg.data.newlyEarned[0]);

console.log('\n=== STREAK REPAIR ===');
const clean = await req('/achievements/streak', { token: A.token });
check('nothing to repair on a fresh pair', clean.data.canRepair === false, clean.data);
check('and it says why', clean.data.reason === 'Nothing to repair.', clean.data.reason);
check('repairing anyway is refused',
  (await req('/achievements/streak/repair', { method: 'POST', token: A.token })).status === 400);

// Simulate a streak of 12 that broke today.
await query(
  `UPDATE pairs SET streak_count = 1, longest_streak = 12,
          broken_streak = 12, broken_streak_at = CURRENT_DATE WHERE id = $1`, [pairId]);

const broken = await req('/achievements/streak', { token: A.token });
check('a fresh break is repairable', broken.data.canRepair === true, broken.data);
check('and remembers how long it was', broken.data.brokenStreak === 12, broken.data.brokenStreak);

const repaired = await req('/achievements/streak/repair', { method: 'POST', token: A.token });
check('the repair restores it', repaired.status === 200 && repaired.data.streak === 12, repaired.data);
check('and counts against the allowance', repaired.data.repairsUsed === 1, repaired.data.repairsUsed);

const afterRepair = await req('/achievements/streak', { token: A.token });
check('there is nothing left to repair', afterRepair.data.canRepair === false);
check('and the streak is back', afterRepair.data.streak === 12, afterRepair.data.streak);

// The bound that makes the number mean something.
await query(
  `UPDATE pairs SET streak_count = 1, broken_streak = 30, broken_streak_at = CURRENT_DATE WHERE id = $1`,
  [pairId]);
const tooSoon = await req('/achievements/streak/repair', { method: 'POST', token: A.token });
check('a second repair within the month is refused', tooSoon.status === 429, tooSoon.data);
check('with a reason', /month/i.test(tooSoon.data.error), tooSoon.data.error);

// And the other bound: an old break cannot be resurrected.
await query(
  `UPDATE pairs SET last_repair_at = NULL, broken_streak = 30,
          broken_streak_at = CURRENT_DATE - 10 WHERE id = $1`, [pairId]);
const tooOld = await req('/achievements/streak/repair', { method: 'POST', token: A.token });
check('a streak that broke long ago cannot be picked back up', tooOld.status === 400, tooOld.data);
check('with a reason', /too long ago/i.test(tooOld.data.error), tooOld.data.error);

console.log('\n=== DATE MATCHING ===');
const ideas = await req('/date-ideas', { token: A.token });
const idea = ideas.data.ideas?.[0] || ideas.data.dateIdeas?.[0];
check('there are date ideas to vote on', Boolean(idea), Object.keys(ideas.data));

const voteA = await req(`/date-ideas/${idea.id}/vote`, { method: 'PUT', token: A.token, body: { liked: true } });
check('a vote is accepted', voteA.status === 200, voteA.data);
// The whole point: you cannot see their vote before casting yours.
check('no match from one side alone', voteA.data.matched === false, voteA.data);
check('and their vote is not revealed', voteA.data.partnerVoted === false, voteA.data);

const voteB = await req(`/date-ideas/${idea.id}/vote`, { method: 'PUT', token: B.token, body: { liked: true } });
check('both saying yes is a match', voteB.data.matched === true, voteB.data);

const matches = await req('/date-ideas/matches', { token: A.token });
check('and it shows up in matches', matches.data.matches.some((m) => m.id === idea.id), matches.data.matches?.length);

// Changing your mind unmatches it.
await req(`/date-ideas/${idea.id}/vote`, { method: 'PUT', token: B.token, body: { liked: false } });
const unmatched = await req('/date-ideas/matches', { token: A.token });
check('changing your mind takes it out of matches',
  !unmatched.data.matches.some((m) => m.id === idea.id));

console.log('\n=== DATE SCHEDULING ===');
const when = new Date(Date.now() + 3 * 86400000).toISOString();
const sched = await req(`/date-ideas/${idea.id}/schedule`, {
  method: 'PATCH', token: A.token, body: { scheduledFor: when },
});
check('a date can be scheduled', sched.status === 200, sched.data);
check('setting a date implies the status', sched.data.dateIdea.status === 'scheduled', sched.data.dateIdea.status);
// A seeded idea is shared by every pair; scheduling must not write to it.
check('a shared idea is copied to the pair rather than edited in place',
  sched.data.dateIdea.id !== idea.id && sched.data.dateIdea.pair_id === pairId,
  { original: idea.id, copy: sched.data.dateIdea.id });

const upcoming = await req('/date-ideas/upcoming', { token: B.token });
check('the partner sees it coming up', upcoming.data.upcoming.some((d) => d.id === sched.data.dateIdea.id),
  upcoming.data.upcoming?.length);

const done = await req(`/date-ideas/${sched.data.dateIdea.id}/schedule`, {
  method: 'PATCH', token: A.token, body: { status: 'done' },
});
check('and can be marked done', done.data.dateIdea.status === 'done', done.data.dateIdea.status);
check('which also completes it', done.data.dateIdea.is_completed === true);
check('a nonsense status is refused',
  (await req(`/date-ideas/${sched.data.dateIdea.id}/schedule`, { method: 'PATCH', token: A.token, body: { status: 'maybe' } })).status === 400);

const afterDate = await req('/achievements', { token: A.token });
check('scheduling a date earns its badge',
  afterDate.data.achievements.find((a) => a.slug === 'date-first')?.earned === true);

console.log(`\nACHIEVEMENTS RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
process.exit(0);
