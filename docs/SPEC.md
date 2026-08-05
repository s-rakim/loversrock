# CandleApp — Feature Spec

(See project README for setup. This file is the source-of-truth design doc —
keep it updated as decisions change.)

## Pinned decisions (do not violate these without updating this file)
1. **Bearer tokens, not httpOnly cookies.** JWT access token (15-60min) + refresh
   token, both in `expo-secure-store`. RN fetch does not persist httpOnly cookies.
2. **All scheduling uses `Pair.timezone`**, fixed at pair creation (inviter's device
   timezone). Never use individual user device timezone for "today's prompt" logic.
3. **All pair data is scoped by `pair_id` forever.** Unlinking clears `partner_id`
   on both users but never deletes or reassigns historical rows. Re-pairing always
   creates a brand-new `pair_id`. No exceptions — this is a privacy boundary.

## Data model
See `backend/src/config/schema.sql` for canonical DDL.

## Correctness state machine (Daily Quiz, guess_partner type)
```
pending -> waiting_for_partner -> computed
```
- `trivia` / `this_or_that`: is_correct computed immediately against static `correct_answer`.
- `guess_partner`: is_correct computed only once BOTH partners have submitted for
  that question_order; compare attempt.answer values server-side.

## MVP build order
1. Docker + Bearer-token auth + pairing (pair_id isolation from day one)
2. Daily prompt (1/day) + timezone-pinned streak logic
3. Daily quiz (5/day) + correctness state machine + calendar archive
4. Memories feed + soft-delete/restore + cleanup cron
5. Bucket list (Socket.io + foreground refetch fallback)
6. Push notifications (FCM) + UserDevice multi-device support
7. Unified Message feed (text/photo/doodle)
8. Date ideas
9. Countdown
10. Android live-photo widget (native, last)

Full narrative spec with rationale lives in project chat history / PR descriptions —
this file should stay terse and just track current decisions.
