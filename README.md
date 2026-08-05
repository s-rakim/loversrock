# CandleApp (open-source)

A private daily-connection app for couples — daily prompt, 5-question daily quiz,
shared memories feed, bucket list, date ideas, countdowns, doodle messages, and
(later) an Android live-photo widget.

This is a from-scratch open-source build inspired by the *feature set* of apps like
Candle and Locket. No code, assets, or content from those apps is used here.

## Stack
- **Backend:** Node.js / Express / PostgreSQL / Socket.io / node-cron
- **Storage:** MinIO (S3-compatible, local) — swap for AWS S3 in prod via env vars
- **Push:** Firebase Cloud Messaging (only cloud dependency — required even for local dev)
- **Mobile:** React Native (Expo, dev-client / bare workflow — needed later for the Android widget)

## Local development (fully on your PC except push notifications)

```bash
cp backend/.env.example backend/.env
# fill in DATABASE_URL (already set for docker-compose), MinIO keys (already set),
# and FIREBASE_SERVICE_ACCOUNT_JSON (from a free Firebase project)

docker compose -f docker/docker-compose.yml up -d
cd backend && npm install
npm run seed      # loads daily prompts, quiz questions, date ideas from /seed
npm run dev        # starts API on :4000
```

Mobile app:
```bash
cd mobile && npm install
npx expo start
# scan QR with Expo Go on Android, or run on an emulator
# set EXPO_PUBLIC_API_URL in mobile/.env to your PC's local IP, e.g. http://192.168.1.50:4000
```

If testing on a partner's phone off your home network, tunnel the backend with ngrok
and point `EXPO_PUBLIC_API_URL` at the ngrok URL.

## Repo layout

```
backend/          Express API, Postgres models, cron jobs, Socket.io server
  src/routes/      REST endpoints, one file per feature
  src/models/      DB access layer (plain SQL / query builder, see db.js)
  src/cron/        daily prompt rollover, streak calc, memory cleanup, etc.
  src/sockets/     Socket.io room auth + bucket-list live sync
  seed/            JSON content for daily prompts, quiz questions, date ideas
mobile/           Expo React Native app
docker/           docker-compose.yml + init SQL
```

## Build order

See `/docs/SPEC.md` for the full feature spec and MVP build order:
1. Auth + pairing
2. Daily prompt + streak
3. Daily quiz (5/day) + calendar archive
4. Memories feed
5. Bucket list
6. Push notifications
7. Unified message feed (text/photo/doodle)
8. Date ideas
9. Countdown
10. Android live-photo widget (native, last)

## License
MIT — this is meant to be a genuinely open, community-extendable project.
Content in `seed/` (prompts/quiz questions) is CC0 — add your own via PR.
