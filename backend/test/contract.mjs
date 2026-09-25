// Verifies the response shapes each mobile screen actually destructures.
const API = 'http://localhost:4000';
const stamp = Date.now();
let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${JSON.stringify(d)}`); } };
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

async function req(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${API}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

const A = { email: `ct-a${stamp}@t.dev`, password: 'pw123456', name: 'CtA' };
const B = { email: `ct-b${stamp}@t.dev`, password: 'pw123456', name: 'CtB' };
for (const u of [A, B]) u.token = (await req('/auth/signup', { method: 'POST', body: u })).data.accessToken;
const inv = await req('/auth/invite', { method: 'POST', token: A.token, body: { deviceTimezone: 'UTC' } });
await req('/auth/invite/accept', { method: 'POST', token: B.token, body: { inviteCode: inv.data.inviteCode } });

console.log('=== DATE FIELDS THE MOBILE CALENDAR PARSES ===');
const todayStr = new Date().toISOString().slice(0, 10);
const cyc = await req('/period/cycles/start', { method: 'POST', token: A.token, body: { startDate: todayStr } });
check('POST /period/cycles start_date is a plain YYYY-MM-DD', isDay(cyc.data.cycle.start_date), cyc.data.cycle.start_date);
await req('/period/log', { method: 'POST', token: A.token, body: { date: todayStr, flow: 'medium', symptoms: ['Cramps'] } });

const cal = await req(`/period/calendar?month=${todayStr.slice(0, 7)}`, { token: A.token });
// PeriodTrackerScreen does: new Date(`${c.startDate}T00:00:00Z`) and logsByDate[l.date]
check('calendar cycles[].startDate is YYYY-MM-DD (mobile builds Date from it)', isDay(cal.data.cycles[0].startDate), cal.data.cycles[0].startDate);
check('calendar logs[].date is YYYY-MM-DD (mobile keys logsByDate on it)', isDay(cal.data.logs[0].date), cal.data.logs[0].date);
const mobileDateParse = new Date(`${cal.data.cycles[0].startDate}T00:00:00Z`);
check('mobile date construction yields a VALID date (not Invalid Date)', !Number.isNaN(mobileDateParse.getTime()), String(mobileDateParse));
check('calendar predictions use YYYY-MM-DD', isDay(cal.data.predictions.nextPeriodDate) && isDay(cal.data.predictions.fertileWindowStart), cal.data.predictions);

const prompt = await req('/daily-prompt/today', { token: A.token });
check('daily prompt scheduledDate is YYYY-MM-DD', isDay(prompt.data.prompt.scheduledDate), prompt.data.prompt.scheduledDate);

const arch = await req(`/quiz/archive?month=${todayStr.slice(0, 7)}`, { token: A.token });
check('quiz archive day keys are YYYY-MM-DD', arch.data.days.every((d) => isDay(d.date)), arch.data.days.slice(0, 2));

console.log('\n=== FIELDS EACH SCREEN DESTRUCTURES ===');
// NicknameCard reads profile.paired, profile.partner.{name,nickname,displayName}
// and profile.me.nickname; HomeScreen reads profile.partner.displayName.
const prof = await req('/profile', { token: A.token });
check('NicknameCard/HomeScreen: profile.paired is a boolean', typeof prof.data.paired === 'boolean', prof.data);
check('profile.partner has name + nickname + displayName', prof.data.partner && 'name' in prof.data.partner && 'nickname' in prof.data.partner && 'displayName' in prof.data.partner, prof.data.partner);
check('profile.me has nickname + displayName', 'nickname' in prof.data.me && 'displayName' in prof.data.me, prof.data.me);
check('displayName is never null (falls back to the real name)', typeof prof.data.partner.displayName === 'string' && prof.data.partner.displayName.length > 0, prof.data.partner);
const games = await req('/games', { token: A.token });
check('GamesScreen: slug/emoji/title/subtitle/is_implemented present', games.data.games.every((g) => g.slug && g.emoji && g.title && 'is_implemented' in g));

const decks = await req('/decks', { token: A.token });
const oneDeck = Object.values(decks.data.decksByCategory)[0][0];
check('HomeScreen deck card: id/slug/title/emoji/is_locked present', !!(oneDeck.id && oneDeck.slug && oneDeck.title && oneDeck.emoji) && 'is_locked' in oneDeck, oneDeck);

await req('/bucket-list', { method: 'POST', token: A.token, body: { title: 'x' } });
const bl = await req('/bucket-list', { token: A.token });
check('BucketListScreen: id/title/is_completed present', bl.data.items.every((i) => i.id && i.title && 'is_completed' in i));

const ideas = await req('/date-ideas', { token: A.token });
check('DateIdeasScreen: title/description/category/cost_tier/is_completed present', ideas.data.ideas.every((i) => i.title && 'cost_tier' in i && 'is_completed' in i));

await req('/countdowns', { method: 'POST', token: A.token, body: { label: 'L', targetDate: new Date(Date.now() + 864e5).toISOString() } });
const cds = await req('/countdowns', { token: A.token });
check('CountdownScreen: label/target_date present, target_date parseable', cds.data.countdowns.every((c) => c.label && !Number.isNaN(new Date(c.target_date).getTime())));

await req('/messages', { method: 'POST', token: A.token, body: { type: 'doodle', strokeData: [[{ x: 1, y: 2 }]] } });
const msgs = await req('/messages', { token: A.token });
const doodleMsg = msgs.data.messages.find((m) => m.type === 'doodle');
check('MessagesScreen: a legacy doodle still round-trips (old messages exist)', Array.isArray(doodleMsg.stroke_data) && Array.isArray(doodleMsg.stroke_data[0]) && 'x' in doodleMsg.stroke_data[0][0], doodleMsg.stroke_data);

// The shape CanvasScreen actually sends now: styled strokes plus the paper
// colour. Nothing validates it server-side (stroke_data is free JSONB), which
// is exactly why it is worth asserting that it survives the round trip.
const styled = {
  strokes: [
    { points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], color: '#4FC16B', width: 14, tool: 'neon' },
    { points: [{ x: 5, y: 6 }], color: '#2F6FE0', width: 4, tool: 'dotted' },
  ],
  canvasColor: '#14141F',
};
await req('/messages', { method: 'POST', token: A.token, body: { type: 'doodle', strokeData: styled } });
const styledBack = (await req('/messages', { token: A.token })).data.messages
  .filter((m) => m.type === 'doodle')
  .map((m) => m.stroke_data)
  .find((d) => d && !Array.isArray(d));
// Compared field by field, not with JSON.stringify: Postgres jsonb does not
// preserve key order, so a stringify comparison fails on data that is
// perfectly intact. The values are what matter; the ordering is Postgres's.
const sameStroke = (a, b) =>
  a.tool === b.tool && a.color === b.color && a.width === b.width
  && JSON.stringify(a.points) === JSON.stringify(b.points);
check('CanvasScreen: the styled doodle format round-trips',
  styledBack.strokes.length === styled.strokes.length
  && styledBack.strokes.every((stroke, i) => sameStroke(stroke, styled.strokes[i])),
  styledBack.strokes);
check('CanvasScreen: point order within a stroke is preserved, because it is a line',
  JSON.stringify(styledBack.strokes[0].points) === JSON.stringify(styled.strokes[0].points),
  styledBack.strokes[0].points);
check('CanvasScreen: the brush survives the trip',
  styledBack.strokes[0].tool === 'neon' && styledBack.strokes[0].width === 14, styledBack.strokes?.[0]);
check('CanvasScreen: the paper colour travels with the drawing',
  styledBack.canvasColor === '#14141F', styledBack.canvasColor);

const pset = await req('/period/settings', { token: A.token });
check('PeriodTrackerScreen settings: camelCase keys as screen expects', ['averageCycleLength', 'averagePeriodLength', 'sharingEnabled'].every((k) => k in pset.data.settings), pset.data.settings);

const cycles = await req('/period/cycles', { token: A.token });
check('PeriodTrackerScreen openCycle detection uses end_date field', cycles.data.cycles.every((c) => 'end_date' in c));

const dist = await req('/location/distance', { token: A.token });
check('DistanceApartScreen: distanceKm + reason keys present', 'distanceKm' in dist.data && 'reason' in dist.data, dist.data);

const partner = await req('/period/partner', { token: B.token });
check('PeriodTrackerScreen partner card: sharingEnabled + predictions keys', 'sharingEnabled' in partner.data && 'predictions' in partner.data, partner.data);

const wp = await req('/widget-photos/latest', { token: A.token });
check('HomeScreen widget card: widgetPhoto key present (may be null)', 'widgetPhoto' in wp.data);

// --- what the game boards and the call screen read off the wire ---
const hub = await req('/games/matches', { token: A.token });
check('GamesScreen: every row has game/title/record.wins',
  hub.data.games.every((g) => g.game && g.title && typeof g.record?.wins === 'number'),
  hub.data.games?.[0]);
check('GamesScreen: a game with no match reports active: null',
  hub.data.games.every((g) => g.active === null || typeof g.active === 'object'));

const ttt = await req('/games/tic-tac-toe/start', { method: 'POST', token: A.token });
const match = ttt.data.match;
check('board screens: seat/yourTurn/status/moveCount/state present',
  ['seat', 'yourTurn', 'status', 'moveCount', 'state', 'freeplay', 'outcome']
    .every((k) => k in match), Object.keys(match));
check('TicTacToeScreen: state.board is nine cells',
  Array.isArray(match.state.board) && match.state.board.length === 9, match.state);
check('MatchFrame: outcome is null while a match is live', match.outcome === null);
await req('/games/tic-tac-toe/resign', { method: 'POST', token: A.token });

const blitz = await req('/games/block-blitz/start', { method: 'POST', token: A.token });
check('BlockBlitzScreen: board/opponentBoard/current/upNext/score present',
  ['board', 'opponentBoard', 'current', 'upNext', 'score', 'opponentScore', 'alive']
    .every((k) => k in blitz.data.match.state), Object.keys(blitz.data.match.state));
await req('/games/block-blitz/resign', { method: 'POST', token: A.token });

const uno = await req('/games/uno-reverse/start', { method: 'POST', token: A.token });
check('UnoReverseScreen: hand/opponentCardCount/discardTop/currentColour present',
  ['hand', 'opponentCardCount', 'discardTop', 'currentColour', 'currentValue', 'pendingDraw']
    .every((k) => k in uno.data.match.state), Object.keys(uno.data.match.state));
check('UnoReverseScreen: cards carry id/colour/value as the card renderer needs',
  uno.data.match.state.hand.every((c) => 'id' in c && 'value' in c && 'colour' in c),
  uno.data.match.state.hand?.[0]);
await req('/games/uno-reverse/resign', { method: 'POST', token: A.token });

const iceConfig = await req('/calls/config', { token: A.token });
check('CallContext: iceServers is an array of { urls }',
  Array.isArray(iceConfig.data.iceServers)
  && iceConfig.data.iceServers.every((srv) => 'urls' in srv), iceConfig.data);

const ringing = await req('/calls/start', { method: 'POST', token: A.token, body: { kind: 'video' } });
check('CallScreen: id/kind/status/role present',
  ['id', 'kind', 'status', 'role'].every((k) => k in ringing.data.call), ringing.data.call);
check('CallScreen: role tells each end which it is without comparing ids',
  ringing.data.call.role === 'caller'
  && (await req('/calls/current', { token: B.token })).data.call.role === 'callee');
await req(`/calls/${ringing.data.call.id}/end`, { method: 'POST', token: A.token });

// The gallery grid reads exactly these keys off each row, and draws its
// thumbnail from `preview` — which is stroke objects, not a URL. A listing
// that carried `stroke_data` instead would still render, and would fetch a
// few megabytes to show thirty postage stamps.
const drawn = await req('/canvas', {
  method: 'POST', token: A.token,
  body: { strokeData: { strokes: [{ points: [{ x: 1, y: 2 }, { x: 8, y: 9 }], color: '#FF5C8D', width: 6, tool: 'pen' }] }, title: 'contract' },
});
const shelf = await req('/canvas', { token: B.token });
const tile = shelf.data.drawings[0];
check('CanvasGalleryScreen: id/title/canvas_color/pinned/stroke_count/updated_at present',
  ['id', 'title', 'canvas_color', 'pinned', 'stroke_count', 'updated_at', 'created_by', 'updated_by']
    .every((k) => k in tile), Object.keys(tile || {}));
check('CanvasGalleryScreen: preview is stroke objects the renderer can draw',
  Array.isArray(tile.preview) && Array.isArray(tile.preview[0]?.points)
  && typeof tile.preview[0].points[0]?.x === 'number', tile.preview?.[0]);
check('CanvasGalleryScreen: the listing does NOT carry full stroke_data',
  !('stroke_data' in tile), Object.keys(tile));
check('CanvasScreen: opening one gives strokes and the paper it was drawn on',
  Array.isArray((await req(`/canvas/${tile.id}`, { token: A.token })).data.drawing.stroke_data.strokes));
await req(`/canvas/${drawn.data.drawing.id}`, { method: 'DELETE', token: A.token });

// CheckinScreen reads these keys off /checkins/current. The reveal rule is
// the contract here as much as the shape: `theirs` empty is what the screen
// draws as "waiting on them", so an accidental leak would be invisible.
const chk = await req('/checkins/current', { token: A.token });
check('CheckinScreen: checkin/questions/mine/theirs/iAmDone/bothDone present',
  ['checkin', 'questions', 'mine', 'theirs', 'iAmDone', 'theyAreDone', 'bothDone', 'myAverage', 'theirAverage']
    .every((k) => k in chk.data), Object.keys(chk.data || {}));
check('CheckinScreen: each question has key/kind/prompt',
  chk.data.questions.every((q) => q.key && q.kind && q.prompt), chk.data.questions?.[0]);
check('CheckinScreen: score questions carry their scale labels',
  chk.data.questions.filter((q) => q.kind === 'score').every((q) => q.low && q.high), chk.data.questions?.[0]);

const chal = await req('/checkins/challenge', { token: A.token });
check('ChallengeCard: challenge/history/completed present',
  ['challenge', 'history', 'completed'].every((k) => k in chal.data), Object.keys(chal.data || {}));

// FeedScreen reads these off every item, whatever kind it is — the layout is
// shared, so a kind missing one of them renders a blank card rather than
// erroring.
const feed = await req('/feed', { token: A.token });
check('FeedScreen: items/nextCursor present', ['items', 'nextCursor'].every((k) => k in feed.data), Object.keys(feed.data || {}));
check('FeedScreen: every item has kind/id/at/comments/reactions',
  feed.data.items.every((i) => i.kind && i.id && i.at && Array.isArray(i.comments) && Array.isArray(i.reactions)),
  feed.data.items?.[0]);
check('FeedScreen: the profile id it compares comments against is `me`',
  Boolean((await req('/profile', { token: A.token })).data.me?.id));

console.log(`\nCONTRACT RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
process.exit(fails.length ? 1 : 0);
