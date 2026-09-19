# loversrock.

A private, self-hosted couples app for exactly two people. Runs on your own
PC, reached from your phone over a private [Tailscale](https://tailscale.com)
network — no public cloud hosting, no ads, no third party ever sees your
data. MIT licensed.

Originally scaffolded as a free, self-hosted alternative to the Candle app.

## Why self-hosted + Tailscale instead of a public server

This app is built for exactly one couple, forever. There's no multi-tenant
account system, no public sign-up flow, and no reason to expose a server to
the internet. Tailscale gives the two paired devices a private mesh network
with a stable address — it works off any network (not just shared Wi-Fi, the
way an `ngrok`/LAN-only setup would), and nothing is reachable by anyone who
isn't on the tailnet.

## Tech stack

- **Backend:** Node.js (ESM) + Express + PostgreSQL + Socket.io + node-cron
- **Storage:** MinIO (self-hosted, S3-compatible) — swap for AWS S3 via env vars, no code changes
- **Push:** Firebase Cloud Messaging (the one cloud dependency; required even for local-only use)
- **Mobile:** React Native via Expo
- **Auth:** Bearer JWT access + refresh tokens in `expo-secure-store` (not cookies — see `docs/SPEC.md`)
- **Animation:** a small custom `Animated`-API wrapper (`mobile/components/Motion.js`) — no Moti/reanimated, see below

## Setup

1. Install Docker Desktop, Node.js LTS, Git, [Tailscale](https://tailscale.com/download) (on both your PC and phone), and [Expo Go](https://expo.dev/client) (on your phone).
2. **Backend config:**
   ```bash
   cd backend
   cp .env.example .env
   ```
   Fill in `FIREBASE_SERVICE_ACCOUNT_JSON` with the full service-account JSON from a free Firebase project (as a single-line string). This is required even for a fully local setup, since FCM is the only piece that has to be cloud-hosted.
3. **Start the stack** (Postgres + MinIO + the backend API):
   ```bash
   cd docker
   docker compose up -d
   ```
4. **Create the schema and load the seed data.** Compose does *not* do this for
   you — `docker/init.sql` only installs the Postgres extensions, so a freshly
   started stack has an empty database and every endpoint answers
   `500 relation "users" does not exist` until you run:
   ```bash
   docker compose exec backend npm run migrate
   docker compose exec backend npm run seed
   ```
   **Re-run `migrate` after pulling changes.** `src/config/schema.sql` is the
   whole schema and every statement is `IF NOT EXISTS`, so it is safe to run
   any number of times — but new tables (period tracking, widget tokens) only
   appear once you do. Backend *code* needs no rebuild: `docker-compose.yml`
   bind-mounts `../backend` into the container, so a `docker compose restart
   backend` picks up edits. Rebuild (`docker compose build backend`) only when
   `package.json` dependencies change.

   Prefer running the backend on the host instead of in Docker? `npm install &&
   npm run migrate && npm run seed` from `backend/` works too — Postgres and
   MinIO publish their ports — but stop the container first
   (`docker compose stop backend`) or port 4000 will already be taken.
5. **Tailscale:** sign into the same Tailscale account on your PC and your phone, then get your PC's tailnet IP:
   ```bash
   tailscale ip -4
   ```
6. **Mobile config:**
   ```bash
   cd mobile
   cp .env.example .env
   # set EXPO_PUBLIC_API_URL=http://<tailscale-ip>:4000
   npm install
   npx expo start
   ```
7. Scan the QR code with Expo Go on your phone (with Tailscale connected on both ends). This works from anywhere Tailscale reaches — not just the same Wi-Fi — since it's a private mesh VPN, not a LAN trick.
8. If direct Tailscale binding has interface issues, fall back to:
   ```bash
   npx expo start --tunnel
   ```

### Building a real installable app

Expo Go is fine for day-to-day JS work, but **the home/lock screen widgets are
native and cannot run in it**. To get an actual APK you can sideload:

```bash
cd mobile
# edit eas.json: replace 100.x.x.x with your Tailscale IP
npm install -g eas-cli && eas login
eas build --profile preview --platform android
```

EAS compiles in the cloud and gives you a download link — no Android SDK or
Xcode needed locally. See [`docs/WIDGETS.md`](docs/WIDGETS.md) for the full
matrix, including the local `expo prebuild` path and the iOS requirements.


**Don't put a period in `expo.name`.** The wordmark is "loversrock." but the
config name must be `loversrock`: Expo copies `expo.name` straight into
`rootProject.name` in `android/settings.gradle`, and Gradle refuses a project
name that starts or ends with a `.` — the build dies before compiling
anything. The period you see in the app is drawn by `font.wordmark` in
`mobile/theme.js`, which is unaffected.

**`expo.icon` must point at a file that exists.** There is no `mobile/assets/`
in this repo, so `icon`, `splash.image` and `android.adaptiveIcon` are
deliberately absent — adding a key that points at a missing PNG fails the
build. Drop your artwork at `mobile/assets/icon.png` *first*, then add the
keys.

#### Turning on push notifications

Local reminders (cycle predictions, daily log, water) work with no setup —
they are scheduled on the device and fire even when the server is unreachable.

**Push** needs one file. The backend already talks to FCM through
`FIREBASE_SERVICE_ACCOUNT_JSON`; the app needs the matching client config from
the *same* Firebase project:

1. Firebase console → Project settings → Your apps → Add an **Android** app
   with package name `com.loversrock.app`
2. Download `google-services.json`
3. Put it at `mobile/google-services.json` and rebuild

`app.config.js` declares it only when the file exists, so a build without it
succeeds — push just stays off, and `registerForPush()` returns
`token-unavailable` rather than failing. Permission is requested after pairing
rather than at first launch, so the first prompt arrives when there is
something to notify about.

Android channels (Reminders, Partner, Games, Calls) are created on first run.
Calls use MAX importance so a ring can interrupt; reminders sit lower.

#### If the app says it can't reach the server

**Fix it on the phone — you do not need a new build.** `EXPO_PUBLIC_API_URL`
from `eas.json` is only the starting value; the address the app actually uses
is whatever was last saved on the device.

On the login screen tap **“Can't connect? Check the server address”**, or go to
**Settings → Server** once you're in. Type your server's Tailscale IP
(`tailscale ip -4` on the server) and hit **Save & test** — it saves the address,
pings `/health`, and tells you what happened. `100.101.102.103` is enough;
`http://` and `:4000` are filled in for you. The saved address survives
restarts, and **Reset** puts back the one baked into the build.

Whatever the app reports, it names the address it tried. What each message means:

| Message | Cause |
|---|---|
| "still the placeholder" | The build shipped with `100.x.x.x`. Set the real address in Settings → Server, or replace it in **all three** `eas.json` profiles before the next build. |
| "points at the phone itself" | The address is `localhost`/`127.0.0.1`. On a phone that means the phone. Use the server's Tailscale IP. |
| "Can't reach the server at …" | The address is plausible but nothing answered: Tailscale down on either end, or the backend isn't running. From the server: `curl http://<tailscale-ip>:4000/health`. |
| Connects, then 500s | Backend is up but the database isn't ready — usually migrations were never run. See setup step 4, and `docker compose logs backend`. |

If you see a bare **"Network request failed"** with no explanation, the build
predates this handling — rebuild from the current branch.

The address logic has its own checks, runnable without a build:

```bash
cd mobile && npm run test:server-url
```

The backend serves plain HTTP because a Tailscale IP has no hostname to put on
a certificate. Both platforms block that in release builds by default, so
`plugins/withCleartextTraffic.js` opts back in (Android
`usesCleartextTraffic`, iOS ATS). The traffic still rides inside Tailscale's
WireGuard tunnel. If you later terminate TLS in front of the backend, remove
that plugin from `app.json`.

### Pushing this repo to your own GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/s-rakim/loversrock.git
git push -u origin main
```

(On Windows, if `git` isn't installed: `winget install --id Git.Git -e --source winget`.)

## Pinned architectural decisions

See [`docs/SPEC.md`](docs/SPEC.md) for the full rationale on each of these —
they're load-bearing and shouldn't be casually reversed:

1. Bearer JWT tokens for mobile auth, never httpOnly cookies.
2. Daily prompt/quiz "today" is computed from the **pair's** pinned timezone, not either device's.
3. Pair data is scoped by `pair_id` forever; unlinking never deletes or reassigns history, and re-pairing always creates a brand-new `pair_id`.
4. Location sharing is opt-in, off by default, and instantly revocable by either partner.
5. Period tracking is personal data scoped by `user_id`, never `pair_id`. Partner sharing is opt-in, off by default, and now **per category** — phase, symptoms, mood, flow, sex drive and notes are six independent switches under one master switch, each revocable instantly. Partner mode is read-only, and raw daily-log rows are never returned wholesale.
6. Nicknames belong to a pairing, not to a person — keyed by `(pair_id, set_by_id)`, so a name given by an ex can never resurface in a new pairing.

## Feature status

| Area | Status |
|---|---|
| Auth (signup/login/refresh/pairing/unlink) | ✅ Fully implemented |
| Daily Prompt (reveal-after-both, streaks) | ✅ Fully implemented |
| Daily Quiz (trivia/guess-partner/this-or-that, archive) | ✅ Fully implemented |
| Memories (upload, soft-delete, 30-day restore) | ✅ Fully implemented |
| Bucket List (live sync via Socket.io) | ✅ Fully implemented |
| Date Ideas (curated + saved) | ✅ Fully implemented |
| Countdowns (auto-archive) | ✅ Fully implemented |
| Messages (text/photo/doodle unified feed) | ✅ Fully implemented |
| Doodles — 16 colours, 5 widths, 6 papers, 8 brushes (pen/marker/neon/dashed/dotted/rainbow/ribbon/eraser), undo & redo | ✅ Fully implemented, old doodles still render |
| Widget Photos (mirrors into Memories, FCM data message) | ✅ Fully implemented |
| Community Question Decks (27 decks / 10 categories) | ✅ Fully implemented |
| Thumb Kiss (live two-device touch sync) | ✅ Fully implemented |
| Distance Apart (real `expo-location`, opt-in) | ✅ Fully implemented |
| Cycle Tracker (Today / Calendar / Partner / Analysis, 59 symptoms in 6 groups, 36 moods, flow, intercourse, sex drive, weight, temperature, predictions, fertile window) | ✅ Fully implemented |
| Partner cycle mode (read-only, per-category sharing, pregnancy-chance curve) | ✅ Fully implemented |
| Nicknames (each partner names the other, independently) | ✅ Fully implemented |
| Daily prompts refreshed nightly from a random topic (Claude / any URL / local bank) | ✅ Fully implemented |
| Games — all 12 played against your partner, none solo: Tic Tac Toe, Four in a Row, Checkers, Chess, Uno Reverse, Block Blitz, Anagrams, What You Saying, Perfect Pair, Love Letters, Love Golf, Draw Duel | ✅ Server-authoritative (Love Golf's score is client-reported — `docs/GAMES.md` says why). Chess verified by perft. |
| Voice and video calls (WebRTC, peer to peer) | ⚠️ Signalling tested end to end; the media itself needs a two-device pass. See `docs/CALLS.md`. |
| Home screen widgets (Android `AppWidgetProvider` + iOS WidgetKit) | ⚠️ Written, not compiled — needs a dev-client build. See `docs/WIDGETS.md`. |
| Lock screen widget (iOS 16+ accessory families) | ⚠️ Written, not compiled — Android has no lock screen widget API, so it gets an ongoing notification instead. |
| **Web marketing landing page** | ❌ Out of scope — mobile-only by design; the reference design's effects (WebGL, DOM SVG filters) don't map to React Native anyway. |

## A note on the animation library

Moti + `react-native-reanimated` were tried first and then **removed** after
causing a crash (`Cannot read property 'useContext' of null` / "Invalid hook
call"), traced to Moti pulling in a second, conflicting React context tree.
`mobile/components/Motion.js` reimplements the parts of Moti's
`from`/`animate`/`transition` API this app actually uses, on top of nothing
but React Native's built-in `Animated.Value` + `Animated.timing`/`spring` —
zero extra dependencies, and structurally unable to hit that crash class
again.

The same constraint decided the lava lamp background. The spec asked for
`@shopify/react-native-skia` blobs merged with a colour-matrix threshold and
driven by Reanimated — but Skia 1.x declares `react-native-reanimated` as a
peer dependency, so adopting it would reintroduce exactly the library that was
removed. `react-native-svg` is already here, but Expo SDK 51 pins 15.2.0, which
predates its filter primitives (no `FeGaussianBlur`, no `FeColorMatrix`).

`components/LavaLamp.js` gets the same effect from what is already installed:
radial gradients with a transparent outer stop give each blob its soft edge,
overlapping alpha gives the merge, and every blob is an `Animated.View`
transform so the motion runs on the native driver. No new native dependency,
so it needs no rebuild beyond the one already required.


## License

MIT — see [`LICENSE`](LICENSE).
