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

-- ============================================================================
-- Candle / Lovers X parity additions. Everything below is additive: new
-- tables, plus new nullable/defaulted columns on existing ones. Nothing above
-- this line changes meaning.
-- ============================================================================

-- Profiles (Lovers X "partner profiles") and mood.
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio               TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS birthday          DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS love_language     TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS favorites         JSONB;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mood_emoji        TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mood_text         TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mood_updated_at   TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS language          TEXT NOT NULL DEFAULT 'en';
-- Per-category push opt-outs, e.g. {"mood": false}. Missing key = enabled.
ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_prefs JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS mood_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id     UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji       TEXT NOT NULL,
  text        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Relationship dates, streak protection and date-idea location tailoring.
ALTER TABLE pairs ADD COLUMN IF NOT EXISTS anniversary_date   DATE;
ALTER TABLE pairs ADD COLUMN IF NOT EXISTS together_since     DATE;
ALTER TABLE pairs ADD COLUMN IF NOT EXISTS streak_freezes     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pairs ADD COLUMN IF NOT EXISTS lost_streak        INTEGER;
ALTER TABLE pairs ADD COLUMN IF NOT EXISTS lost_streak_on     DATE;
ALTER TABLE pairs ADD COLUMN IF NOT EXISTS date_setting       TEXT;

-- Sparks: an append-only ledger. A user's balance is SUM(amount).
CREATE TABLE IF NOT EXISTS spark_ledger (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id     UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount      INTEGER NOT NULL,
  reason      TEXT NOT NULL,
  ref         TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One-shot earn events (e.g. "answered prompt on 2026-09-25") are unique by
-- (user, reason, ref) so a retried request can never double-pay.
CREATE UNIQUE INDEX IF NOT EXISTS idx_spark_ledger_once
  ON spark_ledger(user_id, reason, ref) WHERE ref IS NOT NULL AND amount > 0;

-- Anything a pair has bought with Sparks, e.g. 'deck:<slug>', 'dates:premium'.
CREATE TABLE IF NOT EXISTS pair_unlocks (
  pair_id     UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  item_key    TEXT NOT NULL,
  unlocked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (pair_id, item_key)
);

CREATE TABLE IF NOT EXISTS pair_achievements (
  pair_id      UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  key          TEXT NOT NULL,
  unlocked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (pair_id, key)
);

-- Seasonal and Sparks-exclusive decks. NULL season = always available.
ALTER TABLE question_decks ADD COLUMN IF NOT EXISTS season_start TEXT; -- 'MM-DD'
ALTER TABLE question_decks ADD COLUMN IF NOT EXISTS season_end   TEXT; -- 'MM-DD'
ALTER TABLE question_decks ADD COLUMN IF NOT EXISTS spark_cost   INTEGER;

-- Adaptive questions: skips teach the "For you" feed what to show less of.
CREATE TABLE IF NOT EXISTS question_skips (
  pair_id           UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  deck_question_id  UUID NOT NULL REFERENCES deck_questions(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, deck_question_id)
);

-- Chat reactions (one per user per message per emoji).
CREATE TABLE IF NOT EXISTS message_reactions (
  message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);

-- Lovers X joint feed.
CREATE TABLE IF NOT EXISTS feed_posts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id     UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  author_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT,
  image_url   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS feed_reactions (
  post_id     UUID NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('like', 'love')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id, kind)
);
CREATE TABLE IF NOT EXISTS feed_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     UUID NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
  author_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Shared notes / love notes.
CREATE TABLE IF NOT EXISTS notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id     UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  author_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT,
  body        TEXT NOT NULL,
  color       TEXT,
  is_pinned   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Secret messages: the widget only ever learns that one exists, never its body.
CREATE TABLE IF NOT EXISTS secret_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id     UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  sender_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  opened_at   TIMESTAMPTZ
);

-- Shared live canvas (one per pair) + the saved gallery.
CREATE TABLE IF NOT EXISTS pair_canvas (
  pair_id     UUID PRIMARY KEY REFERENCES pairs(id) ON DELETE CASCADE,
  strokes     JSONB NOT NULL DEFAULT '[]'::jsonb,
  background  TEXT NOT NULL DEFAULT '#FFFFFF',
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS canvas_drawings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id     UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  created_by  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT,
  strokes     JSONB NOT NULL,
  background  TEXT NOT NULL DEFAULT '#FFFFFF',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Date matching + scheduling.
ALTER TABLE date_ideas ADD COLUMN IF NOT EXISTS settings    JSONB;   -- e.g. ["city","rural","long_distance"]
ALTER TABLE date_ideas ADD COLUMN IF NOT EXISTS is_premium  BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS date_idea_votes (
  pair_id     UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idea_id     UUID NOT NULL REFERENCES date_ideas(id) ON DELETE CASCADE,
  liked       BOOLEAN NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, idea_id)
);
CREATE TABLE IF NOT EXISTS date_plans (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id        UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  idea_id        UUID REFERENCES date_ideas(id) ON DELETE SET NULL,
  title          TEXT NOT NULL,
  notes          TEXT,
  scheduled_for  TIMESTAMPTZ,
  status         TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('idea', 'planned', 'confirmed', 'done', 'cancelled')),
  created_by     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  completed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Countdown flavour (trip, date, anniversary, see_each_other, other).
ALTER TABLE countdowns ADD COLUMN IF NOT EXISTS kind TEXT;

-- Monthly check-ins, revealed once both partners submit.
CREATE TABLE IF NOT EXISTS checkins (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id     UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month       TEXT NOT NULL, -- 'YYYY-MM' in the pair's timezone
  answers     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pair_id, user_id, month)
);

-- Random challenges.
CREATE TABLE IF NOT EXISTS challenge_completions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id        UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  challenge_key  TEXT NOT NULL,
  day            DATE NOT NULL,
  completed_by   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pair_id, challenge_key, day)
);
CREATE TABLE IF NOT EXISTS challenge_rerolls (
  pair_id  UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  day      DATE NOT NULL,
  count    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (pair_id, day)
);

-- Who's More Likely: votes per question, revealed once both vote.
CREATE TABLE IF NOT EXISTS wml_votes (
  pair_id       UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_key  TEXT NOT NULL,
  vote_for      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, pair_id, question_key)
);

-- Chess between the two partners. The move list is the source of truth; the
-- client replays it. The server enforces turn order and optimistic ordering.
CREATE TABLE IF NOT EXISTS chess_games (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id     UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  white_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  black_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  moves       JSONB NOT NULL DEFAULT '[]'::jsonb,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'checkmate', 'stalemate', 'draw', 'resigned')),
  winner_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spark_ledger_user ON spark_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_feed_posts_pair_created ON feed_posts(pair_id, created_at);
CREATE INDEX IF NOT EXISTS idx_feed_comments_post ON feed_comments(post_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notes_pair ON notes(pair_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_secret_messages_pair ON secret_messages(pair_id, created_at);
CREATE INDEX IF NOT EXISTS idx_canvas_drawings_pair ON canvas_drawings(pair_id, created_at);
CREATE INDEX IF NOT EXISTS idx_date_plans_pair ON date_plans(pair_id, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_mood_history_pair ON mood_history(pair_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chess_games_pair ON chess_games(pair_id, updated_at);

-- Onboarding questionnaire answers (relationship type, goals, daily time,
-- how you found us, ...). Free-form JSON: the app owns the question set.
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding     JSONB;
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarded_at   TIMESTAMPTZ;
