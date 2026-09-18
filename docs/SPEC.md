# LoversRock — Pinned Decisions

This document is the source of truth for architectural decisions that must
not be silently reversed. If a change conflicts with something here, the
change needs a new decision recorded here first.

## 1. Auth transport: Bearer tokens, not cookies

Mobile auth uses a short-lived JWT access token plus a longer-lived refresh
token, both returned in the JSON response body and stored client-side in
`expo-secure-store`. We do **not** use httpOnly cookies — React Native's
`fetch` does not participate in a cookie jar the way a browser does, so a
cookie-based flow would silently fail to persist sessions between app
launches. Every authenticated request sends `Authorization: Bearer <token>`.

`POST /auth/refresh` rotates *both* tokens on use (refresh token rotation),
so a leaked, already-used refresh token is inert.

## 2. Scheduling uses the pair's timezone, not the device's

"Today" for the daily prompt and daily quiz is computed from `pairs.timezone`
— a single IANA timezone string pinned once, at pairing time, to the
*inviter's* device timezone. It is never recomputed from either partner's
current device timezone.

Why: a long-distance couple with different device timezones must see the
same prompt "reveal" at the same wall-clock pair-local moment, or the
"reveal after both answer" mechanic and the streak calculation desync — one
partner could answer "today's" prompt while the other is still on
"yesterday's".

## 3. Pair data is scoped by `pair_id` forever; unlinking never deletes it

Every content table (`memories`, `messages`, `bucket_list_items`, etc.) is
scoped by `pair_id`, not by a pair of `user_id`s. `POST /auth/unlink` clears
`users.partner_id` on both accounts but never deletes, reassigns, or
anonymizes historical rows tied to the old `pair_id`.

Re-pairing — with anyone, including a former partner — always creates a
**brand-new** `pairs` row and therefore a brand-new `pair_id`. Old history
stays attached to the old, now-orphaned `pair_id` and is not reachable
through the new pairing. This is a hard privacy boundary: it must not become
possible to re-link with an ex and regain access to the old shared history
through a "reconnect" shortcut.

## 4. Location sharing is opt-in, off by default, instantly revocable

`users.location_sharing_enabled` defaults to `false`. Either partner can flip
it off at any time and the effect is immediate: the stored `last_lat`/
`last_lng` is cleared on disable, and `GET /location/distance` only returns a
value when **both** users in the pair currently have sharing enabled. This is
the most sensitive data type in the app and gets the most conservative
default of anything in the schema.

## Known, deliberate gaps

- **Native Android home-screen widgets.** Every widget's underlying feature
  (Canvas doodle, Countdown, daily photo, Distance Apart) exists as a working
  in-app screen. The literal launcher-pinnable Kotlin `AppWidgetProvider` +
  Expo config plugin + `expo prebuild` step is not implemented — it can't be
  compiled or verified without a real Android build environment, and shipping
  unverified native code isn't worth the risk. See `docs/ANDROID_WIDGET.md`.
- **Web marketing landing page.** Out of scope — mobile-only per explicit
  product direction. The reference design's web-only effects (WebGL shaders,
  DOM SVG filters, `ResizeObserver`-driven liquid layouts) don't have direct
  React Native equivalents anyway.
