# Backend test suite

These exercise the real stack — a live Postgres, a live S3-compatible store,
and a running API with two genuinely paired users driving real HTTP requests
and Socket.io traffic. Nothing is mocked. They were written after a full
simulation pass found three real bugs (see below), so they exist mainly to
stop those coming back.

## Running

Four terminals' worth of setup, in order:

```bash
# 1. Postgres (or use docker/docker-compose.yml)
createdb loversrock && npm run migrate && npm run seed

# 2. Object storage. In production this is MinIO; locally this stub speaks
#    the same S3 API so the upload path runs unmodified.
node test/local-s3.js

# 3. The API itself
npm start

# 4. The tests
npm run test:integration   # ~160 assertions across every feature
npm run test:contract      # response shapes the mobile screens destructure
npm run test:cron          # scheduled jobs, executed for real
```

`test:integration` needs `psql` on PATH — it rewinds `last_active_date` to
simulate consecutive days, which is the only way to catch streak regressions
inside a single run.

## What the bugs were

1. **Any async throw killed the whole server.** Express 4 doesn't forward
   rejected promises from async handlers to error middleware, and every
   handler here is async. A malformed image upload took the process down for
   both partners. Fixed in `src/lib/asyncRouter.js`.
2. **The streak counter was permanently stuck at 1.** `pairs.last_active_date`
   came back from node-postgres as a `Date`, and was compared with `===`
   against `'YYYY-MM-DD'` strings — never equal, so the streak reset every
   day. Only a multi-day test catches this.
3. **Period rolling averages wrote `NaN`.** Same Date-vs-string root cause,
   via `daysBetween()`. Fixed globally by parsing `DATE` columns as strings
   (`src/config/db.js`).
