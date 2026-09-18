-- Extensions only. The actual schema is applied via `npm run migrate`
-- (backend/src/config/migrate.js) so schema changes don't require nuking
-- this volume during development.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
