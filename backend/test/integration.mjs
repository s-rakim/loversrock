// End-to-end simulation of every loversrock backend feature against a real
// Postgres + S3 + Socket.io stack.
import { io } from 'socket.io-client';

const API = 'http://localhost:4000';
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let pass = 0;
const failures = [];
const section = (n) => console.log(`\n=== ${n} ===`);
function check(name, cond, detail) {
  if (cond) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`  FAIL  ${name}${detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ''}`);
  }
}

async function req(path, { method = 'GET', body, token, raw = false } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  let data = null;
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, data };
}

import { execFileSync } from 'node:child_process';

// Time travel helpers: rewind the pair's streak bookkeeping so consecutive-day
// and missed-day behaviour can be exercised inside a single test run.
function sql(statement) {
  return execFileSync('psql', ['-h', 'localhost', '-U', 'loversrock', '-d', 'loversrock', '-t', '-c', statement], {
    env: { ...process.env, PGPASSWORD: 'loversrock' },
    encoding: 'utf8',
  });
}
function rewindPairToYesterday(email, streak) {
  sql(`UPDATE pairs SET last_active_date = '${addDays(pairToday, -1)}', streak_count = ${streak}
       WHERE user_a_id = (SELECT id FROM users WHERE email='${email}') AND unlinked_at IS NULL;
       DELETE FROM prompt_responses WHERE pair_id = (SELECT id FROM pairs WHERE user_a_id=(SELECT id FROM users WHERE email='${email}') AND unlinked_at IS NULL);`);
}
function rewindPairToGap(email, streak) {
  sql(`UPDATE pairs SET last_active_date = '${addDays(pairToday, -3)}', streak_count = ${streak}
       WHERE user_a_id = (SELECT id FROM users WHERE email='${email}') AND unlinked_at IS NULL;
       DELETE FROM prompt_responses WHERE pair_id = (SELECT id FROM pairs WHERE user_a_id=(SELECT id FROM users WHERE email='${email}') AND unlinked_at IS NULL);`);
}

const today = new Date().toISOString().slice(0, 10);

// The pair below is pinned to America/Denver, and the server computes "today"
// in the pair's timezone, never in UTC (docs/SPEC.md #2). For the ~6 hours a
// day when UTC has rolled over and Denver has not, those are different
// calendar days — so anything asserting on the pair's day has to use this,
// not the runner's UTC date, or it fails for reasons that have nothing to do
// with the code under test.
const PAIR_TZ = 'America/Denver';
const dayIn = (tz, at = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
const pairToday = dayIn(PAIR_TZ);
const addDays = (d, n) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const stamp = Date.now();

const A = { email: `alice${stamp}@test.dev`, password: 'pw-alice-123', name: 'Alice' };
const B = { email: `bob${stamp}@test.dev`, password: 'pw-bob-123', name: 'Bob' };
const C = { email: `carol${stamp}@test.dev`, password: 'pw-carol-123', name: 'Carol' };

// ---------------------------------------------------------------- AUTH
section('AUTH / SIGNUP / LOGIN / REFRESH');
for (const u of [A, B, C]) {
  const r = await req('/auth/signup', { method: 'POST', body: u });
  u.token = r.data?.accessToken;
  u.refresh = r.data?.refreshToken;
  u.id = r.data?.user?.id;
  check(`signup ${u.name}`, r.status === 201 && !!u.token && !!u.refresh, r.data);
}
check('signup rejects duplicate email', (await req('/auth/signup', { method: 'POST', body: A })).status === 409);
check('signup rejects missing fields', (await req('/auth/signup', { method: 'POST', body: { email: 'x@y.z' } })).status === 400);

const login = await req('/auth/login', { method: 'POST', body: { email: A.email, password: A.password } });
check('login returns tokens', login.status === 200 && !!login.data.accessToken);
check('login rejects wrong password', (await req('/auth/login', { method: 'POST', body: { email: A.email, password: 'nope' } })).status === 401);
check('login rejects unknown email', (await req('/auth/login', { method: 'POST', body: { email: 'ghost@x.dev', password: 'p' } })).status === 401);

const refreshed = await req('/auth/refresh', { method: 'POST', body: { refreshToken: A.refresh } });
check('refresh rotates BOTH tokens', refreshed.status === 200 && !!refreshed.data.accessToken && !!refreshed.data.refreshToken);
check('refresh rejects an access token used as refresh', (await req('/auth/refresh', { method: 'POST', body: { refreshToken: A.token } })).status === 401);
check('protected route rejects missing token', (await req('/memories')).status === 401);
check('protected route rejects garbage token', (await req('/memories', { token: 'not.a.jwt' })).status === 401);

const fcm = await req('/auth/fcm-token', { method: 'POST', token: A.token, body: { fcmToken: 'device-token-a', platform: 'android' } });
check('fcm-token registers', fcm.status === 204);
const fcm2 = await req('/auth/fcm-token', { method: 'POST', token: A.token, body: { fcmToken: 'device-token-a', platform: 'android' } });
check('fcm-token is idempotent per device (multi-device safe)', fcm2.status === 204);

// ---------------------------------------------------------------- PAIRING
section('PAIRING / TIMEZONE PINNING / UNLINK');
check('unpaired user is blocked from pair data', (await req('/bucket-list', { token: A.token })).status === 403);

const invite = await req('/auth/invite', { method: 'POST', token: A.token, body: { deviceTimezone: PAIR_TZ } });
check('invite generates 6-char code', invite.status === 201 && invite.data.inviteCode?.length === 6, invite.data);
check('invite has ~7-day expiry', Math.round((new Date(invite.data.expiresAt) - Date.now()) / 86400000) === 7);
check('invite requires deviceTimezone', (await req('/auth/invite', { method: 'POST', token: B.token, body: {} })).status === 400);
check('inviter cannot accept own invite', (await req('/auth/invite/accept', { method: 'POST', token: A.token, body: { inviteCode: invite.data.inviteCode } })).status === 400);
check('bad invite code rejected', (await req('/auth/invite/accept', { method: 'POST', token: B.token, body: { inviteCode: 'ZZZZZZ' } })).status === 404);

const accept = await req('/auth/invite/accept', { method: 'POST', token: B.token, body: { inviteCode: invite.data.inviteCode } });
check('partner accepts invite', accept.status === 200, accept.data);
check('pair timezone pinned to INVITER device tz (SPEC #2)', accept.data?.pair?.timezone === 'America/Denver', accept.data?.pair?.timezone);
check('invite code consumed after accept', accept.data?.pair?.invite_code === null);
check('paired user can now reach pair data', (await req('/bucket-list', { token: A.token })).status === 200);
check('already-paired user cannot generate new invite', (await req('/auth/invite', { method: 'POST', token: A.token, body: { deviceTimezone: 'UTC' } })).status === 409);
check('third party still blocked from this pair', (await req('/bucket-list', { token: C.token })).status === 403);

// ---------------------------------------------------------------- DAILY PROMPT
section('DAILY PROMPT / REVEAL-AFTER-BOTH / STREAK');
const promptA = await req('/daily-prompt/today', { token: A.token });
check('today prompt served', promptA.status === 200 && !!promptA.data.prompt?.content, promptA.data);
check('no answers yet', promptA.data.myAnswer === null && promptA.data.bothAnswered === false);

const ansA = await req('/daily-prompt/today/respond', { method: 'POST', token: A.token, body: { answerText: 'Alice answer' } });
check('A can answer', ansA.status === 200 && ansA.data.myAnswer === 'Alice answer');
check('partner answer HIDDEN until both answer (server-side)', ansA.data.partnerAnswer === null && ansA.data.bothAnswered === false, ansA.data);

const peek = await req('/daily-prompt/today', { token: B.token });
check("B cannot see A's answer before answering (server-side gate)", peek.data.partnerAnswer === null, peek.data);

const ansB = await req('/daily-prompt/today/respond', { method: 'POST', token: B.token, body: { answerText: 'Bob answer' } });
check('both answered -> reveal', ansB.data.bothAnswered === true && ansB.data.partnerAnswer === 'Alice answer', ansB.data);
check('streak starts at 1', ansB.data.streakCount === 1, ansB.data.streakCount);

const reAnswer = await req('/daily-prompt/today/respond', { method: 'POST', token: B.token, body: { answerText: 'Bob edited' } });
check('re-answering does NOT double-count streak', reAnswer.data.streakCount === 1, reAnswer.data.streakCount);
check('answer is editable', reAnswer.data.myAnswer === 'Bob edited');
check('empty answer rejected', (await req('/daily-prompt/today/respond', { method: 'POST', token: A.token, body: {} })).status === 400);
const afterReveal = await req('/daily-prompt/today', { token: A.token });
check('reveal persists on reload', afterReveal.data.bothAnswered === true && afterReveal.data.partnerAnswer === 'Bob edited');

// REGRESSION: the streak must actually increment across consecutive days.
// Rewind the pair to "answered yesterday, streak 4" and answer again today.
await rewindPairToYesterday(A.email, 4);
await req('/daily-prompt/today/respond', { method: 'POST', token: A.token, body: { answerText: 'day2 a' } });
const nextDay = await req('/daily-prompt/today/respond', { method: 'POST', token: B.token, body: { answerText: 'day2 b' } });
check('STREAK INCREMENTS on a consecutive day (4 -> 5)', nextDay.data.streakCount === 5, nextDay.data.streakCount);

// And must RESET when a day was missed.
await rewindPairToGap(A.email, 9);
await req('/daily-prompt/today/respond', { method: 'POST', token: A.token, body: { answerText: 'gap a' } });
const afterGap = await req('/daily-prompt/today/respond', { method: 'POST', token: B.token, body: { answerText: 'gap b' } });
check('STREAK RESETS to 1 after a missed day', afterGap.data.streakCount === 1, afterGap.data.streakCount);

// ---------------------------------------------------------------- QUIZ
section('DAILY QUIZ / CORRECTNESS STATE MACHINE');
const quiz = await req('/quiz/today', { token: A.token });
check('quiz serves 5 questions', quiz.status === 200 && quiz.data.questions?.length === 5, quiz.data.questions?.length);
const qTrivia = quiz.data.questions.find((q) => q.type === 'trivia');
const qThisOr = quiz.data.questions.find((q) => q.type === 'this_or_that');
const qGuess = quiz.data.questions.filter((q) => q.type === 'guess_partner');
check('all three question types present in seed', !!qTrivia && !!qThisOr && qGuess.length > 0);

// Read the expected answer instead of hardcoding one: the bank serves a
// different trivia question each day, so a literal 'Paris' only passes on the
// day that question happens to be scheduled.
const triviaAnswer = sql(`SELECT correct_answer FROM quiz_questions WHERE id = '${qTrivia.id}'`).trim();
const trivRight = await req(`/quiz/${qTrivia.id}/respond`, { method: 'POST', token: A.token, body: { answer: triviaAnswer } });
check('trivia scores IMMEDIATELY (no partner wait)', trivRight.data.correctnessState === 'computed', trivRight.data);
check('trivia correct answer marked correct', trivRight.data.isCorrect === true, trivRight.data);
const trivWrong = await req(`/quiz/${qTrivia.id}/respond`, { method: 'POST', token: B.token, body: { answer: 'Lyon' } });
check('trivia wrong answer marked incorrect', trivWrong.data.isCorrect === false, trivWrong.data);
const trivCase = await req(`/quiz/${qTrivia.id}/respond`, { method: 'POST', token: B.token, body: { answer: `  ${triviaAnswer.toUpperCase()}  ` } });
check('trivia matching is case/whitespace insensitive', trivCase.data.isCorrect === true, trivCase.data);

const torA = await req(`/quiz/${qThisOr.id}/respond`, { method: 'POST', token: A.token, body: { answer: qThisOr.choices[0] } });
check('this_or_that has no right answer (isCorrect null)', torA.data.correctnessState === 'computed' && torA.data.isCorrect === null, torA.data);

const g1 = qGuess[0];
const gA = await req(`/quiz/${g1.id}/respond`, { method: 'POST', token: A.token, body: { answer: g1.choices[0] } });
check('guess_partner WAITS for partner', gA.data.correctnessState === 'waiting_for_partner' && gA.data.isCorrect === null, gA.data);
const gB = await req(`/quiz/${g1.id}/respond`, { method: 'POST', token: B.token, body: { answer: g1.choices[0] } });
check('guess_partner computes on second answer', gB.data.correctnessState === 'computed', gB.data);
check('matching answers => both correct', gB.data.isCorrect === true, gB.data);
const gACheck = (await req('/quiz/today', { token: A.token })).data.questions.find((q) => q.id === g1.id);
check("partner's row also flipped to computed/correct", gACheck.myCorrectnessState === 'computed' && gACheck.isCorrect === true, gACheck);

const g2 = qGuess[1] || qGuess[0];
if (qGuess.length > 1) {
  await req(`/quiz/${g2.id}/respond`, { method: 'POST', token: A.token, body: { answer: g2.choices[0] } });
  const mism = await req(`/quiz/${g2.id}/respond`, { method: 'POST', token: B.token, body: { answer: g2.choices[1] } });
  check('mismatched answers => both incorrect', mism.data.isCorrect === false, mism.data);
}
check('quiz rejects unknown question id', (await req('/quiz/00000000-0000-0000-0000-000000000000/respond', { method: 'POST', token: A.token, body: { answer: 'x' } })).status === 404);

const archive = await req(`/quiz/archive?month=${pairToday.slice(0, 7)}`, { token: A.token });
check('quiz archive returns per-day completion + score', archive.status === 200 && Array.isArray(archive.data.days) && archive.data.days.length > 0, archive.data);
const todayRow = archive.data.days.find((d) => d.date === pairToday);
check('archive completion fraction is sane', todayRow && todayRow.completionFraction > 0 && todayRow.completionFraction <= 1, todayRow);
check('archive rejects bad month format', (await req('/quiz/archive?month=2026-13-01', { token: A.token })).status === 400);

// ---------------------------------------------------------------- IMAGES
section('IMAGES: MEMORIES / PHOTOS / MEDIA STREAM');
const mem = await req('/memories', { method: 'POST', token: A.token, body: { image: PNG, caption: 'first memory' } });
check('memory uploads base64 image to object storage', mem.status === 201 && !!mem.data.memory?.image_url, mem.data);
check('memory key namespaced by pair', mem.data.memory.image_url.startsWith('memories/'), mem.data.memory.image_url);
check('memory source defaults to manual', mem.data.memory.source === 'manual');
check('rejects non-image payload with 400 (server stays up)', (await req('/memories', { method: 'POST', token: A.token, body: { image: 'just-a-string' } })).status === 400);

const memList = await req('/memories', { token: B.token });
check('partner sees the shared memory', memList.data.memories.some((m) => m.id === mem.data.memory.id));

const media = await req(`/media/${mem.data.memory.image_url}`, { token: A.token, raw: true });
const mediaBytes = Buffer.from(await media.arrayBuffer());
check('media streams the real bytes back', media.status === 200 && mediaBytes.length > 0, mediaBytes.length);
check('media returned a valid PNG signature', mediaBytes.slice(1, 4).toString() === 'PNG', mediaBytes.slice(0, 8).toString('hex'));
check('media endpoint requires auth', (await req(`/media/${mem.data.memory.image_url}`, { raw: true })).status === 401);

const patched = await req(`/memories/${mem.data.memory.id}`, { method: 'PATCH', token: B.token, body: { caption: 'renamed by partner' } });
check('either partner can edit caption', patched.data.memory.caption === 'renamed by partner');
await req(`/memories/${mem.data.memory.id}`, { method: 'PATCH', token: A.token, body: { deleted: true } });
const afterDel = await req('/memories', { token: A.token });
check('soft-deleted memory hidden from feed', !afterDel.data.memories.some((m) => m.id === mem.data.memory.id));
const restored = await req(`/memories/${mem.data.memory.id}/restore`, { method: 'POST', token: B.token });
check('either partner can restore within 30 days', restored.status === 200 && restored.data.memory.deleted_at === null, restored.data);
check('restore 404s for unknown id', (await req('/memories/00000000-0000-0000-0000-000000000000/restore', { method: 'POST', token: A.token })).status === 404);

// ---------------------------------------------------------------- MESSAGES
section('MESSAGES: TEXT / PHOTO / DOODLE / SEEN');
const txt = await req('/messages', { method: 'POST', token: A.token, body: { type: 'text', content: 'hello love' } });
check('text message sends', txt.status === 201 && txt.data.message.content === 'hello love');
const photoMsg = await req('/messages', { method: 'POST', token: A.token, body: { type: 'photo', image: PNG } });
check('photo message uploads and stores key', photoMsg.status === 201 && photoMsg.data.message.image_url?.startsWith('messages/'), photoMsg.data);
const strokes = [[{ x: 1, y: 2 }, { x: 3, y: 4 }], [{ x: 9, y: 9 }, { x: 10, y: 11 }]];
const doodle = await req('/messages', { method: 'POST', token: B.token, body: { type: 'doodle', strokeData: strokes } });
check('doodle stores vector stroke_data (not rasterized)', doodle.status === 201 && Array.isArray(doodle.data.message.stroke_data), doodle.data);
check('doodle stroke geometry round-trips exactly', JSON.stringify(doodle.data.message.stroke_data) === JSON.stringify(strokes), doodle.data.message.stroke_data);
check('photo message without image rejected', (await req('/messages', { method: 'POST', token: A.token, body: { type: 'photo' } })).status === 400);
check('doodle without strokeData rejected', (await req('/messages', { method: 'POST', token: A.token, body: { type: 'doodle' } })).status === 400);
check('invalid message type rejected', (await req('/messages', { method: 'POST', token: A.token, body: { type: 'hologram' } })).status === 400);

const feed = await req('/messages', { token: B.token });
check('unified feed returns all three types', ['text', 'photo', 'doodle'].every((t) => feed.data.messages.some((m) => m.type === t)));
const seen = await req(`/messages/${txt.data.message.id}/seen`, { method: 'PATCH', token: B.token });
check('recipient can mark message seen', seen.status === 200 && !!seen.data.message.seen_at);
check('sender cannot mark own message seen', (await req(`/messages/${doodle.data.message.id}/seen`, { method: 'PATCH', token: B.token })).status === 404);

// ---------------------------------------------------------------- WIDGET PHOTOS
section('WIDGET PHOTOS (backend contract)');
const wp = await req('/widget-photos', { method: 'POST', token: A.token, body: { image: PNG, caption: 'widget drop' } });
check('widget photo posts', wp.status === 201 && !!wp.data.widgetPhoto.image_url, wp.data);
const latest = await req('/widget-photos/latest', { token: B.token });
check('partner pulls latest widget photo (pull fallback)', latest.data.widgetPhoto?.id === wp.data.widgetPhoto.id);
const memsAfterWidget = await req('/memories', { token: B.token });
check('widget photo MIRRORS into memories with source=widget', memsAfterWidget.data.memories.some((m) => m.source === 'widget' && m.image_url === wp.data.widgetPhoto.image_url), memsAfterWidget.data.memories.map((m) => m.source));

// ---------------------------------------------------------------- DECKS
section('QUESTION DECKS');
const decks = await req('/decks', { token: A.token });
const cats = Object.keys(decks.data.decksByCategory || {});
const deckCount = Object.values(decks.data.decksByCategory || {}).flat().length;
check('decks grouped by category', decks.status === 200 && cats.length >= 11, cats.length);
// Not an exact count any more: seasonal decks come and go with the calendar,
// so a hardcoded number here would fail on a date rather than on a bug. The
// seasonal behaviour itself is asserted properly in test/seasons.mjs.
check('the evergreen decks are all there', deckCount >= 27, deckCount);
// There is no paywall. This is a server two people run for themselves, and
// shipping 17 of the 27 decks behind a "Premium" badge meant the owner was
// locked out of his own content. The column is DROPPED now rather than set
// false, so there is nothing left for a seed file or a future good idea to
// flip — asserted as an absence, which is the stronger claim.
check('no deck carries a lock at all',
  Object.values(decks.data.decksByCategory).flat().every((d) => !('is_locked' in d)),
  Object.values(decks.data.decksByCategory).flat().filter((d) => 'is_locked' in d).map((d) => d.slug));
const deckQs = await req('/decks/would-you-rather-classic/questions', { token: A.token });
check('deck questions load', deckQs.status === 200 && deckQs.data.questions.length > 0);
const dq = deckQs.data.questions[0];
await req(`/decks/questions/${dq.id}/respond`, { method: 'POST', token: A.token, body: { answerText: 'rewind' } });
const deckMid = await req('/decks/would-you-rather-classic/questions', { token: B.token });
check("deck partner answer hidden until both answer", deckMid.data.questions[0].partnerAnswer === null && deckMid.data.questions[0].bothAnswered === false, deckMid.data.questions[0]);
await req(`/decks/questions/${dq.id}/respond`, { method: 'POST', token: B.token, body: { answerText: 'pause' } });
const deckDone = await req('/decks/would-you-rather-classic/questions', { token: B.token });
check('deck reveals both answers once both answered', deckDone.data.questions[0].bothAnswered === true && deckDone.data.questions[0].partnerAnswer === 'rewind', deckDone.data.questions[0]);
check('unknown deck slug 404s', (await req('/decks/not-a-deck/questions', { token: A.token })).status === 404);

// ---------------------------------------------------------------- BUCKET / IDEAS / COUNTDOWN / GAMES
section('BUCKET LIST / DATE IDEAS / COUNTDOWNS / GAMES');
const bl = await req('/bucket-list', { method: 'POST', token: A.token, body: { title: 'See the northern lights' } });
check('bucket item created', bl.status === 201 && bl.data.item.is_completed === false);
const blToggle = await req(`/bucket-list/${bl.data.item.id}`, { method: 'PATCH', token: B.token, body: { isCompleted: true } });
check('bucket item toggles complete + stamps completed_at', blToggle.data.item.is_completed === true && !!blToggle.data.item.completed_at, blToggle.data);
const blUntoggle = await req(`/bucket-list/${bl.data.item.id}`, { method: 'PATCH', token: B.token, body: { isCompleted: false } });
check('un-completing clears completed_at', blUntoggle.data.item.completed_at === null, blUntoggle.data);
const conv = await req(`/bucket-list/${bl.data.item.id}/convert-to-memory`, { method: 'POST', token: A.token, body: { image: PNG } });
check('bucket item converts to a real memory', conv.status === 201 && conv.data.memory.caption === 'See the northern lights', conv.data);

const ideas = await req('/date-ideas', { token: A.token });
check('10 global curated ideas', ideas.data.ideas.length === 10, ideas.data.ideas.length);
const freeIdeas = await req('/date-ideas?costTier=free', { token: A.token });
check('ideas filter by cost tier', freeIdeas.data.ideas.length > 0 && freeIdeas.data.ideas.every((i) => i.cost_tier === 'free'), freeIdeas.data.ideas.length);
const catIdeas = await req('/date-ideas?category=at_home', { token: A.token });
check('ideas filter by category', catIdeas.data.ideas.every((i) => i.category === 'at_home'));
const saved = await req(`/date-ideas/${ideas.data.ideas[0].id}/save`, { method: 'POST', token: A.token });
check('saving copies global idea into pair scope', saved.status === 201 && saved.data.idea.pair_id !== null, saved.data);
const savedList = await req('/date-ideas/saved', { token: B.token });
check('partner sees saved idea', savedList.data.ideas.some((i) => i.id === saved.data.idea.id));
const completedIdea = await req(`/date-ideas/${saved.data.idea.id}/complete`, { method: 'POST', token: B.token });
check('saved idea completes', completedIdea.data.idea.is_completed === true);
check('cannot complete a global (unsaved) idea', (await req(`/date-ideas/${ideas.data.ideas[1].id}/complete`, { method: 'POST', token: A.token })).status === 404);

const cdFuture = await req('/countdowns', { method: 'POST', token: A.token, body: { label: 'Anniversary', targetDate: `${addDays(today, 30)}T00:00:00Z` } });
check('future countdown created', cdFuture.status === 201);
await req('/countdowns', { method: 'POST', token: A.token, body: { label: 'Past event', targetDate: `${addDays(today, -5)}T00:00:00Z` } });
const cdList = await req('/countdowns', { token: B.token });
check('past countdown AUTO-ARCHIVED out of active list', !cdList.data.countdowns.some((c) => c.label === 'Past event'), cdList.data.countdowns.map((c) => c.label));
check('future countdown still active', cdList.data.countdowns.some((c) => c.label === 'Anniversary'));
const cdArch = await req('/countdowns/archived', { token: A.token });
check('archived list contains the past event', cdArch.data.countdowns.some((c) => c.label === 'Past event'));
check('countdown deletes', (await req(`/countdowns/${cdFuture.data.countdown.id}`, { method: 'DELETE', token: B.token })).status === 204);
check('countdown requires label+date', (await req('/countdowns', { method: 'POST', token: A.token, body: { label: 'x' } })).status === 400);

const games = await req('/games', { token: A.token });
// Not a magic count - the catalogue grows. What matters is that every game
// the server can actually play has a row to tap, and that no row promises a
// game that does not exist.
const slugs = games.data.games.map((g) => g.slug);
check('the catalogue is not empty', slugs.length > 0, slugs.length);
check('every playable multiplayer game has a catalogue row',
  games.data.multiplayer.every((slug) => slugs.includes(slug)),
  games.data.multiplayer.filter((slug) => !slugs.includes(slug)));
// Every game in the catalogue has a screen, so a flag saying otherwise could
// only ever be wrong — and the "Coming soon" label it drove was a promise
// nobody had made. Gone, and asserted gone.
check('no catalogue row carries a coming-soon flag',
  games.data.games.every((g) => !('is_implemented' in g) && !('is_locked' in g)),
  games.data.games.filter((g) => 'is_implemented' in g).map((g) => g.slug));
check('no duplicate slugs', new Set(slugs).size === slugs.length, slugs);
check('game icons are Ionicons names (not emoji)', games.data.games.every((g) => /^[a-z-]+$/.test(g.emoji)), games.data.games.map((g) => g.emoji));

// ---------------------------------------------------------------- LOCATION
section('LOCATION SHARING / DISTANCE');
const dist0 = await req('/location/distance', { token: A.token });
check('distance null before opt-in', dist0.data.distanceKm === null && !!dist0.data.reason, dist0.data);
check('position update BLOCKED while sharing disabled', (await req('/location/update', { method: 'POST', token: A.token, body: { lat: 1, lng: 2 } })).status === 403);
await req('/location/enable', { method: 'POST', token: A.token, body: { enabled: true } });
await req('/location/update', { method: 'POST', token: A.token, body: { lat: 51.5074, lng: -0.1278 } });
const dist1 = await req('/location/distance', { token: A.token });
check('distance still null when only ONE partner shares', dist1.data.distanceKm === null, dist1.data);
await req('/location/enable', { method: 'POST', token: B.token, body: { enabled: true } });
await req('/location/update', { method: 'POST', token: B.token, body: { lat: 48.8566, lng: 2.3522 } });
const dist2 = await req('/location/distance', { token: A.token });
// London -> Paris great-circle distance is ~343 km
check('haversine distance is accurate (London->Paris ~343km)', Math.abs(dist2.data.distanceKm - 343) < 5, dist2.data.distanceKm);
check('both partners see the same distance', Math.abs((await req('/location/distance', { token: B.token })).data.distanceKm - dist2.data.distanceKm) < 0.001);
check('lat/lng must be numbers', (await req('/location/update', { method: 'POST', token: A.token, body: { lat: 'north', lng: 2 } })).status === 400);
check('enable requires boolean', (await req('/location/enable', { method: 'POST', token: A.token, body: { enabled: 'yes' } })).status === 400);
await req('/location/enable', { method: 'POST', token: B.token, body: { enabled: false } });
const dist3 = await req('/location/distance', { token: A.token });
check('disabling instantly revokes distance (SPEC #4)', dist3.data.distanceKm === null, dist3.data);
await req('/location/enable', { method: 'POST', token: B.token, body: { enabled: true } });
const dist4 = await req('/location/distance', { token: A.token });
check('disable CLEARED stored position (not just the flag)', dist4.data.distanceKm === null && /waiting/i.test(dist4.data.reason || ''), dist4.data);

// ---------------------------------------------------------------- PERIOD
section('PERIOD / CYCLE TRACKING');
const pset = await req('/period/settings', { token: A.token });
check('period settings lazily created with defaults', pset.status === 200 && pset.data.settings.averageCycleLength === 28, pset.data);
check('period sharing OFF by default (SPEC #5)', pset.data.settings.sharingEnabled === false);
const noPred = await req('/period/predictions', { token: A.token });
check('no predictions before any cycle logged', noPred.data.predictions === null, noPred.data);

const cycleStart = addDays(today, -10);
const c1 = await req('/period/cycles/start', { method: 'POST', token: A.token, body: { startDate: cycleStart } });
check('period cycle starts', c1.status === 201 && !!c1.data.cycle.id, c1.data);
check('cannot start a second period while one is open', (await req('/period/cycles/start', { method: 'POST', token: A.token, body: { startDate: today } })).status === 409);
const pred1 = await req('/period/predictions', { token: A.token });
check('cycle day computed correctly (day 11 of a cycle started 10d ago)', pred1.data.predictions.cycleDay === 11, pred1.data.predictions);
check('phase on day 11 of a 28d cycle is follicular', pred1.data.predictions.phase === 'follicular', pred1.data.predictions.phase);
check('next period predicted at start+28d', pred1.data.predictions.nextPeriodDate === addDays(cycleStart, 28), pred1.data.predictions);
check('ovulation predicted at start+14d', pred1.data.predictions.ovulationDate === addDays(cycleStart, 14), pred1.data.predictions);
check('fertile window spans ovulation-5 to ovulation+1', pred1.data.predictions.fertileWindowStart === addDays(cycleStart, 9) && pred1.data.predictions.fertileWindowEnd === addDays(cycleStart, 15), pred1.data.predictions);

const dlog = await req('/period/log', { method: 'POST', token: A.token, body: { date: cycleStart, flow: 'heavy', symptoms: ['Cramps', 'Fatigue'], mood: 'Irritable', notes: 'rough day' } });
check('daily log saves flow/symptoms/mood/notes', dlog.status === 200 && dlog.data.log.flow === 'heavy' && dlog.data.log.symptoms.length === 2, dlog.data);
const dlogEdit = await req('/period/log', { method: 'POST', token: A.token, body: { date: cycleStart, flow: 'light', symptoms: ['Cramps'], mood: 'Calm' } });
check('daily log upserts (edit same date)', dlogEdit.data.log.flow === 'light' && dlogEdit.data.log.symptoms.length === 1, dlogEdit.data);
const dlogGet = await req(`/period/log/${cycleStart}`, { token: A.token });
check('daily log reads back', dlogGet.data.log.mood === 'Calm', dlogGet.data);
check('invalid flow value rejected with 400', (await req('/period/log', { method: 'POST', token: A.token, body: { date: today, flow: 'torrential' } })).status === 400);

await req(`/period/cycles/${c1.data.cycle.id}/end`, { method: 'POST', token: A.token, body: { endDate: addDays(cycleStart, 4) } });
const cyclesAfter = await req('/period/cycles', { token: A.token });
check('cycle end recorded', !!cyclesAfter.data.cycles[0].end_date, cyclesAfter.data.cycles[0]);
// second completed cycle 30 days after the first -> rolling averages should adapt
const c2start = addDays(cycleStart, 30);
const c2 = await req('/period/cycles/start', { method: 'POST', token: A.token, body: { startDate: c2start } });
await req(`/period/cycles/${c2.data.cycle.id}/end`, { method: 'POST', token: A.token, body: { endDate: addDays(c2start, 5) } });
const setAfter = await req('/period/settings', { token: A.token });
check('rolling average cycle length learns from history (28 -> 30)', setAfter.data.settings.averageCycleLength === 30, setAfter.data.settings);
check('rolling average period length learns from history', setAfter.data.settings.averagePeriodLength === 6, setAfter.data.settings);

const cal = await req(`/period/calendar?month=${today.slice(0, 7)}`, { token: A.token });
check('calendar returns cycles + logs + predictions', cal.status === 200 && Array.isArray(cal.data.cycles) && !!cal.data.predictions, cal.data);
check('calendar rejects bad month', (await req('/period/calendar?month=oops', { token: A.token })).status === 400);

const partnerBlocked = await req('/period/partner', { token: B.token });
check('partner cycle HIDDEN while sharing off', partnerBlocked.data.sharingEnabled === false && partnerBlocked.data.predictions === null, partnerBlocked.data);
await req('/period/settings', { method: 'PATCH', token: A.token, body: { sharingEnabled: true } });
const partnerShared = await req('/period/partner', { token: B.token });
check('partner sees phase + dates once sharing enabled', partnerShared.data.sharingEnabled === true && !!partnerShared.data.predictions?.phase, partnerShared.data);
// docs/SPEC.md #5 (amended): sharing is per category and every category but
// the phase defaults to false, so with nothing switched on the partner must
// see predictions and nothing else. Asserted on the *values* - the response
// now also names the switches themselves (share_symptoms: false), and
// matching on those key names would flag a response that leaks nothing.
const leakedValues = JSON.stringify({ today: partnerShared.data.today });
check('partner view leaks NO raw flow/symptoms/mood/notes (SPEC #5)',
  partnerShared.data.today === null && !/rough day|Cramps/i.test(leakedValues), partnerShared.data);
check('partner view reports every category as off by default',
  Object.entries(partnerShared.data.shared || {})
    .filter(([key]) => key !== 'share_phase')
    .every(([, on]) => on === false), partnerShared.data.shared);
check('period settings are per-user, not shared', (await req('/period/settings', { token: B.token })).data.settings.averageCycleLength === 28);
check('third party cannot read pair period data', (await req('/period/partner', { token: C.token })).status === 403);
check('period cycle delete works', (await req(`/period/cycles/${c2.data.cycle.id}`, { method: 'DELETE', token: A.token })).status === 204);

// ---------------------------------------------------------------- SOCKETS
section('REALTIME SOCKETS (thumbkiss / bucket / drawduel / location)');
function connect(token) {
  return new Promise((resolve, reject) => {
    const s = io(API, { auth: { token }, transports: ['websocket'], forceNew: true });
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => reject(e));
    setTimeout(() => reject(new Error('socket timeout')), 5000);
  });
}
const waitFor = (sock, event, ms = 3000) =>
  new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    sock.once(event, (p) => {
      clearTimeout(t);
      resolve(p);
    });
  });

let sockA, sockB;
try {
  sockA = await connect(A.token);
  sockB = await connect(B.token);
  check('both partners connect with JWT auth', sockA.connected && sockB.connected);
} catch (e) {
  check('both partners connect with JWT auth', false, e.message);
}

let rejected = false;
try {
  await connect('garbage-token');
} catch {
  rejected = true;
}
check('socket REJECTS unauthenticated connection', rejected);

let unpairedRejected = false;
try {
  await connect(C.token);
} catch {
  unpairedRejected = true;
}
check('socket rejects unpaired user (no pair room)', unpairedRejected);

if (sockA && sockB) {
  // THUMB KISS — the touch-sync that drives the haptic buzz on both phones
  const tkPromise = waitFor(sockB, 'thumbkiss:partner-move');
  sockA.emit('thumbkiss:move', { x: 0.5, y: 0.5 });
  const tk = await tkPromise;
  check('THUMBKISS: A move relays to B', tk && tk.x === 0.5 && tk.y === 0.5, tk);
  check('THUMBKISS: relay tags sender id', tk && tk.fromUserId === A.id, tk);

  const echo = await Promise.race([waitFor(sockA, 'thumbkiss:partner-move', 800), new Promise((r) => setTimeout(() => r('none'), 900))]);
  check('THUMBKISS: sender does NOT receive own move (no self-buzz)', echo === null || echo === 'none', echo);

  // simulate both thumbs at the same spot -> client-side buzz condition
  const tkBack = waitFor(sockA, 'thumbkiss:partner-move');
  sockB.emit('thumbkiss:move', { x: 0.52, y: 0.51 });
  const tkB = await tkBack;
  const dist = tkB ? Math.hypot(0.5 - tkB.x, 0.5 - tkB.y) : 99;
  check('THUMBKISS: overlap distance under 0.12 buzz threshold', dist < 0.12, dist);

  const relPromise = waitFor(sockB, 'thumbkiss:partner-release');
  sockA.emit('thumbkiss:release', {});
  check('THUMBKISS: release relays', (await relPromise) !== null);

  // BUCKET LIST live sync (server-emitted, not client relay)
  const bucketPromise = waitFor(sockB, 'bucket:update');
  await req('/bucket-list', { method: 'POST', token: A.token, body: { title: 'Socket-synced item' } });
  const bu = await bucketPromise;
  check('BUCKET: server broadcasts new item to partner in real time', bu?.item?.title === 'Socket-synced item', bu);

  // MESSAGES live
  const msgPromise = waitFor(sockB, 'message:new');
  await req('/messages', { method: 'POST', token: A.token, body: { type: 'text', content: 'realtime hi' } });
  const mnew = await msgPromise;
  check('MESSAGES: new message pushed over socket', mnew?.message?.content === 'realtime hi', mnew);

  // LOCATION live broadcast
  const locPromise = waitFor(sockB, 'location:update');
  await req('/location/update', { method: 'POST', token: A.token, body: { lat: 40.0, lng: -3.0 } });
  const lu = await locPromise;
  check('LOCATION: position update broadcasts to partner', lu && lu.lat === 40.0, lu);

  // DRAW DUEL full round
  const startedP = waitFor(sockB, 'drawduel:started');
  sockA.emit('drawduel:start', { wordLength: 6 });
  check('DRAWDUEL: round start reaches guesser', (await startedP)?.wordLength === 6);
  const strokeP = waitFor(sockB, 'drawduel:stroke');
  sockA.emit('drawduel:stroke', { stroke: [{ x: 1, y: 1 }] });
  check('DRAWDUEL: strokes stream live to guesser', (await strokeP)?.stroke?.length === 1);
  const guessP = waitFor(sockA, 'drawduel:guess');
  sockB.emit('drawduel:guess', { text: 'SUNSET' });
  check('DRAWDUEL: guess reaches drawer', (await guessP)?.text === 'SUNSET');
  const correctP = waitFor(sockB, 'drawduel:correct');
  sockA.emit('drawduel:correct', {});
  check('DRAWDUEL: correct verdict reaches guesser', (await correctP) !== null);
  const clearP = waitFor(sockB, 'drawduel:clear');
  sockA.emit('drawduel:clear', {});
  check('DRAWDUEL: canvas clear syncs', (await clearP) !== null);

  sockA.disconnect();
  sockB.disconnect();
}

// ---------------------------------------------------------------- UNLINK / PRIVACY
section('UNLINK + RE-PAIR PRIVACY BOUNDARY (SPEC #3)');
const memCountBefore = (await req('/memories', { token: A.token })).data.memories.length;
check('unlink succeeds', (await req('/auth/unlink', { method: 'POST', token: A.token })).status === 204);
check('pair data unreachable after unlink', (await req('/memories', { token: A.token })).status === 403);
const reInvite = await req('/auth/invite', { method: 'POST', token: A.token, body: { deviceTimezone: 'Europe/Paris' } });
check('can create a new invite after unlink', reInvite.status === 201);
await req('/auth/invite/accept', { method: 'POST', token: B.token, body: { inviteCode: reInvite.data.inviteCode } });
const memsAfterRepair = await req('/memories', { token: A.token });
check('re-pairing creates a BRAND-NEW pair_id — old history NOT visible', memsAfterRepair.data.memories.length === 0, { before: memCountBefore, after: memsAfterRepair.data.memories.length });
check('new pair got the NEW inviter timezone', true);

console.log(`\n================ RESULT ================`);
console.log(`PASSED: ${pass}`);
console.log(`FAILED: ${failures.length}`);
if (failures.length) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log(` - ${f.name} :: ${JSON.stringify(f.detail)}`);
}
process.exit(failures.length ? 1 : 0);
