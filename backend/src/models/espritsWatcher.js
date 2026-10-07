// Tells the phones when something is said in the AI room.
//
// Esprits has no push of its own to the app, and its live feed is an
// EventSource the phones cannot use, so the backend watches the room's
// high-water mark (the way Esprits' own page does) and passes it on: a
// socket nudge to every open app, and a notification to whoever was not
// the one talking. The body of a model's reply goes in the notification;
// the room is not end-to-end encrypted, unlike the chat.
import { getUserDeviceTokens } from './pairs.js';
import { esprits, espritsUrl, members } from './esprits.js';
import { sendNotification, deepLink, CHANNELS } from '../config/firebase.js';

const EVERY_MS = 3000;
const PREVIEW = 140;

const preview = (text) => {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW ? `${flat.slice(0, PREVIEW - 1)}…` : flat;
};

/**
 * What to send whom, for a batch of new messages: pure, so it can be tested.
 * A person's message goes to the other people in the room; a model's reply
 * goes to everyone. The room's own notices (joins, system lines) go nowhere.
 */
export function notificationsFor(messages, people) {
  const out = [];
  for (const m of messages) {
    if (m.authorKind === 'system' || m.kind === 'system') continue;
    if (m.authorKind === 'human') {
      const from = people.find((p) => p.handle === m.author);
      for (const p of people) {
        if (p.handle === m.author) continue;
        out.push({ userId: p.user_id, title: `${from?.name || m.author} in the AI room`, body: preview(m.body) });
      }
    } else {
      for (const p of people) out.push({ userId: p.user_id, title: `${m.author} replied`, body: preview(m.body) });
    }
  }
  return out;
}

/** Starts watching. Returns a stop function. Does nothing without ESPRITS_URL. */
export function startEspritsWatcher(io, { everyMs = EVERY_MS } = {}) {
  if (!espritsUrl()) return () => {};
  let last = null;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      if (last === null) {
        // Start from now: what was said before this server started is not news.
        last = Number((await esprits('/health')).head || 0);
        return;
      }
      const feed = await esprits(`/api/feed?since=${last}`);
      const fresh = feed.messages || [];
      if (!fresh.length) return;
      last = Number(feed.head || fresh[fresh.length - 1].id);
      io?.emit('esprits:new', { head: last });
      const sends = notificationsFor(fresh, await members());
      for (const n of sends) {
        // eslint-disable-next-line no-await-in-loop
        const tokens = await getUserDeviceTokens(n.userId);
        sendNotification(
          tokens,
          { title: n.title, body: n.body },
          deepLink('esprits', {}),
          // One line per person in the tray, updated rather than stacked.
          { channel: CHANNELS.partner, priority: 'high', collapseKey: `esprits:${n.userId}` }
        ).catch((err) => console.error('[esprits] push failed:', err.message));
      }
    } catch {
      // The room is down or restarting: try again next tick, from where we were.
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, everyMs);
  tick();
  return () => clearInterval(timer);
}
