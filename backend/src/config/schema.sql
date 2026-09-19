-- LoversRock schema. Applied via `npm run migrate` (idempotent, safe to
-- re-run — every statement is CREATE ... IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS users (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                       TEXT NOT NULL,
  email                      TEXT NOT NULL UNIQUE,
  password_hash              TEXT NOT NULL,
  avatar_url                 TEXT,
  partner_id                 UUID REFERENCES users(id) ON DELETE SET NULL,
  last_lat                   DOUBLE PRECISION,
  last_lng                   DOUBLE PRECISION,
  location_shared_at         TIMESTAMPTZ,
  location_sharing_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_devices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fcm_token     TEXT NOT NULL,
  platform      TEXT NOT NULL DEFAULT 'android',
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, fcm_token)
);

-- user_b_id is NULL between invite generation and invite acceptance —
-- the row is created at invite time (user_a_id = inviter) so invite_code /
-- invite_expires_at have somewhere to live, and filled in on accept.
CREATE TABLE IF NOT EXISTS pairs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b_id          UUID REFERENCES users(id) ON DELETE CASCADE,
  timezone           TEXT NOT NULL,
  invite_code        TEXT,
  invite_expires_at  TIMESTAMPTZ,
  streak_count       INTEGER NOT NULL DEFAULT 0,
  last_active_date   DATE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  unlinked_at        TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pairs_invite_code_pending
  ON pairs(invite_code) WHERE invite_code IS NOT NULL AND user_b_id IS NULL;

CREATE TABLE IF NOT EXISTS daily_prompts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduled_date  DATE NOT NULL UNIQUE,
  category        TEXT NOT NULL,
  content         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_responses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id       UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  prompt_id     UUID NOT NULL REFERENCES daily_prompts(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answer_text   TEXT NOT NULL,
  notified_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pair_id, prompt_id, user_id)
);

CREATE TABLE IF NOT EXISTS quiz_questions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduled_date   DATE NOT NULL,
  question_order   INTEGER NOT NULL CHECK (question_order BETWEEN 1 AND 5),
  type             TEXT NOT NULL CHECK (type IN ('guess_partner', 'trivia', 'this_or_that')),
  question_text    TEXT NOT NULL,
  choices          JSONB,
  correct_answer   TEXT,
  content_version  INTEGER NOT NULL DEFAULT 1,
  UNIQUE(scheduled_date, question_order)
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id             UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  quiz_question_id    UUID NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answer              TEXT NOT NULL,
  correctness_state   TEXT NOT NULL DEFAULT 'pending' CHECK (correctness_state IN ('pending', 'waiting_for_partner', 'computed')),
  is_correct          BOOLEAN,
  answered_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pair_id, quiz_question_id, user_id)
);

CREATE TABLE IF NOT EXISTS memories (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id      UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  image_url    TEXT NOT NULL,
  caption      TEXT,
  taken_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source       TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'widget')),
  deleted_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bucket_list_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id       UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  is_completed  BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at  TIMESTAMPTZ,
  created_by    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS date_ideas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id       UUID REFERENCES pairs(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT,
  category      TEXT,
  cost_tier     TEXT CHECK (cost_tier IN ('free', '$', '$$', '$$$')),
  is_completed  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS countdowns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id         UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  target_date     TIMESTAMPTZ NOT NULL,
  label           TEXT NOT NULL,
  created_by      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  auto_archived   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id                UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  sender_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type                   TEXT NOT NULL CHECK (type IN ('text', 'photo', 'doodle')),
  content                TEXT,
  image_url              TEXT,
  stroke_data            JSONB,
  reply_to_message_id    UUID REFERENCES messages(id) ON DELETE SET NULL,
  sent_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  seen_at                TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS widget_photos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id       UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  sender_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  image_url     TEXT NOT NULL,
  caption       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  seen_at       TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS question_decks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category      TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  emoji         TEXT,
  title         TEXT NOT NULL,
  is_locked     BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS deck_questions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deck_id        UUID NOT NULL REFERENCES question_decks(id) ON DELETE CASCADE,
  question_text  TEXT NOT NULL,
  sort_order     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS deck_question_responses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id           UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  deck_question_id  UUID NOT NULL REFERENCES deck_questions(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answer_text       TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pair_id, deck_question_id, user_id)
);

CREATE TABLE IF NOT EXISTS games_catalog (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             TEXT NOT NULL UNIQUE,
  emoji            TEXT,
  title            TEXT NOT NULL,
  subtitle         TEXT,
  is_locked        BOOLEAN NOT NULL DEFAULT FALSE,
  is_implemented   BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order       INTEGER NOT NULL DEFAULT 0
);

-- Period tracking. Scoped by user_id, never pair_id — this is personal
-- health data, not shared couple content (see docs/SPEC.md #5). Partner
-- visibility is layered on top via period_settings.sharing_enabled and
-- only ever exposes computed phase/dates, never raw logs.
CREATE TABLE IF NOT EXISTS period_settings (
  user_id                 UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  average_cycle_length    INTEGER NOT NULL DEFAULT 28,
  average_period_length   INTEGER NOT NULL DEFAULT 5,
  luteal_phase_length     INTEGER NOT NULL DEFAULT 14,
  sharing_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per period. end_date is NULL while the period is ongoing.
CREATE TABLE IF NOT EXISTS period_cycles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date    DATE NOT NULL,
  end_date      DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS period_daily_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date      DATE NOT NULL,
  flow          TEXT CHECK (flow IN ('spotting', 'light', 'medium', 'heavy')),
  symptoms      JSONB,
  mood          TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, log_date)
);

-- Home/lock screen widgets run in a separate OS process on a 15-30 minute
-- refresh cadence. They cannot hold a 15-minute access token or perform the
-- refresh-token dance, so they get their own long-lived credential instead:
-- read-only, good for GET /widget/summary and nothing else, revocable on its
-- own without touching the user's session. Only the SHA-256 hash is stored.
CREATE TABLE IF NOT EXISTS widget_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  label         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_partner_id ON users(partner_id);
CREATE INDEX IF NOT EXISTS idx_prompt_responses_pair_prompt ON prompt_responses(pair_id, prompt_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_pair_question ON quiz_attempts(pair_id, quiz_question_id);
CREATE INDEX IF NOT EXISTS idx_memories_pair_taken_at ON memories(pair_id, taken_at);
CREATE INDEX IF NOT EXISTS idx_messages_pair_sent_at ON messages(pair_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_widget_photos_pair_created_at ON widget_photos(pair_id, created_at);
CREATE INDEX IF NOT EXISTS idx_period_cycles_user_start ON period_cycles(user_id, start_date);
CREATE INDEX IF NOT EXISTS idx_period_daily_logs_user_date ON period_daily_logs(user_id, log_date);
CREATE INDEX IF NOT EXISTS idx_widget_tokens_active ON widget_tokens(token_hash) WHERE revoked_at IS NULL;
