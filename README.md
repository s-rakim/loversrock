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
3. **Start Postgres + MinIO:**
   ```bash
   cd docker
   docker compose up -d
   ```
4. **Install, migrate, seed:**
   ```bash
   cd backend
   npm install
   npm run migrate
   npm run seed
   ```
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

#### If the app says it can't reach the server

The API URL is **baked into the binary at build time** from
`EXPO_PUBLIC_API_URL` in `eas.json`. Changing it means a new build; there is no
in-app server setting. Tap **Test connection** on the login screen — it shows
the URL the app was built with and pings `/health`, which tells you which of
these it is:

| Symptom | Cause |
|---|---|
| "still the placeholder" | `eas.json` was never edited. Replace `100.x.x.x` in **all three** profiles and rebuild. |
| "points at localhost" | On a phone that means the phone. Use the server's Tailscale IP (`tailscale ip -4` on the server). |
| "Can't reach the server" | Tailscale down on either end, or the backend isn't listening. From the server: `curl http://<tailscale-ip>:4000/health`. |
| Connects, then 500s | Backend is up but can't reach Postgres or MinIO — check `docker compose logs backend`. |

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
5. Period tracking is personal data scoped by `user_id`, never `pair_id`. Partner sharing (opt-in, off by default) exposes only the computed cycle phase and predicted dates — never raw flow, symptoms, mood, or notes.

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
| Widget Photos (mirrors into Memories, FCM data message) | ✅ Fully implemented |
| Community Question Decks (27 decks / 10 categories) | ✅ Fully implemented |
| Thumb Kiss (live two-device touch sync) | ✅ Fully implemented |
| Distance Apart (real `expo-location`, opt-in) | ✅ Fully implemented |
| Cycle Tracker (period/symptom/mood logging, predictions, fertile window, opt-in partner phase sharing) | ✅ Fully implemented |
| Games: Four in a Row, Anagrams, Love Golf (tilt physics), Draw Duel (live sockets), What You Saying, Perfect Pair, Love Letters | ✅ All 7 genuinely playable |
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

## License

MIT — see [`LICENSE`](LICENSE).
