// End-to-end coverage for the Candle / Lovers X parity features, against the
// same real stack as integration.mjs (Postgres + S3 stub + running API).
import { io } from 'socket.io-client';
import { execFileSync } from 'node:child_process';

const API = 'http://localhost:4000';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const stamp = Date.now();
let pass = 0; const fails = [];
const section = (n) => console.log(`\n=== ${n} ===`);
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${JSON.stringify(d)}`); } };

async function req(path, { method = 'GET', body, token, widgetToken } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(widgetToken ? { 'X-Widget-Token': widgetToken } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
function sql(statement) {
  return execFileSync('psql', ['-h', 'localhost', '-U', 'loversrock', '-d', 'loversrock', '-t', '-A', '-c', statement], {
    env: { ...process.env, PGPASSWORD: 'loversrock' }, encoding: 'utf8',
  }).trim();
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const A = { email: `f-a${stamp}@t.dev`, password: 'pw123456', name: 'Malcolm' };
const B = { email: `f-b${stamp}@t.dev`, password: 'pw123456', name: 'Amara' };
const C = { email: `f-c${stamp}@t.dev`, password: 'pw123456', name: 'Outsider' };
for (const u of [A, B, C]) {
  const r = await req('/auth/signup', { method: 'POST', body: u });
  u.token = r.data.accessToken; u.id = r.data.user.id;
}

section('PROFILE / ONBOARDING (unpaired)');
const me0 = await req('/profile/me', { token: A.token });
check('GET /profile/me works before pairing', me0.status === 200 && me0.data.partner === null && me0.data.pair === null, me0.data);
const onb = await req('/profile/onboarding', { method: 'POST', token: A.token, body: { answers: { birthday: '1998-04-12', relationshipType: 'long_distance', goals: ['communication', 'fun'], dailyMinutes: 10, foundVia: 'friend' } } });
check('onboarding answers saved', onb.status === 200 && onb.data.onboarding.relationshipType === 'long_distance' && !!onb.data.onboardedAt, onb.data);
check('onboarding birthday lands on the profile', (await req('/profile/me', { token: A.token })).data.me.birthday === '1998-04-12');
check('onboarding rejects non-object answers', (await req('/profile/onboarding', { method: 'POST', token: A.token, body: { answers: [1] } })).status === 400);

const inv = await req('/auth/invite', { method: 'POST', token: A.token, body: { deviceTimezone: 'UTC' } });
await req('/auth/invite/accept', { method: 'POST', token: B.token, body: { inviteCode: inv.data.inviteCode } });

const sockA = io(API, { auth: { token: A.token }, transports: ['websocket'] });
const sockB = io(API, { auth: { token: B.token }, transports: ['websocket'] });
const eventsA = []; const eventsB = [];
sockA.onAny((e, p) => eventsA.push([e, p]));
sockB.onAny((e, p) => eventsB.push([e, p]));
await wait(400);

section('PROFILES / MOOD (Lovers X)');
await req('/profile', { method: 'PATCH', token: B.token, body: { bio: 'Plant mum', loveLanguage: 'quality_time', favorites: { food: 'jollof' } } });
const partnerView = await req('/profile/partner', { token: A.token });
check('partner profile visible', partnerView.data.partner.bio === 'Plant mum' && partnerView.data.partner.favorites.food === 'jollof', partnerView.data);
check('partner profile never exposes email', !JSON.stringify(partnerView.data).includes(B.email));
check('invalid language rejected', (await req('/profile', { method: 'PATCH', token: A.token, body: { language: 'xx' } })).status === 400);
check('language saved', (await req('/profile', { method: 'PATCH', token: A.token, body: { language: 'fr' } })).data.me.language === 'fr');
const mood = await req('/profile/mood', { method: 'POST', token: B.token, body: { emoji: '😊', text: 'Great day' } });
check('mood set', mood.status === 200 && mood.data.mood.emoji === '😊');
await wait(200);
check('partner receives mood:update live', eventsA.some(([e, p]) => e === 'mood:update' && p.mood.emoji === '😊'));
const meA = await req('/profile/me', { token: A.token });
check('my /me shows partner mood', meA.data.partner.mood?.emoji === '😊', meA.data.partner);
check('mood requires emoji', (await req('/profile/mood', { method: 'POST', token: B.token, body: {} })).status === 400);
check('mood history recorded', (await req('/profile/mood/history', { token: A.token })).data.history.length === 1);
const pairPatch = await req('/profile/pair', { method: 'PATCH', token: A.token, body: { anniversaryDate: '2023-02-14', togetherSince: '2023-01-01', dateSetting: 'city' } });
check('pair anniversary/together-since/date setting saved', pairPatch.data.pair.anniversaryDate === '2023-02-14' && pairPatch.data.pair.daysTogether > 900, pairPatch.data);
check('bad dateSetting rejected', (await req('/profile/pair', { method: 'PATCH', token: A.token, body: { dateSetting: 'moon' } })).status === 400);

section('NOTIFICATION PREFERENCES');
const np = await req('/profile/notifications', { token: A.token });
check('all categories default on', Object.values(np.data.prefs).every(Boolean) && np.data.categories.includes('mood'));
const np2 = await req('/profile/notifications', { method: 'PATCH', token: A.token, body: { mood: false } });
check('category can be muted', np2.data.prefs.mood === false && np2.data.prefs.messages === true);
check('unknown category rejected', (await req('/profile/notifications', { method: 'PATCH', token: A.token, body: { nope: true } })).status === 400);

section('SPARKS');
const s0 = await req('/sparks', { token: A.token });
check('welcome bonus paid once', s0.data.balance === 25, s0.data.balance);
check('welcome bonus is one-shot', (await req('/sparks', { token: A.token })).data.balance === 25);
await req('/sparks', { token: B.token });
const gift = await req('/sparks/gift', { method: 'POST', token: A.token, body: { amount: 10, note: 'for you' } });
check('gift debits sender', gift.data.balance === 15, gift.data);
check('gift credits partner', (await req('/sparks', { token: B.token })).data.balance === 35);
check('cannot gift more than you have', (await req('/sparks/gift', { method: 'POST', token: A.token, body: { amount: 999 } })).status === 402);
check('gift amount validated', (await req('/sparks/gift', { method: 'POST', token: A.token, body: { amount: -5 } })).status === 400);
check('streak freeze needs 40 Sparks', (await req('/sparks/streak-freeze', { method: 'POST', token: A.token })).status === 402);
sql(`INSERT INTO spark_ledger (pair_id, user_id, amount, reason) SELECT id, '${A.id}', 500, 'test_grant' FROM pairs WHERE user_a_id='${A.id}' AND unlinked_at IS NULL`);
const freeze = await req('/sparks/streak-freeze', { method: 'POST', token: A.token });
check('streak freeze purchased', freeze.status === 200 && freeze.data.streakFreezes === 1, freeze.data);
check('hint costs 5', (await req('/sparks/hint', { method: 'POST', token: A.token, body: { game: 'anagrams' } })).data.balance === 515 - 40 - 5);
// Concurrency: 20 parallel 5-spark hints from a balance of 470 must all
// succeed exactly once each and never go negative.
await Promise.all(Array.from({ length: 20 }, () => req('/sparks/hint', { method: 'POST', token: A.token, body: { game: 'x' } })));
check('ledger stays consistent under concurrent spends', (await req('/sparks', { token: A.token })).data.balance === 370);

section('STREAK FREEZE / RESTORE');
// Answered 3 days ago, missed 2 days, 1 freeze banked → not enough, streak lost.
sql(`UPDATE pairs SET streak_count = 9, last_active_date = CURRENT_DATE - 2, streak_freezes = 1 WHERE user_a_id='${A.id}' AND unlinked_at IS NULL`);
await req('/daily-prompt/today/respond', { method: 'POST', token: A.token, body: { answerText: 'a' } });
const both1 = await req('/daily-prompt/today/respond', { method: 'POST', token: B.token, body: { answerText: 'b' } });
check('one missed day covered by a banked freeze keeps the streak', both1.data.streakCount === 10, both1.data.streakCount);
check('freeze consumed', sql(`SELECT streak_freezes FROM pairs WHERE user_a_id='${A.id}' AND unlinked_at IS NULL`) === '0');
sql(`UPDATE pairs SET streak_count = 12, last_active_date = CURRENT_DATE - 4, streak_freezes = 1 WHERE user_a_id='${A.id}' AND unlinked_at IS NULL;
     DELETE FROM prompt_responses WHERE pair_id = (SELECT id FROM pairs WHERE user_a_id='${A.id}' AND unlinked_at IS NULL)`);
await req('/daily-prompt/today/respond', { method: 'POST', token: A.token, body: { answerText: 'a' } });
const both2 = await req('/daily-prompt/today/respond', { method: 'POST', token: B.token, body: { answerText: 'b' } });
check('gap bigger than banked freezes resets to 1', both2.data.streakCount === 1, both2.data.streakCount);
const sp = await req('/sparks', { token: A.token });
check('lost streak recorded for restore', sp.data.lostStreak === 12, sp.data);
const restore = await req('/sparks/streak-restore', { method: 'POST', token: A.token });
check('restore adds the lost streak back', restore.data.streakCount === 13, restore.data);
check('restore is single-use', (await req('/sparks/streak-restore', { method: 'POST', token: A.token })).status === 409);
const earned = sql(`SELECT COUNT(*) FROM spark_ledger WHERE user_id='${B.id}' AND reason IN ('prompt_answer','prompt_both')`);
check('answering the daily question earns Sparks (once per day)', earned === '2', earned);

section('DECKS: SEASONAL / SPARKS / ADAPTIVE');
const decks = await req('/decks', { token: A.token });
const all = Object.values(decks.data.decksByCategory).flat();
check('Sparks Exclusives category present', !!decks.data.decksByCategory['Sparks Exclusives']);
check('out-of-season decks hidden, in-season shown', all.filter((d) => d.is_seasonal).every((d) => d.season_start), all.filter((d) => d.is_seasonal).map((d) => d.slug));
const locked = await req('/decks/sparks-debates/questions', { token: A.token });
check('Sparks deck locked until unlocked (402)', locked.status === 402 && locked.data.sparkCost === 40, locked.data);
const unlock = await req('/sparks/unlock', { method: 'POST', token: A.token, body: { item: 'deck:sparks-debates' } });
check('deck unlocked with Sparks', unlock.status === 200, unlock.data);
check('partner can open the unlocked deck too', (await req('/decks/sparks-debates/questions', { token: B.token })).status === 200);
check('double unlock refused', (await req('/sparks/unlock', { method: 'POST', token: A.token, body: { item: 'deck:sparks-debates' } })).status === 409);
check('existing premium-flagged decks unchanged (still open)', (await req('/decks/would-you-rather-spicy/questions', { token: A.token })).status === 200);
const fy = await req('/decks/for-you?limit=5', { token: A.token });
check('For You returns questions', fy.data.questions.length === 5, fy.data);
const skipId = fy.data.questions[0].id;
check('skip accepted', (await req(`/decks/questions/${skipId}/skip`, { method: 'POST', token: A.token })).status === 204);
const fy2 = await req('/decks/for-you?limit=50', { token: A.token });
check('skipped question never comes back in For You', !fy2.data.questions.some((q) => q.id === skipId));
check('skipping lowers that category weight', fy2.data.categoryWeights[fy.data.questions[0].category] < 1, fy2.data.categoryWeights);

section('CHAT REACTIONS / REPLIES');
const m1 = await req('/messages', { method: 'POST', token: A.token, body: { type: 'text', content: 'hi love' } });
const reply = await req('/messages', { method: 'POST', token: B.token, body: { type: 'text', content: 'hey!', replyToMessageId: m1.data.message.id } });
check('reply links to original', reply.data.message.reply_to_message_id === m1.data.message.id);
const react = await req(`/messages/${m1.data.message.id}/react`, { method: 'POST', token: B.token, body: { emoji: '❤️' } });
check('reaction added', react.data.added === true && react.data.reactions.length === 1);
const list = await req('/messages', { token: A.token });
check('reactions ride along on GET /messages', list.data.messages.find((m) => m.id === m1.data.message.id).reactions[0].emoji === '❤️');
check('reaction toggles off', (await req(`/messages/${m1.data.message.id}/react`, { method: 'POST', token: B.token, body: { emoji: '❤️' } })).data.added === false);

section('FEED (Lovers X)');
const post = await req('/feed', { method: 'POST', token: A.token, body: { body: 'Our first hike!', image: PNG } });
check('post with photo created', post.status === 201 && !!post.data.post.image_url && post.data.post.author_name === 'Malcolm', post.data);
check('empty post rejected', (await req('/feed', { method: 'POST', token: A.token, body: {} })).status === 400);
const like = await req(`/feed/${post.data.post.id}/react`, { method: 'POST', token: B.token, body: { kind: 'like' } });
const love = await req(`/feed/${post.data.post.id}/react`, { method: 'POST', token: B.token, body: { kind: 'love' } });
check('like + love are separate reactions', love.data.post.likes === 1 && love.data.post.loves === 1, love.data.post);
const cm = await req(`/feed/${post.data.post.id}/comments`, { method: 'POST', token: B.token, body: { body: 'Best day' } });
check('comment added', cm.status === 201 && cm.data.comment.author_name === 'Amara');
const feed = await req('/feed', { token: A.token });
check('feed hydrated with counts + comments', feed.data.posts[0].comments.length === 1 && feed.data.posts[0].loves === 1 && feed.data.posts[0].lovedByMe === false);
check('profile view lists only that author', (await req(`/feed/by/${A.id}`, { token: B.token })).data.posts.every((p) => p.author_id === A.id));
check('cannot delete partner\'s post', (await req(`/feed/${post.data.post.id}`, { method: 'DELETE', token: B.token })).status === 404);
check('outsider cannot see feed', (await req('/feed', { token: C.token })).status === 403);

section('NOTES / SECRET MESSAGES');
const note = await req('/notes', { method: 'POST', token: B.token, body: { title: 'Grocery', body: 'Milk & flowers for you' } });
check('note created', note.status === 201);
check('partner cannot edit author\'s words', (await req(`/notes/${note.data.note.id}`, { method: 'PATCH', token: A.token, body: { body: 'x' } })).status === 403);
check('partner can pin', (await req(`/notes/${note.data.note.id}`, { method: 'PATCH', token: A.token, body: { isPinned: true } })).data.note.is_pinned === true);
const secret = await req('/secrets', { method: 'POST', token: B.token, body: { body: 'Look under your pillow' } });
check('secret sent', secret.status === 201);
const inbox = await req('/secrets', { token: A.token });
check('secret body hidden until opened', inbox.data.unopened === 1 && inbox.data.inbox[0].body === null, inbox.data);
const opened = await req(`/secrets/${secret.data.secret.id}/open`, { method: 'POST', token: A.token });
check('opening reveals it', opened.data.secret.body === 'Look under your pillow' && !!opened.data.secret.opened_at);
check('sender cannot "open" their own secret', (await req(`/secrets/${secret.data.secret.id}/open`, { method: 'POST', token: B.token })).status === 404);
await req('/secrets', { method: 'POST', token: B.token, body: { body: 'Second secret' } });

section('SHARED CANVAS / GALLERY');
const stroke = { color: '#E8607A', width: 0.01, points: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }] };
const st = await req('/canvas/strokes', { method: 'POST', token: A.token, body: { strokes: [stroke] } });
check('strokes appended', st.status === 201 && st.data.count === 1);
await wait(200);
check('partner gets strokes live', eventsB.some(([e]) => e === 'canvas:strokes'));
check('invalid stroke rejected', (await req('/canvas/strokes', { method: 'POST', token: A.token, body: { strokes: [{ points: 'no' }] } })).status === 400);
await req('/canvas/strokes', { method: 'POST', token: B.token, body: { strokes: [{ ...stroke, color: '#000000' }] } });
const undo = await req('/canvas/undo', { method: 'POST', token: A.token });
check('undo removes only MY last stroke', undo.data.strokes.length === 1 && undo.data.strokes[0].color === '#000000', undo.data);
const save = await req('/canvas/save', { method: 'POST', token: B.token, body: { title: 'Us', clear: true } });
check('saved to gallery', save.status === 201 && save.data.drawing.strokes.length === 1);
check('clear-on-save empties live canvas', (await req('/canvas', { token: A.token })).data.canvas.strokes.length === 0);
check('gallery lists drawing', (await req('/canvas/gallery', { token: A.token })).data.drawings.length === 1);
const rest = await req(`/canvas/gallery/${save.data.drawing.id}/restore`, { method: 'POST', token: A.token });
check('gallery drawing restores onto canvas', rest.data.strokes.length === 1);

section('DATES: DISCOVER / MATCH / SCHEDULE');
const disc = await req('/dates/discover', { token: A.token });
check('weekly deck returned', disc.data.ideas.length === 20 && /^\d{4}-W\d{2}$/.test(disc.data.week), disc.data.week);
check('deck tailored to city setting', disc.data.ideas.every((i) => !i.settings || i.settings.includes('city')));
check('premium ideas hidden until unlocked', disc.data.ideas.every((i) => !i.is_premium));
const idea = disc.data.ideas[0];
const v1 = await req(`/dates/ideas/${idea.id}/vote`, { method: 'POST', token: A.token, body: { liked: true } });
check('one like is not a match', v1.data.match === false);
const v2 = await req(`/dates/ideas/${idea.id}/vote`, { method: 'POST', token: B.token, body: { liked: true } });
check('both liking = match', v2.data.match === true);
await wait(200);
check('match event broadcast', eventsA.some(([e]) => e === 'dates:match'));
check('swiped idea leaves my deck', !(await req('/dates/discover', { token: A.token })).data.ideas.some((i) => i.id === idea.id));
check('matches listed', (await req('/dates/matches', { token: A.token })).data.matches.some((m) => m.id === idea.id));
const when = new Date(Date.now() + 3 * 864e5).toISOString();
const plan = await req('/dates/plans', { method: 'POST', token: A.token, body: { ideaId: idea.id, scheduledFor: when } });
check('date scheduled from a match', plan.status === 201 && plan.data.plan.title === idea.title && plan.data.plan.status === 'planned');
check('match now flagged planned', (await req('/dates/matches', { token: A.token })).data.matches.find((m) => m.id === idea.id).planned === true);
check('next date surfaces', (await req('/dates/next', { token: B.token })).data.plan.id === plan.data.plan.id);
check('bad status rejected', (await req(`/dates/plans/${plan.data.plan.id}`, { method: 'PATCH', token: A.token, body: { status: 'maybe' } })).status === 400);
const conf = await req(`/dates/plans/${plan.data.plan.id}`, { method: 'PATCH', token: B.token, body: { status: 'confirmed' } });
check('status → confirmed', conf.data.plan.status === 'confirmed' && conf.data.plan.completed_at === null);
const past = await req('/dates/plans', { method: 'POST', token: A.token, body: { title: 'Picnic', scheduledFor: new Date().toISOString(), status: 'done' } });
check('done plan stamps completed_at', !!past.data.plan.completed_at);
const prem = await req('/sparks/unlock', { method: 'POST', token: A.token, body: { item: 'dates:premium' } });
check('premium date pack unlocks', prem.status === 200);
check('premium ideas now reachable', (await req('/dates/discover', { token: A.token })).data.premiumUnlocked === true);

section('MONTHLY CHECK-IN');
const ci0 = await req('/checkins/current', { token: A.token });
check('check-in questions served', ci0.data.questions.length === 9 && /^\d{4}-\d{2}$/.test(ci0.data.month));
const ratings = { connection: 5, communication: 4, quality_time: 4, fun: 5, support: 5 };
check('ratings validated 1..5', (await req('/checkins/current', { method: 'POST', token: A.token, body: { answers: { ...ratings, fun: 9 } } })).status === 400);
const ciA = await req('/checkins/current', { method: 'POST', token: A.token, body: { answers: { ...ratings, highlight: 'The hike' } } });
check('partner answers hidden until both done', ciA.data.partnerAnswers === null && ciA.data.bothDone === false);
const ciB = await req('/checkins/current', { method: 'POST', token: B.token, body: { answers: { ...ratings, connection: 3, improve: 'More calls' } } });
check('revealed once both submit', ciB.data.bothDone && ciB.data.partnerAnswers.highlight === 'The hike', ciB.data);
const hist = await req('/checkins/history', { token: A.token });
check('history has averages', hist.data.history[0].averages.connection === 4, hist.data.history[0]);

section('RANDOM CHALLENGE');
const ch = await req('/challenges/today', { token: A.token });
check("today's challenge is the same for both", ch.data.challenge.key === (await req('/challenges/today', { token: B.token })).data.challenge.key);
const rr = await req('/challenges/today/reroll', { method: 'POST', token: A.token });
check('reroll decrements', rr.data.rerollsLeft === 2);
const done = await req('/challenges/today/complete', { method: 'POST', token: B.token });
check('challenge completes', done.data.completed === true);
check('cannot reroll a finished challenge', (await req('/challenges/today/reroll', { method: 'POST', token: A.token })).status === 409);
for (const kind of ['challenge', 'date', 'game', 'deck']) {
  const r = await req(`/challenges/random?kind=${kind}`, { token: A.token });
  check(`random ${kind} suggestion`, r.data.kind === kind && !!r.data.title && !!r.data.target, r.data);
}

section("WHO'S MORE LIKELY");
const wml = await req('/games/wml', { token: A.token });
check('50 prompts', wml.data.questions.length === 50);
const k = wml.data.questions[0].key;
const va = await req(`/games/wml/${k}/vote`, { method: 'POST', token: A.token, body: { voteFor: 'partner' } });
check('first vote not revealed', va.data.revealed === false);
const vb = await req(`/games/wml/${k}/vote`, { method: 'POST', token: B.token, body: { voteFor: 'me' } });
check('agreeing on the same person is a match', vb.data.revealed && vb.data.match === true, vb.data);
check('score tallies', (await req('/games/wml', { token: A.token })).data.score.matches === 1);
check('bad vote rejected', (await req(`/games/wml/${k}/vote`, { method: 'POST', token: A.token, body: { voteFor: 'dog' } })).status === 400);

section('CHESS (server-validated)');
const g = await req('/games/chess/new', { method: 'POST', token: A.token, body: { color: 'w' } });
check('game created, A is white', g.status === 201 && g.data.game.myColor === 'w' && g.data.game.myTurn === true);
const gid = g.data.game.id;
check('second active game refused', (await req('/games/chess/new', { method: 'POST', token: B.token })).status === 409);
check('black cannot move first', (await req(`/games/chess/${gid}/move`, { method: 'POST', token: B.token, body: { from: 'e7', to: 'e5' } })).status === 409);
check('illegal move rejected', (await req(`/games/chess/${gid}/move`, { method: 'POST', token: A.token, body: { from: 'e2', to: 'e5' } })).status === 400);
const fool = [['A', 'f2', 'f3'], ['B', 'e7', 'e5'], ['A', 'g2', 'g4'], ['B', 'd8', 'h4']];
let last;
for (const [who, from, to] of fool) last = await req(`/games/chess/${gid}/move`, { method: 'POST', token: (who === 'A' ? A : B).token, body: { from, to } });
check("fool's mate detected server-side", last.data.game.status === 'checkmate' && last.data.game.winnerId === B.id, last.data.game);
check('moves after mate refused', (await req(`/games/chess/${gid}/move`, { method: 'POST', token: A.token, body: { from: 'a2', to: 'a3' } })).status === 409);
check('record counts the win', (await req('/games/chess', { token: B.token })).data.record.me === 1);
const g2 = await req('/games/chess/new', { method: 'POST', token: B.token, body: { color: 'b' } });
check('stale index rejected', (await req(`/games/chess/${g2.data.game.id}/move`, { method: 'POST', token: A.token, body: { from: 'e2', to: 'e4', index: 3 } })).status === 409);
check('resign ends game for partner', (await req(`/games/chess/${g2.data.game.id}/resign`, { method: 'POST', token: A.token })).data.game.winnerId === B.id);

section('NUDGES');
check('thumb kiss invite accepted', (await req('/nudges', { method: 'POST', token: A.token, body: { kind: 'thumbkiss' } })).status === 202);
await wait(200);
check('nudge broadcast live', eventsB.some(([e, p]) => e === 'nudge' && p.kind === 'thumbkiss'));
check('unknown nudge rejected', (await req('/nudges', { method: 'POST', token: A.token, body: { kind: 'slap' } })).status === 400);

section('DAILY SNAP');
const snap = await req('/widget-photos', { method: 'POST', token: B.token, body: { image: PNG, caption: 'Coffee ☕' } });
check('snap with caption', snap.data.widgetPhoto.caption === 'Coffee ☕');
const snaps = await req('/widget-photos', { token: A.token });
check('snap history lists sender name', snaps.data.snaps[0].sender_name === 'Amara');
check('snap seen by partner', !!(await req(`/widget-photos/${snap.data.widgetPhoto.id}/seen`, { method: 'PATCH', token: A.token })).data.widgetPhoto.seen_at);

section('ACHIEVEMENTS');
const ach = await req('/achievements', { token: A.token });
const unlockedKeys = ach.data.achievements.filter((a) => a.unlocked).map((a) => a.key);
for (const key of ['first_answer', 'first_snap', 'date_match', 'first_date', 'first_checkin', 'grandmasters', 'secret_keeper']) {
  check(`achievement ${key} unlocked`, unlockedKeys.includes(key), unlockedKeys);
}
check('achievement Sparks paid to both, once', sql(`SELECT COUNT(*) FROM spark_ledger WHERE reason='achievement' AND ref='first_snap' AND user_id IN ('${A.id}', '${B.id}')`) === '2');
check('re-evaluating does not re-pay', (await req('/achievements', { token: B.token })).data.newlyUnlocked.length === 0);

section('TIMELINE');
const tl = await req('/timeline', { token: A.token });
const types = new Set(tl.data.days.flatMap((d) => d.events.map((e) => e.type)));
for (const t of ['snap', 'post', 'date', 'challenge', 'drawing', 'achievement', 'checkin']) check(`timeline includes ${t}`, types.has(t), [...types]);
check('timeline days sorted', tl.data.days.every((d, i, arr) => i === 0 || arr[i - 1].date <= d.date));

section('WIDGET SUMMARY (Candle widgets)');
const wt = (await req('/widget/token', { method: 'POST', token: A.token, body: { label: 'test' } })).data.widgetToken;
const w = (await req('/widget/summary', { widgetToken: wt })).data;
check('partner name + mood', w.partnerName === 'Amara' && w.partnerMood?.emoji === '😊', w);
check('days together from together_since', w.daysTogether > 900, w.daysTogether);
check('anniversary next occurrence', /^\d{4}-02-14$/.test(w.anniversary?.date || '') && w.anniversary.daysRemaining >= 0, w.anniversary);
check('next date', w.nextDate?.title === idea.title, w.nextDate);
check('love note from partner', w.latestNote?.body === 'Milk & flowers for you', w.latestNote);
check('secret waiting flag, never the body', w.secretMessageWaiting === true && !JSON.stringify(w).includes('Second secret'));
check("today's question text", typeof w.todayQuestion === 'string');
check('photo caption + sender', w.latestPhotoCaption === 'Coffee ☕' && w.latestPhotoFromPartner === true);
check('canvas stroke count', w.canvasStrokeCount === 1);
const wc = await req('/widget/canvas', { widgetToken: wt });
check('widget canvas returns strokes without author ids', wc.data.strokes.length === 1 && !('by' in wc.data.strokes[0]), wc.data);
check('widget canvas rejects bearer token', (await req('/widget/canvas', { token: A.token })).status === 401);

sockA.close(); sockB.close();
console.log(`\nFEATURES RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) console.log('FAILURES:', fails);
process.exit(fails.length ? 1 : 0);
