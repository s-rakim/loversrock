# The chat

What Nextcloud Talk's chat does, rewritten for two people (Talk is GPL-3.0
and none of its code is here; this repository is MIT).

| You do | How |
|---|---|
| React | Hold a message, tap an emoji (one reaction each; tap yours again to take it off) |
| Reply | Hold → Reply. The reply quotes it; tap the quote to jump to it |
| Copy | Hold → Copy |
| Edit | Hold → Edit, your own texts, for 24 hours. Shows "edited" |
| Delete | Hold → Delete, your own. Stays in the thread as "Message deleted" for both of you |
| Pin | Hold → Pin to the top (or for a day). The banner at the top jumps to it |
| Remind me | Hold → Remind me: in an hour, this evening, tomorrow, the weekend, next week. A push, to you only, that opens the message |
| Send later | Hold Send. Change the time or send it now from its menu; only you see it until then |
| Send silently | Hold Send → without a notification |
| Poll | + → Poll. One answer or several; results show once you have voted; whoever asked can end it |
| Share where you are | + → Where I am. Named by the phone's own geocoder; opens in Maps |
| Search | The magnifier. Runs on the phone, because only the phone can read the messages |
| Shared items | The pictures button: photos, drawings, places, polls and links, by kind |
| Typing… / Seen | Shown under their name, and under your last message they have read |

## Encryption

With encryption on, texts, polls and places are all sealed on the phone
before they are sent (`encrypted: true`). The server stores ciphertext and
the few facts it needs to do its job without reading anything: a poll's
number of options and whether it has ended (`messages.meta`), who voted for
which option number (`poll_votes`), when a scheduled message goes out. That
is also why search, links and the shared-items Links tab work on the phone.

## Server

`backend/src/routes/messages.js`; tests in `backend/test/chat.mjs` (44,
against a live stack). Scheduled messages and reminders go out from a
once-a-minute cron (`releaseScheduledMessages`, `sendMessageReminders`).
`GET /messages?limit=60` gives the newest page; `&before=<sent_at>` the page
before; `types=photo,doodle` narrows it; no `limit` gives everything.
