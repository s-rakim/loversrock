// Moods, notes, sealed notes and reactions.
//
// The assertion that matters most here is the sealed note: "hidden" has to
// mean the body never leaves the server, not that the client agrees not to
// draw it. A feature that hides something by asking nicely is a decoration.
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
  const u = { email: `presence-${n}${stamp}@t.dev`, password: 'pw123456', name: n };
  const r = await req('/auth/signup', { method: 'POST', body: u });
  return { ...u, token: r.data.accessToken, id: r.data.user.id };
};

const A = await signup('Ana');
const B = await signup('Ben');
const C = await signup('Cal');
const invite = await req('/auth/invite', { method: 'POST', token: A.token, body: { deviceTimezone: 'UTC' } });
await req('/auth/invite/accept', { method: 'POST', token: B.token, body: { inviteCode: invite.data.inviteCode, deviceTimezone: 'UTC' } });

console.log('=== MOOD ===');
const empty = await req('/presence/moods', { token: A.token });
check('nobody has a mood to start', empty.data.mine === null && empty.data.theirs === null, empty.data);

const set = await req('/presence/moods', { method: 'PUT', token: A.token, body: { mood: 'loved', note: 'thinking of you' } });
check('a mood can be set', set.status === 200 && set.data.mood.mood === 'loved', set.data);
check('with a note', set.data.mood.note === 'thinking of you');
check('junk moods are refused',
  (await req('/presence/moods', { method: 'PUT', token: A.token, body: { mood: 'banana' } })).status === 400);

const seen = await req('/presence/moods', { token: B.token });
check('the partner sees it as theirs', seen.data.theirs?.mood === 'loved', seen.data.theirs);
check('and their own is still empty', seen.data.mine === null);

// A mood is a current state, not a log: setting it again replaces the row.
await req('/presence/moods', { method: 'PUT', token: A.token, body: { mood: 'tired' } });
const after = await req('/presence/moods', { token: B.token });
check('setting it again replaces rather than stacks', after.data.theirs.mood === 'tired', after.data.theirs);
check('and clears the old note', after.data.theirs.note === null, after.data.theirs.note);

console.log('\n=== NOTES ===');
const note = await req('/presence/notes', { method: 'POST', token: A.token, body: { body: 'you looked nice today' } });
check('a note posts', note.status === 201, note.data);
const theirNotes = await req('/presence/notes', { token: B.token });
check('the partner can read an open note',
  theirNotes.data.notes.find((n) => n.id === note.data.note.id)?.body === 'you looked nice today');

console.log('\n=== A SEALED NOTE IS SEALED ON THE SERVER ===');
const secret = 'meet me on the roof at nine';
const sealed = await req('/presence/notes', { method: 'POST', token: A.token, body: { body: secret, sealed: true } });
check('a sealed note posts', sealed.status === 201 && sealed.data.note.sealed === true, sealed.data);

const beforeOpen = await req('/presence/notes', { token: B.token });
const hidden = beforeOpen.data.notes.find((n) => n.id === sealed.data.note.id);
check('the recipient is told one is waiting', hidden?.isSealed === true, hidden);
// The whole point. Not "the client hides it" — the bytes are not sent.
check('and the body is NOT in the response', hidden?.body === null, hidden?.body);
check('nor anywhere else in the payload', !JSON.stringify(beforeOpen.data).includes('roof'));

// The author can still read their own, which is not a leak — they wrote it.
const mine = await req('/presence/notes', { token: A.token });
check('the author can still see what they sealed',
  mine.data.notes.find((n) => n.id === sealed.data.note.id)?.body === secret);

const opened = await req(`/presence/notes/${sealed.data.note.id}/open`, { method: 'POST', token: B.token });
check('the recipient can break the seal', opened.status === 200, opened.data);
const afterOpen = await req('/presence/notes', { token: B.token });
check('and now reads it', afterOpen.data.notes.find((n) => n.id === sealed.data.note.id)?.body === secret);
check('opening twice is refused, so "opened" means something',
  (await req(`/presence/notes/${sealed.data.note.id}/open`, { method: 'POST', token: B.token })).status === 404);

const ownSeal = await req('/presence/notes', { method: 'POST', token: A.token, body: { body: 'x', sealed: true } });
check('the author cannot open their own note to fake a read',
  (await req(`/presence/notes/${ownSeal.data.note.id}/open`, { method: 'POST', token: A.token })).status === 404);

console.log('\n=== REACTIONS ===');
const msg = await req('/messages', { method: 'POST', token: A.token, body: { type: 'text', content: 'hi' } });
const react = await req('/presence/reactions', {
  method: 'PUT', token: B.token, body: { targetKind: 'message', targetId: msg.data.message.id, emoji: '❤️' },
});
check('a reaction lands', react.status === 200 && react.data.reaction.emoji === '❤️', react.data);

const list = await req('/presence/reactions/message', { token: A.token });
check('and is grouped by target', list.data.reactions[msg.data.message.id]?.length === 1, list.data.reactions);

// Two of you cannot run a counter up between you — reacting again replaces.
await req('/presence/reactions', {
  method: 'PUT', token: B.token, body: { targetKind: 'message', targetId: msg.data.message.id, emoji: '😂' },
});
const replaced = await req('/presence/reactions/message', { token: A.token });
check('reacting again replaces rather than stacks',
  replaced.data.reactions[msg.data.message.id].length === 1, replaced.data.reactions[msg.data.message.id]);
check('with the new emoji', replaced.data.reactions[msg.data.message.id][0].emoji === '😂');

// But both people can react to the same thing.
await req('/presence/reactions', {
  method: 'PUT', token: A.token, body: { targetKind: 'message', targetId: msg.data.message.id, emoji: '🔥' },
});
const both = await req('/presence/reactions/message', { token: A.token });
check('both partners can react to the same thing',
  both.data.reactions[msg.data.message.id].length === 2, both.data.reactions[msg.data.message.id]);

await req('/presence/reactions', {
  method: 'PUT', token: A.token, body: { targetKind: 'message', targetId: msg.data.message.id, emoji: null },
});
const removed = await req('/presence/reactions/message', { token: A.token });
check('and can take it back off', removed.data.reactions[msg.data.message.id].length === 1);
check('an unknown target kind is refused',
  (await req('/presence/reactions', { method: 'PUT', token: A.token, body: { targetKind: 'spaceship', targetId: msg.data.message.id, emoji: '❤️' } })).status === 400);

console.log('\n=== DAYS TOGETHER ===');
const set2 = await req('/profile/together-since', { method: 'PUT', token: A.token, body: { togetherSince: '2024-02-14' } });
check('the anniversary saves', set2.status === 200, set2.data);
const profile = await req('/profile', { token: B.token });
check('both sides see it', profile.data.togetherSince?.startsWith('2024-02-14'), profile.data.togetherSince);
check('and days together is computed server-side, so both phones agree',
  profile.data.daysTogether > 500, profile.data.daysTogether);
check('a future date is refused, since days together cannot be negative',
  (await req('/profile/together-since', { method: 'PUT', token: A.token, body: { togetherSince: '2099-01-01' } })).status === 400);
check('and it can be cleared',
  (await req('/profile/together-since', { method: 'PUT', token: A.token, body: { togetherSince: null } })).data.togetherSince === null);

console.log('\n=== OUTSIDE THE PAIR ===');
check('a stranger gets no moods', (await req('/presence/moods', { token: C.token })).status === 403);
check('no notes', (await req('/presence/notes', { token: C.token })).status === 403);
check('and cannot react to this pair’s messages',
  (await req('/presence/reactions', { method: 'PUT', token: C.token, body: { targetKind: 'message', targetId: msg.data.message.id, emoji: '❤️' } })).status === 403);


console.log('\n=== CHARACTERS AND THE WARDROBE ===');
{
  const cat = await req('/presence/wardrobe', { token: A.token });
  check('the catalogue is served from the server', cat.status === 200, cat.status);
  // It has to come from here, not only the client: a phone on an older build
  // would otherwise render a garment it has never heard of, and the sensible
  // fallback for "unknown garment" is nothing at all.
  check('with garments for every slot',
    ['top', 'bottom', 'shoes', 'accessory'].every((k) => Object.keys(cat.data.WARDROBE[k] || {}).length > 0),
    Object.keys(cat.data.WARDROBE || {}));
  check('and the palettes to dress them in',
    Object.keys(cat.data.GARMENT_COLORS).length > 8 && Object.keys(cat.data.SKINS).length > 3);

  const fresh = await req('/presence/avatars', { token: A.token });
  check('everyone has a character before touching anything',
    Boolean(fresh.data.mine?.outfit?.top?.id), fresh.data.mine);
  check('including the partner', Boolean(fresh.data.theirs?.outfit?.bottom?.id), fresh.data.theirs);

  const dressed = await req('/presence/avatars', {
    method: 'PUT', token: A.token,
    body: {
      skin: 'deep', hair: 'locs', hairColor: 'black', build: 'average',
      outfit: {
        top: { id: 'jersey', color: 'navy', accent: 'red' },
        bottom: { id: 'cargo', color: 'olive' },
        shoes: { id: 'slides', color: 'teal' },
        accessory: { id: 'chain' },
      },
    },
  });
  check('a character can be dressed', dressed.status === 200, dressed.data);
  check('and it keeps what was chosen',
    dressed.data.avatar.hair === 'locs' && dressed.data.avatar.outfit.top.id === 'jersey',
    dressed.data.avatar);
  check('including the trim on a garment that takes one',
    dressed.data.avatar.outfit.top.accent === 'red', dressed.data.avatar.outfit.top);

  const seen = await req('/presence/avatars', { token: B.token });
  check('the partner sees what you put on',
    seen.data.theirs.outfit.top.id === 'jersey' && seen.data.theirs.skin === 'deep',
    seen.data.theirs);
  check('and their own is untouched', seen.data.mine.outfit.top.id !== 'jersey');

  // The failure mode that matters: an unknown garment must not undress anyone.
  const junk = await req('/presence/avatars', {
    method: 'PUT', token: A.token,
    body: { skin: 'plaid', hair: 'mohawk', outfit: { top: { id: 'spacesuit', color: 'ultraviolet' } } },
  });
  check('junk is accepted and normalised rather than rejected', junk.status === 200, junk.data);
  check('an unknown garment falls back to clothed, not naked',
    Boolean(junk.data.avatar.outfit.top.id && junk.data.avatar.outfit.bottom.id && junk.data.avatar.outfit.shoes.id),
    junk.data.avatar.outfit);
  check('and an unknown colour falls back to a real one',
    /^[a-z]+$/.test(junk.data.avatar.outfit.top.color), junk.data.avatar.outfit.top.color);
  check('an unknown skin falls back too', junk.data.avatar.skin === 'medium', junk.data.avatar.skin);

  // You dress yours, never theirs.
  const before = (await req('/presence/avatars', { token: B.token })).data.mine;
  await req('/presence/avatars', { method: 'PUT', token: A.token, body: { ...before, userId: B.id, skin: 'porcelain' } });
  const after = (await req('/presence/avatars', { token: B.token })).data.mine;
  check('you cannot dress your partner by naming them in the body',
    after.skin === before.skin, { before: before.skin, after: after.skin });
}

console.log('\n=== NUDGES: THE IN-APP HALF OF THE QUICK-KISS WIDGET ===');
const quiet = await req('/presence/nudges', { token: A.token });
check('nobody has nudged yet', quiet.data.theirs === null && quiet.data.mine === null && quiet.data.unseen === 0, quiet.data);

const sent = await req('/presence/nudges', { method: 'POST', token: A.token, body: { kind: 'kiss' } });
check('a kiss sends from the app', sent.status === 201 && sent.data.sent === true, sent.data);
// Same thirty seconds the widget gets: a double-tap is one kiss, and a
// second press is a no-op rather than an error to render.
const twice = await req('/presence/nudges', { method: 'POST', token: A.token });
check('a second one straight away is throttled', twice.data.throttled === true && twice.data.sent === false, twice.data);

const seenByThem = await req('/presence/nudges', { token: B.token });
check('they see it as theirs', seenByThem.data.theirs?.kind === 'kiss', seenByThem.data);
check('with one unseen', seenByThem.data.unseen === 1, seenByThem.data.unseen);
check('and their own side is still empty', seenByThem.data.mine === null);

const mineBack = await req('/presence/nudges', { token: A.token });
check('the sender sees it as mine', mineBack.data.mine?.kind === 'kiss', mineBack.data);
check('and has nothing unseen of their own', mineBack.data.unseen === 0);

await req('/presence/nudges/seen', { method: 'POST', token: B.token });
check('marking seen clears the badge', (await req('/presence/nudges', { token: B.token })).data.unseen === 0);
check('but the nudge itself is still there', Boolean((await req('/presence/nudges', { token: B.token })).data.theirs));
check('and marking seen does not clear the SENDER’s view',
  Boolean((await req('/presence/nudges', { token: A.token })).data.mine));

check('an unknown kind falls back to a kiss rather than 400ing',
  ['kiss'].includes((await req('/presence/nudges', { method: 'POST', token: B.token, body: { kind: 'headbutt' } })).data.nudge?.kind));
check('a third party sees none of it', (await req('/presence/nudges', { token: C.token })).status === 403);

console.log(`\nPRESENCE RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
process.exit(0);
