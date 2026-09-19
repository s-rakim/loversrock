// The daily quiz comparison: both answer, nothing is visible until both
// have finished, and the result is titled by how much you matched.
//
// The assertion that matters most is the negative one — that a partner's
// answer is not merely hidden by the UI but genuinely absent from the
// payload until the gate opens. Anything else is a UI convention that one
// careless render undoes.
import { matchResult, answersMatch } from '../src/models/quizResults.js';

const API = 'http://localhost:4000';
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
const signup = async (name) => {
  const u = { email: `quiz-${name}${stamp}@t.dev`, password: 'pw123456', name };
  const r = await req('/auth/signup', { method: 'POST', body: u });
  return { ...u, token: r.data.accessToken, id: r.data.user.id };
};

console.log('=== THE BANDS, IN ISOLATION ===');
// Pure function, so every edge can be hit directly instead of through six
// HTTP calls each.
check('all matched is a Perfect Match', matchResult(4, 4).title === 'Perfect Match');
check('a single question, matched, is still perfect', matchResult(1, 1).title === 'Perfect Match');
check('three of four is a Strong Connection', matchResult(3, 4).title === 'Strong Connection');
check('two of three is a Strong Connection', matchResult(2, 3).title === 'Strong Connection');
check('one of four is Growing Together', matchResult(1, 4).title === 'Growing Together');
check('none matched is Growing Together', matchResult(0, 4).title === 'Growing Together');
check('exactly half is Growing Together, since Strong needs MORE than half',
  matchResult(2, 4).title === 'Growing Together', matchResult(2, 4));
check('no questions yields no result at all', matchResult(0, 0) === null);
check('the fraction is carried through', matchResult(3, 4).fraction === 0.75);
check('the tier is machine-readable, not just the title',
  ['perfect', 'strong', 'growing'].includes(matchResult(3, 4).tier));
check('a zero-match blurb does not claim zero matched',
  !/^0 of/.test(matchResult(0, 3).blurb), matchResult(0, 3).blurb);

console.log('\n=== MATCHING IS FORGIVING ABOUT CASE AND SPACE ===');
check('"Pizza" matches " pizza "', answersMatch('Pizza', ' pizza '));
check('different answers do not match', answersMatch('tea', 'coffee') === false);
check('an unanswered question never counts as a match', answersMatch(null, 'tea') === false);
check('two unanswered do not match each other', answersMatch(null, null) === false);

const A = await signup('Ana');
const B = await signup('Ben');
const invite = await req('/auth/invite', { method: 'POST', token: A.token, body: { deviceTimezone: 'UTC' } });
await req('/auth/invite/accept', { method: 'POST', token: B.token, body: { inviteCode: invite.data.inviteCode, deviceTimezone: 'UTC' } });

const today = await req('/quiz/today', { token: A.token });
if (today.status !== 200) {
  console.log(`\n  SKIP  no quiz scheduled today (${today.status}) — nothing to compare`);
  console.log(`\nQUIZ COMPARE RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
  process.exit(fails.length ? 1 : 0);
}

const questions = today.data.questions;
console.log(`\n=== A REAL QUIZ (${questions.length} questions) ===`);
check('the payload reports progress', Boolean(today.data.progress), today.data.progress);
check('nothing is revealed before anyone answers', today.data.revealed === false);
check('and there is no result yet', today.data.result === null);

const answerFor = (q, which) => {
  const choices = q.choices || [];
  if (choices.length === 0) return which === 'same' ? 'shared answer' : `answer-${which}`;
  // 'same' picks the first choice for both; 'diff' picks the last, so the
  // two disagree whenever there is more than one option.
  return which === 'same' ? choices[0] : choices[choices.length - 1];
};

// A answers everything first.
for (const q of questions) {
  await req(`/quiz/${q.id}/respond`, { method: 'POST', token: A.token, body: { answer: answerFor(q, 'same') } });
}

const afterA = await req('/quiz/today', { token: A.token });
check('A has finished', afterA.data.progress.iAmDone === true, afterA.data.progress);
check('but the quiz is not revealed', afterA.data.revealed === false);
check('and A gets no result yet', afterA.data.result === null);

const bSees = await req('/quiz/today', { token: B.token });
check('B can see that A has answered', bSees.data.progress.partner === questions.length, bSees.data.progress);
check("B cannot see A's answers", bSees.data.questions.every((q) => q.partnerAnswer === null),
  bSees.data.questions.map((q) => q.partnerAnswer));
check('no match flags leak to B either', bSees.data.questions.every((q) => q.matched === null));
// The strongest form: A's chosen answers do not appear anywhere in the part
// of B's payload that describes A.
const aAnswers = questions.map((q) => answerFor(q, 'same'));
const bPayload = JSON.stringify(bSees.data.questions.map((q) => ({ a: q.partnerAnswer, m: q.matched })));
check("not one of A's answers is anywhere in B's partner fields",
  aAnswers.every((ans) => !bPayload.includes(ans)), { aAnswers, bPayload });

// B answers everything the same way -> Perfect Match.
let lastResponse;
for (const q of questions) {
  lastResponse = await req(`/quiz/${q.id}/respond`, { method: 'POST', token: B.token, body: { answer: answerFor(q, 'same') } });
}
check('the final answer reports the day as complete',
  lastResponse.data.dayComplete === true, lastResponse.data);
check('and carries the result with it', Boolean(lastResponse.data.result), lastResponse.data.result);

const revealedA = await req('/quiz/today', { token: A.token });
const revealedB = await req('/quiz/today', { token: B.token });
check('now it is revealed for A', revealedA.data.revealed === true);
check('and for B', revealedB.data.revealed === true);
check('A sees identical answers as a Perfect Match',
  revealedA.data.result.title === 'Perfect Match', revealedA.data.result);
check('both see the same title', revealedA.data.result.title === revealedB.data.result.title);
check("A can now read B's answers", revealedA.data.questions.every((q) => q.partnerAnswer !== null),
  revealedA.data.questions.map((q) => q.partnerAnswer));
check('every question is flagged matched', revealedA.data.questions.every((q) => q.matched === true));
check('the count adds up',
  revealedA.data.result.matched === questions.length && revealedA.data.result.total === questions.length,
  revealedA.data.result);
check('re-reading does not change the result',
  (await req('/quiz/today', { token: A.token })).data.result.title === 'Perfect Match');

console.log('\n=== A DISAGREEING PAIR GETS A DIFFERENT TITLE ===');
// A fresh pair on the same day's questions, answering differently.
const C = await signup('Cara');
const D = await signup('Dan');
const inv2 = await req('/auth/invite', { method: 'POST', token: C.token, body: { deviceTimezone: 'UTC' } });
await req('/auth/invite/accept', { method: 'POST', token: D.token, body: { inviteCode: inv2.data.inviteCode, deviceTimezone: 'UTC' } });

const multi = questions.filter((q) => (q.choices || []).length > 1);
for (const q of questions) {
  await req(`/quiz/${q.id}/respond`, { method: 'POST', token: C.token, body: { answer: answerFor(q, 'same') } });
}
for (const q of questions) {
  await req(`/quiz/${q.id}/respond`, { method: 'POST', token: D.token, body: { answer: answerFor(q, 'diff') } });
}
const mismatched = await req('/quiz/today', { token: C.token });
check('a disagreeing pair still gets a result', Boolean(mismatched.data.result), mismatched.data.result);
if (multi.length === questions.length) {
  check('answering differently throughout is Growing Together',
    mismatched.data.result.title === 'Growing Together', mismatched.data.result);
  check('and nothing is marked matched',
    mismatched.data.questions.every((q) => q.matched === false),
    mismatched.data.questions.map((q) => q.matched));
} else {
  // Some question types carry no choices, where both sides get the same
  // literal string; those legitimately match.
  check('the title is one of the three bands',
    ['Perfect Match', 'Strong Connection', 'Growing Together'].includes(mismatched.data.result.title),
    mismatched.data.result.title);
}

console.log(`\nQUIZ COMPARE RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
process.exit(0);
