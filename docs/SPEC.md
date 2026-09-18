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

## 5. Period tracking is personal data, scoped by `user_id` not `pair_id`

`period_settings`, `period_cycles`, and `period_daily_logs` are all scoped by
`user_id`. Unlike every other content table in this app, period data is
**not** pair-shared by default — it belongs to the person logging it.

Partner visibility is opt-in and layered on top: `period_settings.sharing_enabled`
defaults to `false`, exactly like `location_sharing_enabled` (see decision
#4), and either partner can turn it off instantly. But sharing here is
**narrower than location sharing**: even with sharing on, `GET
/period/partner` only ever returns the *computed* cycle phase and predicted
dates (e.g. "luteal phase, next period in 4 days") — it never exposes raw
daily logs, flow intensity, symptoms, mood, or notes, regardless of the
sharing flag. There is no setting that unlocks that detail to a partner;
that data is not this app's to share.

## Known, deliberate gaps

- **Widgets are written but never compiled.** The Android `AppWidgetProvider`s,
  the iOS WidgetKit extension (home + lock screen), the native bridge, and both
  Expo config plugins all exist, and the data layer behind them is tested. None
  of the native code has been built, because that needs Xcode and the Android
  SDK. Treat it as a first draft that needs a real device pass — see
  `docs/WIDGETS.md`, which lists the specific parts most likely to need a nudge.
- **Android has no lock screen widget.** Google removed them in Android 5.0 and
  they are tablet-only as of Android 15/16, so there is no API to target on a
  phone. Android gets a silent ongoing notification instead; iOS gets real
  WidgetKit accessory widgets. This is a platform limit, not a shortcut.
- **Web marketing landing page.** Out of scope — mobile-only per explicit
  product direction. The reference design's web-only effects (WebGL shaders,
  DOM SVG filters, `ResizeObserver`-driven liquid layouts) don't have direct
  React Native equivalents anyway.
