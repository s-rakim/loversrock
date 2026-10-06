// The chat, grown up: what Nextcloud Talk's chat does, for two.
//
// Against a live stack (Postgres, storage, the backend on :4000): replies,
// reactions, edit, delete, "Seen", typing, polls, shared places, scheduled
// and silent messages, pins, reminders, and the thread a page at a time.
import 'dotenv/config';
import { io } from 'socket.io-client';
import { query } from '../src/config/db.js';
import { releaseScheduledMessages, sendMessageReminders, EDIT_WINDOW_MS } from '../src/routes/messages.js';

const API = 'http://localhost:4000';
const stamp = Date.now();
let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${JSON.stringify(d)}`); } };

async function req(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data };
}
const signup = async (name) => {
  const u = { email: `chat-${name}${stamp}@t.dev`, password: 'pw123456', name };
  const r = await req('/auth/signup', { method: 'POST', body: u });
  return { ...u, token: r.data.accessToken, id: r.data.user.id };
};
const socketFor = (token) => new Promise((resolve, reject) => {
  const s = io(API, { auth: { token }, transports: ['websocket'] });
  s.on('connect', () => resolve(s));
  s.on('connect_error', reject);
});
const waitFor = (socket, event, ms = 3000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), ms);
  socket.once(event, (payload) => { clearTimeout(timer); resolve(payload); });
});
const send = (who, body) => req('/messages', { method: 'POST', token: who.token, body });

const A = await signup('Ana');
const B = await signup('Ben');
const C = await signup('Cal');
const D = await signup('Dee');
const invite = await req('/auth/invite', { method: 'POST', token: A.token, body: { deviceTimezone: 'UTC' } });
await req('/auth/invite/accept', { method: 'POST', token: B.token, body: { inviteCode: invite.data.inviteCode, deviceTimezone: 'UTC' } });
const invite2 = await req('/auth/invite', { method: 'POST', token: C.token, body: { deviceTimezone: 'UTC' } });
await req('/auth/invite/accept', { method: 'POST', token: D.token, body: { inviteCode: invite2.data.inviteCode, deviceTimezone: 'UTC' } });
const sockA = await socketFor(A.token);
const sockB = await socketFor(B.token);

console.log('=== REPLIES AND REACTIONS ===');
const first = await send(A, { type: 'text', content: 'morning' });
const reply = await send(B, { type: 'text', content: 'morning you', replyToMessageId: first.data.message.id });
check('a reply points at the message it answers', reply.status === 201 && reply.data.message.reply_to_message_id === first.data.message.id, reply.data);
const otherPair = await send(C, { type: 'text', content: 'elsewhere' });
const crossReply = await send(A, { type: 'text', content: 'hm', replyToMessageId: otherPair.data.message.id });
check("cannot reply to another pair's message", crossReply.status === 400, crossReply.data);
await req('/presence/reactions', { method: 'PUT', token: B.token, body: { targetKind: 'message', targetId: first.data.message.id, emoji: '❤️' } });
const withReactions = await req('/messages', { token: A.token });
const reacted = withReactions.data.messages.find((m) => m.id === first.data.message.id);
check('reactions come with the thread', reacted?.reactions?.length === 1 && reacted.reactions[0].emoji === '❤️' && reacted.reactions[0].userId === B.id, reacted?.reactions);

console.log('\n=== EDIT AND DELETE ===');
const updated = waitFor(sockB, 'message:updated');
const edit = await req(`/messages/${first.data.message.id}`, { method: 'PATCH', token: A.token, body: { content: 'good morning' } });
check('the sender can edit a text', edit.status === 200 && edit.data.message.content === 'good morning' && edit.data.message.edited_at, edit.data);
const heard = await updated;
check('and the other phone hears the edit', heard.message.content === 'good morning', heard);
const notMine = await req(`/messages/${first.data.message.id}`, { method: 'PATCH', token: B.token, body: { content: 'hijack' } });
check("cannot edit the other one's message", notMine.status === 403, notMine.status);
await query('UPDATE messages SET sent_at = now() - $2::interval WHERE id = $1', [reply.data.message.id, `${EDIT_WINDOW_MS + 60000} milliseconds`]);
const late = await req(`/messages/${reply.data.message.id}`, { method: 'PATCH', token: B.token, body: { content: 'too late' } });
check('a day later it can no longer be edited', late.status === 400, late.data);
const photo = await send(A, { type: 'photo', image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' });
const del = await req(`/messages/${photo.data.message.id}`, { method: 'DELETE', token: A.token });
check('deleting keeps the place in the thread but empties it', del.status === 200 && del.data.message.deleted_at && del.data.message.image_url === null, del.data);
const delOther = await req(`/messages/${reply.data.message.id}`, { method: 'DELETE', token: A.token });
check("cannot delete the other one's message", delOther.status === 403, delOther.status);
const editDeleted = await req(`/messages/${photo.data.message.id}`, { method: 'PATCH', token: A.token, body: { content: 'x' } });
check('a deleted message cannot be edited', editDeleted.status === 404, editDeleted.status);

console.log('\n=== SEEN AND TYPING ===');
const seenHeard = waitFor(sockA, 'message:seen');
const seen = await req('/messages/seen', { method: 'POST', token: B.token });
const seenEvent = await seenHeard;
check('opening the chat marks everything from the other one as seen', seen.data.seen >= 1 && seenEvent.by === B.id && seenEvent.ids.includes(first.data.message.id), { seen: seen.data, seenEvent });
const again = await req('/messages/seen', { method: 'POST', token: B.token });
check('and only once', again.data.seen === 0, again.data);
const typingHeard = waitFor(sockB, 'chat:typing');
sockA.emit('chat:typing', { typing: true, junk: 'x' });
const typing = await typingHeard;
check('"typing…" reaches the other phone, and nothing else with it', typing.typing === true && typing.fromUserId === A.id && !('junk' in typing), typing);

console.log('\n=== POLLS ===');
const badPoll = await send(A, { type: 'poll', content: JSON.stringify({ question: 'Dinner?', options: ['Pizza'] }) });
check('a poll needs at least two options', badPoll.status === 400, badPoll.data);
const poll = await send(A, { type: 'poll', content: JSON.stringify({ question: 'Dinner?', options: ['Pizza', 'Sushi', 'Tacos'] }) });
check('a poll is asked', poll.status === 201 && poll.data.message.meta.optionCount === 3 && poll.data.message.meta.multi === false, poll.data);
const sealed = await send(A, { type: 'poll', content: 'sealed:abc', encrypted: true, poll: { options: 4, multi: true } });
check('a sealed poll states its number of options', sealed.status === 201 && sealed.data.message.meta.optionCount === 4 && sealed.data.message.meta.multi === true, sealed.data);
const vote = await req(`/messages/${poll.data.message.id}/vote`, { method: 'PUT', token: B.token, body: { choices: [1] } });
check('a vote counts', vote.status === 200 && vote.data.message.votes.length === 1 && vote.data.message.votes[0].choice === 1, vote.data);
const two = await req(`/messages/${poll.data.message.id}/vote`, { method: 'PUT', token: B.token, body: { choices: [0, 1] } });
check('one answer only, on a poll that takes one', two.status === 400, two.data);
const outOfRange = await req(`/messages/${poll.data.message.id}/vote`, { method: 'PUT', token: B.token, body: { choices: [3] } });
check('no voting for an option that is not there', outOfRange.status === 400, outOfRange.data);
const multi = await req(`/messages/${sealed.data.message.id}/vote`, { method: 'PUT', token: B.token, body: { choices: [0, 2] } });
check('several answers on a poll that takes several', multi.status === 200 && multi.data.message.votes.length === 2, multi.data);
const change = await req(`/messages/${poll.data.message.id}/vote`, { method: 'PUT', token: B.token, body: { choices: [2] } });
check('changing your vote replaces it', change.data.message.votes.length === 1 && change.data.message.votes[0].choice === 2, change.data);
const closeOther = await req(`/messages/${poll.data.message.id}/close`, { method: 'POST', token: B.token });
check('only whoever asked can end a poll', closeOther.status === 403, closeOther.status);
const closed = await req(`/messages/${poll.data.message.id}/close`, { method: 'POST', token: A.token });
check('ending it', closed.data.message.meta.closed === true, closed.data);
const afterClose = await req(`/messages/${poll.data.message.id}/vote`, { method: 'PUT', token: A.token, body: { choices: [0] } });
check('and no more votes after', afterClose.status === 400, afterClose.data);

console.log('\n=== A SHARED PLACE ===');
const place = await send(B, { type: 'location', content: JSON.stringify({ lat: 51.5, lng: -0.12, label: 'Here' }) });
check('a place is shared', place.status === 201 && place.data.message.type === 'location', place.data);
const nowhere = await send(B, { type: 'location', content: JSON.stringify({ lat: 200, lng: 0 }) });
check('a place has to be on Earth', nowhere.status === 400, nowhere.data);

console.log('\n=== SCHEDULED AND SILENT ===');
const later = new Date(Date.now() + 3600_000).toISOString();
const scheduled = await send(A, { type: 'text', content: 'happy birthday', sendAt: later });
check('a message can be scheduled', scheduled.status === 201 && scheduled.data.message.scheduled_for, scheduled.data);
const mine = await req('/messages', { token: A.token });
const theirs = await req('/messages', { token: B.token });
check('the sender sees it waiting', mine.data.messages.some((m) => m.id === scheduled.data.message.id));
check('the other one does not, yet', !theirs.data.messages.some((m) => m.id === scheduled.data.message.id));
await query("UPDATE messages SET scheduled_for = now() - interval '1 second' WHERE id = $1", [scheduled.data.message.id]);
const released = await releaseScheduledMessages(null);
const theirsNow = await req('/messages', { token: B.token });
const arrived = theirsNow.data.messages.find((m) => m.id === scheduled.data.message.id);
check('when its time comes, it is sent', released >= 1 && arrived && arrived.scheduled_for === null, { released, arrived });
const second = await send(A, { type: 'text', content: 'later', sendAt: later });
const nowHeard = waitFor(sockB, 'message:new');
const sendNow = await req(`/messages/${second.data.message.id}`, { method: 'PATCH', token: A.token, body: { sendAt: 'now' } });
const nowEvent = await nowHeard;
check('"send now" sends a scheduled one at once', sendNow.data.message.scheduled_for === null && nowEvent.message.id === second.data.message.id, sendNow.data);
const third = await send(A, { type: 'text', content: 'never mind', sendAt: later });
const cancel = await req(`/messages/${third.data.message.id}`, { method: 'DELETE', token: A.token });
check('a scheduled one can be cancelled, and leaves nothing', cancel.data.removed === true
  && !(await req('/messages', { token: A.token })).data.messages.some((m) => m.id === third.data.message.id), cancel.data);
const silent = await send(A, { type: 'text', content: 'shh', silent: true });
check('a message can be sent without a notification', silent.data.message.silent === true, silent.data);

console.log('\n=== PINS AND REMINDERS ===');
const pin = await req(`/messages/${reply.data.message.id}/pin`, { method: 'PUT', token: A.token, body: {} });
check('either of you can pin a message', pin.status === 200 && pin.data.message.pinned_at && pin.data.message.pinned_by === A.id, pin.data);
const listed = await req('/messages', { token: B.token });
check('pinned messages come with the thread', listed.data.pinned.some((m) => m.id === reply.data.message.id), listed.data.pinned);
const pinUntil = await req(`/messages/${place.data.message.id}/pin`, { method: 'PUT', token: B.token, body: { until: new Date(Date.now() + 60_000).toISOString() } });
await query("UPDATE messages SET pinned_until = now() - interval '1 second' WHERE id = $1", [place.data.message.id]);
const expired = await req('/messages', { token: B.token });
check('a pin "until" a time goes away after it', pinUntil.status === 200 && !expired.data.pinned.some((m) => m.id === place.data.message.id), expired.data.pinned);
await req(`/messages/${reply.data.message.id}/pin`, { method: 'DELETE', token: B.token });
check('unpinning', !(await req('/messages', { token: A.token })).data.pinned.some((m) => m.id === reply.data.message.id));
const past = await req(`/messages/${first.data.message.id}/reminder`, { method: 'PUT', token: B.token, body: { at: new Date(Date.now() - 1000).toISOString() } });
check('a reminder has to be in the future', past.status === 400, past.data);
const remind = await req(`/messages/${first.data.message.id}/reminder`, { method: 'PUT', token: B.token, body: { at: new Date(Date.now() + 60_000).toISOString() } });
const withReminder = await req('/messages', { token: B.token });
check('"remind me" is kept, for you alone', remind.status === 200
  && withReminder.data.messages.find((m) => m.id === first.data.message.id)?.reminder
  && !(await req('/messages', { token: A.token })).data.messages.find((m) => m.id === first.data.message.id)?.reminder);
await query("UPDATE message_reminders SET remind_at = now() - interval '1 second' WHERE message_id = $1", [first.data.message.id]);
const sent = await sendMessageReminders();
const gone = await query('SELECT 1 FROM message_reminders WHERE message_id = $1', [first.data.message.id]);
check('a due reminder is sent, then forgotten', sent >= 1 && gone.rows.length === 0, { sent });

console.log('\n=== A PAGE AT A TIME, AND SHARED ITEMS ===');
const page = await req('/messages?limit=3', { token: A.token });
check('the newest page, oldest first, with more to come', page.data.messages.length === 3 && page.data.hasMore === true
  && new Date(page.data.messages[0].sent_at) <= new Date(page.data.messages[2].sent_at), page.data.messages.map((m) => m.sent_at));
const older = await req(`/messages?limit=3&before=${encodeURIComponent(page.data.messages[0].sent_at)}`, { token: A.token });
check('and the page before it', older.data.messages.length === 3 && new Date(older.data.messages[2].sent_at) <= new Date(page.data.messages[0].sent_at), older.data.messages.map((m) => m.sent_at));
const shared = await req('/messages?types=poll,location,photo', { token: A.token });
check('shared items: polls, places and photos, and nothing deleted', shared.data.messages.length >= 3
  && shared.data.messages.every((m) => ['poll', 'location', 'photo'].includes(m.type) && !m.deleted_at), shared.data.messages.map((m) => m.type));
const outsider = await req('/messages', { token: C.token });
check("the other pair sees none of it", !outsider.data.messages.some((m) => m.pair_id === first.data.message.pair_id), outsider.data.messages.length);

sockA.disconnect(); sockB.disconnect();
console.log(`\nCHAT RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
process.exit(0);
