// What a nudge is, and what it says when it lands.
//
// There are two senders — the widget (weak token, routes/widget.js) and the
// app (real session, routes/presence.js) — and the receiving phone must not
// be able to tell which one was used. Two copies of these strings would drift
// within a month and quietly leak that, so there is one copy.
export const NUDGE_KINDS = ['kiss', 'hug', 'thinking', 'miss'];

export const NUDGE_LABELS = {
  kiss: { title: 'A kiss 💋', body: 'They are thinking of you.' },
  hug: { title: 'A hug', body: 'They are thinking of you.' },
  thinking: { title: 'Thinking of you', body: 'Tap to say something back.' },
  miss: { title: 'They miss you', body: 'Tap to say something back.' },
};

export const normalizeKind = (kind) => (NUDGE_KINDS.includes(kind) ? kind : 'kiss');

/** One nudge per person per half minute. A pocket press is not a second kiss. */
export const NUDGE_THROTTLE_SECONDS = 30;
