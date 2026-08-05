-- This file runs once when the postgres container's data volume is first created.
-- Keep it minimal (extensions only) — actual table schema lives in
-- backend/src/config/schema.sql and is applied via `npm run migrate`,
-- so schema changes don't require blowing away the docker volume.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
