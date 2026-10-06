// The chat's rules, kept apart from the screen so they can be tested on
// their own: what a message says in one line, which can be edited, what a
// poll's tally is, what a search finds, when "Tonight" is.
//
// "text" everywhere below is a message's readable body: its content, or its
// decrypted content when the pair has encryption on (the screen decrypts;
// these never see ciphertext).

/** How long after sending a text can still be edited (as the server says). */
export const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The quick reactions at the top of a message's menu. */
export const QUICK_REACTIONS = ['❤️', '😂', '😮', '😢', '👍', '🔥'];

export const isDeleted = (m) => Boolean(m?.deleted_at);
export const isScheduled = (m) => Boolean(m?.scheduled_for);

/** A poll or a place, from its (decrypted) JSON body; null if unreadable. */
export function parseBody(text) {
  if (typeof text !== 'string' || !text.trim().startsWith('{')) return null;
  try { return JSON.parse(text); } catch { return null; }
}

/** One line for a message: the reply quote, the pinned banner, search. */
export function previewOf(message, text) {
  if (!message) return 'Original message';
  if (isDeleted(message)) return 'Message deleted';
  switch (message.type) {
    case 'photo': return 'Photo';
    case 'doodle': return 'Drawing';
    case 'poll': {
      const poll = parseBody(text);
      return poll?.question ? `Poll: ${poll.question}` : 'Poll';
    }
    case 'location': {
      const place = parseBody(text);
      return place?.label ? `Place: ${place.label}` : 'Shared a place';
    }
    default:
      if (text === undefined) return '…';
      if (text === null) return 'Encrypted message';
      return String(text).replace(/\s+/g, ' ').trim();
  }
}

/** Yours, a text, not deleted, and within the edit window (or not sent yet). */
export function canEdit(message, meId, now = Date.now()) {
  if (!message || message.sender_id !== meId || message.type !== 'text' || isDeleted(message)) return false;
  if (isScheduled(message)) return true;
  return now - new Date(message.sent_at).getTime() <= EDIT_WINDOW_MS;
}

export const canDelete = (message, meId) => Boolean(message) && message.sender_id === meId && !isDeleted(message);

/**
 * The poll's state for drawing it: per option, how many voted for it and
 * whether you did; how many people voted at all; whether you have.
 */
export function pollTally(message, meId) {
  const count = message?.meta?.optionCount || 0;
  const votes = message?.votes || [];
  const options = Array.from({ length: count }, (_, i) => ({
    votes: votes.filter((v) => v.choice === i).length,
    mine: votes.some((v) => v.choice === i && v.userId === meId),
  }));
  const voters = new Set(votes.map((v) => v.userId)).size;
  return { options, voters, voted: votes.some((v) => v.userId === meId), closed: Boolean(message?.meta?.closed), multi: Boolean(message?.meta?.multi) };
}

/** Your most recent message the other one has seen: where "Seen" goes. */
export function lastSeenOwn(messages, meId) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.sender_id === meId && !isScheduled(m) && m.seen_at) return m.id;
  }
  return null;
}

/** Ids of the messages whose readable text contains `q`, oldest first. */
export function searchMatches(messages, textOf, q) {
  const needle = String(q || '').trim().toLocaleLowerCase();
  if (!needle) return [];
  return messages
    .filter((m) => !isDeleted(m))
    .filter((m) => previewOf(m, textOf(m)).toLocaleLowerCase().includes(needle))
    .map((m) => m.id);
}

const LINK = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi;
/** The links in a text, for the shared items' Links tab. */
export function linksIn(text) {
  return typeof text === 'string' ? [...new Set(text.match(LINK) || [])] : [];
}

/** Splits a text around its links, so they can be tapped. */
export function splitLinks(text) {
  const out = [];
  if (typeof text !== 'string') return out;
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[0], url: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

const at = (base, days, hour, minute = 0) => {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d;
};

/**
 * When a message can be sent later, or a reminder can come: the choices
 * Nextcloud Talk offers, in the phone's own time. "This evening" only while
 * it is still to come.
 */
export function laterChoices(now = new Date()) {
  const base = new Date(now);
  const choices = [{ key: 'hour', label: 'In 1 hour', at: new Date(base.getTime() + 3600_000) }];
  if (base.getHours() < 18) choices.push({ key: 'evening', label: 'This evening (8pm)', at: at(base, 0, 20) });
  choices.push({ key: 'tomorrow', label: 'Tomorrow morning (9am)', at: at(base, 1, 9) });
  // The coming Saturday morning, if that is not tomorrow.
  const toSaturday = ((6 - base.getDay()) + 7) % 7 || 7;
  if (toSaturday > 1) choices.push({ key: 'weekend', label: 'This weekend (Sat 9am)', at: at(base, toSaturday, 9) });
  choices.push({ key: 'week', label: 'Next week (Mon 9am)', at: at(base, ((1 - base.getDay()) + 7) % 7 || 7, 9) });
  return choices;
}

/** "Today 20:00", "Tomorrow 09:00", "Sat 12 Oct 09:00". */
export function whenLabel(date, now = new Date()) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const today = new Date(now);
  const tomorrow = new Date(now); tomorrow.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return `Today ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}

/** Maps, on whatever the phone has: geo: on Android, Apple Maps on iOS. */
export function mapsUrl(place, os = 'android') {
  const lat = Number(place?.lat); const lng = Number(place?.lng);
  const label = encodeURIComponent(place?.label || 'Here');
  return os === 'ios'
    ? `http://maps.apple.com/?ll=${lat},${lng}&q=${label}`
    : `geo:${lat},${lng}?q=${lat},${lng}(${label})`;
}
