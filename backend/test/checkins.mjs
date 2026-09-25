// Follow-ups, the monthly check-in, and the random challenge.
//
// All three are built on the same rule the rest of this app runs on: you do
// not see their side until you have given yours. It shows up three different
// ways here, and each one has a different way of going wrong.
import { quote, renderFollowUp, pickTemplate } from '../src/models/followUps.js';
import { normalizeAnswer, averageScore, monthOf, CHECKIN_QUESTIONS } from '../src/models/checkins.js';

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
  const u = { email: `chk-${n}${stamp}@t.dev`, password: 'pw123456', name: n };
  const r = await req('/auth/signup', { method: 'POST', body: u });
  return { ...u, token: r.data.accessToken, id: r.data.user.id };
};
const A = await signup('Ana');
const B = await signup('Ben');
const invite = await req('/auth/invite', { method: 'POST', token: A.token, body: { deviceTimezone: 'UTC' } });
await req('/auth/invite/accept', { method: 'POST', token: B.token, body: { inviteCode: invite.data.inviteCode, deviceTimezone: 'UTC' } });

console.log('=== QUOTING SOMEBODY IS NOT THE PLACE TO BE CLEVER ===');
check('a short answer is quoted whole', quote('because I was tired') === 'because I was tired');
check('whitespace is collapsed', quote('  a   b  ') === 'a b');
check('nothing to quote gives null, not an empty quote', quote('   ') === null);
const long = 'the way you always put the kettle on without asking, even when you are tired and it has been a long day';
const q = quote(long);
// "cut at a word boundary" means the kept text is a whole-word prefix of the
// original — not that it fails to end in a letter, which it obviously does.
const kept = q.slice(0, -1);
check('a long answer is cut at a word boundary',
  q.endsWith('…') && (long === kept || long.startsWith(`${kept} `)), q);
check('and stays under the limit', q.length <= 92, q.length);
// A single word longer than the limit has no space to cut at, and slicing to
// lastIndexOf(' ') === -1 would produce an empty quote.
check('one enormous word does not produce an empty quote', quote('x'.repeat(300))?.length > 50, quote('x'.repeat(300))?.length);

check('a template renders', renderFollowUp('You said “{answer}”. Why?', 'because') === 'You said “because”. Why?');
// You said "". What is behind that? is worse than no follow-up at all.
check('an empty answer renders nothing rather than an empty quote', renderFollowUp('“{answer}”?', '  ') === null);
check('a template with no placeholder is refused', renderFollowUp('why?', 'x') === null);
// Deterministic, because the pick is stored on first read and two devices can
// race to create it.
check('picking is deterministic for the same seed',
  pickTemplate(['a', 'b', 'c', 'd'], 's1') === pickTemplate(['a', 'b', 'c', 'd'], 's1'));
check('and an empty bank picks nothing', pickTemplate([], 's') === null);

console.log('\n=== THE FOLLOW-UP QUOTES YOUR PARTNER, ONCE YOU HAVE BOTH ANSWERED ===');
const before = await req('/daily-prompt/today', { token: A.token });
check("today's prompt loads", before.status === 200, before.data?.error);
check('and there is no follow-up before anyone has answered', before.data.followUp === null, before.data.followUp);

await req('/daily-prompt/today/respond', { method: 'POST', token: A.token, body: { answerText: 'you made me tea without being asked' } });
const halfway = await req('/daily-prompt/today', { token: B.token });
// The follow-up quotes your partner, so offering it early would leak their
// answer through the question itself — which is the whole reveal rule,
// defeated by the feature meant to build on it.
check('still none when only one of us has answered', halfway.data.followUp === null, halfway.data.followUp);
check('and their answer is still hidden', halfway.data.partnerAnswer === null);

await req('/daily-prompt/today/respond', { method: 'POST', token: B.token, body: { answerText: 'the way you laugh at your own jokes' } });
const forA = await req('/daily-prompt/today', { token: A.token });
check('now there is a follow-up', Boolean(forA.data.followUp), forA.data.followUp);
check('and it quotes BEN, because Ana is reading it',
  forA.data.followUp.question.includes('laugh at your own jokes'), forA.data.followUp.question);

const forB = await req('/daily-prompt/today', { token: B.token });
check('while Ben gets one quoting ANA', forB.data.followUp.question.includes('made me tea'), forB.data.followUp.question);
// The pick is per pair and per prompt, so both of you are working on the same
// follow-up even though the quote inside it differs.
check('both are the same follow-up', forA.data.followUp.id === forB.data.followUp.id);
// Re-rolling between opening the screen and answering would attach the answer
// to a question nobody ever saw.
check('and it does not change on a second read',
  (await req('/daily-prompt/today', { token: A.token })).data.followUp.question === forA.data.followUp.question);

const fuA = await req(`/daily-prompt/follow-up/${forA.data.followUp.id}/respond`, { method: 'POST', token: A.token, body: { answer: 'it is the only one I get right' } });
check('answering a follow-up works', fuA.status === 200 && fuA.data.myAnswer, fuA.data);
check('and theirs is still hidden', fuA.data.partnerAnswer === null && fuA.data.bothAnswered === false);
const fuB = await req(`/daily-prompt/follow-up/${forB.data.followUp.id}/respond`, { method: 'POST', token: B.token, body: { answer: 'I have always done it' } });
check('the second answer reveals both', fuB.data.bothAnswered === true && fuB.data.partnerAnswer === 'it is the only one I get right', fuB.data);
check('an empty follow-up answer is refused',
  (await req(`/daily-prompt/follow-up/${forA.data.followUp.id}/respond`, { method: 'POST', token: A.token, body: { answer: '   ' } })).status === 400);

console.log('\n=== THE MONTHLY CHECK-IN ===');
check('scores are clamped, not rejected — a slider bug must not eat a check-in',
  normalizeAnswer('connected', { score: 99 }).value.score === 10);
check('a missing score is refused', normalizeAnswer('connected', {}).ok === false);
check('an empty text answer is refused', normalizeAnswer('best', { answer: '  ' }).ok === false);
check('an unknown key is refused', normalizeAnswer('vibes', { score: 5 }).ok === false);
check('the average ignores the text questions',
  averageScore([{ question_key: 'connected', score: 8 }, { question_key: 'heard', score: 7 }, { question_key: 'best', score: null }]) === 7.5);
check('and is null with no scores at all', averageScore([{ question_key: 'best', score: null }]) === null);

const fresh = await req('/checkins/current', { token: A.token });
check('this month opens on first read', fresh.status === 200 && fresh.data.checkin.id, fresh.data);
check('with the question list', fresh.data.questions.length === CHECKIN_QUESTIONS.length);
check('and nobody finished', fresh.data.iAmDone === false && fresh.data.bothDone === false);
check('the month is the first of it', String(fresh.data.checkin.month).startsWith(monthOf().slice(0, 7)), fresh.data.checkin.month);

const full = (n) => Object.fromEntries(CHECKIN_QUESTIONS.map((qq) => [qq.key,
  qq.kind === 'score' ? { score: n } : { answer: `${qq.key} from ${n}` }]));

check('finishing before answering is refused',
  (await req('/checkins/current/finish', { method: 'POST', token: A.token })).status === 400);
const partial = await req('/checkins/current/finish', { method: 'POST', token: A.token });
check('and it says which ones are missing', partial.data.missing?.length === CHECKIN_QUESTIONS.length, partial.data);

await req('/checkins/current', { method: 'PUT', token: A.token, body: { answers: full(8) } });
const saved = await req('/checkins/current', { token: A.token });
check('answers save', saved.data.mine.length === CHECKIN_QUESTIONS.length, saved.data.mine?.length);
check('with an average', saved.data.myAverage === 8, saved.data.myAverage);
const finishA = await req('/checkins/current/finish', { method: 'POST', token: A.token });
check('and now it finishes', finishA.status === 200 && finishA.data.bothDone === false, finishA.data);

const bView = await req('/checkins/current', { token: B.token });
check('they can see that I finished', bView.data.theyAreDone === true);
// The thing the reveal rule protects: a check-in you can read halfway
// through is one you write differently, and then it measures nothing.
check('but NOT what I said', bView.data.theirs.length === 0, bView.data.theirs);
check('nor my average', bView.data.theirAverage === null);
check('and nowhere in the payload', !JSON.stringify(bView.data).includes('best from 8'));

// Finished means finished, or you could read theirs and go back and match it.
check('I cannot edit after finishing',
  (await req('/checkins/current', { method: 'PUT', token: A.token, body: { answers: full(2) } })).status === 409);

await req('/checkins/current', { method: 'PUT', token: B.token, body: { answers: full(6) } });
await req('/checkins/current/finish', { method: 'POST', token: B.token });
const revealed = await req('/checkins/current', { token: A.token });
check('once both are done, theirs appears', revealed.data.theirs.length === CHECKIN_QUESTIONS.length, revealed.data.theirs?.length);
check('with their average', revealed.data.theirAverage === 6, revealed.data.theirAverage);
check('and mine is unchanged at 8', revealed.data.myAverage === 8);

const history = await req('/checkins/history', { token: A.token });
check('a finished month is in the history', history.data.history.length === 1, history.data.history);
check('with both averages', history.data.history[0].myAverage === 8 && history.data.history[0].theirAverage === 6, history.data.history[0]);

console.log('\n=== THE RANDOM CHALLENGE ===');
const empty = await req('/checkins/challenge', { token: A.token });
check('nothing open to start', empty.data.challenge === null && empty.data.completed === 0, empty.data);

const drawn = await req('/checkins/challenge/draw', { method: 'POST', token: A.token });
check('one draws', drawn.status === 201 && drawn.data.challenge.title, drawn.data);
check('with everything the screen needs',
  ['id', 'title', 'detail', 'scope', 'category'].every((k) => k in drawn.data.challenge), Object.keys(drawn.data.challenge));
const seen = await req('/checkins/challenge', { token: B.token });
check('and the partner sees the same one', seen.data.challenge?.id === drawn.data.challenge.id, seen.data.challenge);

// Drawing again while one is open turns this into a slot machine you pull
// until you get an easy one.
const again = await req('/checkins/challenge/draw', { method: 'POST', token: B.token });
check('a second draw while one is open is refused', again.status === 409, again.data);

const closed = await req(`/checkins/challenge/${drawn.data.challenge.id}/close`, { method: 'POST', token: B.token, body: { status: 'done' } });
check('either of you can close it', closed.status === 200 && closed.data.challenge.status === 'done', closed.data);
check('closing it twice is a 404',
  (await req(`/checkins/challenge/${drawn.data.challenge.id}/close`, { method: 'POST', token: A.token })).status === 404);

const after = await req('/checkins/challenge', { token: A.token });
check('nothing open again', after.data.challenge === null);
check('it is in the history', after.data.history.some((h) => h.id === drawn.data.challenge.id), after.data.history);
check('and counted', after.data.completed === 1, after.data.completed);

const second = await req('/checkins/challenge/draw', { method: 'POST', token: A.token });
check('a new one draws once the last is closed', second.status === 201);
check('and it is not the one already done', second.data.challenge.id !== drawn.data.challenge.id
  && second.data.challenge.title !== drawn.data.challenge.title, second.data.challenge);
await req(`/checkins/challenge/${second.data.challenge.id}/close`, { method: 'POST', token: A.token, body: { status: 'skipped' } });
const skipped = await req('/checkins/challenge', { token: A.token });
check('a skipped one does not count as completed', skipped.data.completed === 1, skipped.data.completed);
// Skipping must not retire it — that would let you skip your way through the
// bank until only the easy ones were left.
const third = await req('/checkins/challenge/draw', { method: 'POST', token: A.token });
check('but a skipped one can come round again', third.status === 201, third.data);

console.log('\n=== NOBODY ELSE ===');
const C = await signup('Cal');
check('unpaired cannot read a check-in', (await req('/checkins/current', { token: C.token })).status === 403);
check('unpaired cannot draw a challenge', (await req('/checkins/challenge/draw', { method: 'POST', token: C.token })).status === 403);
check('signed out is a 401', (await req('/checkins/current')).status === 401);

console.log(`\nCHECKIN RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
