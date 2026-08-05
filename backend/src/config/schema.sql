-- CandleApp canonical schema.
-- Applied via `npm run migrate` (src/config/migrate.js), NOT via docker init.sql,
-- so schema changes don't require destroying the postgres volume.

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_url TEXT,
  partner_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_partner_id ON users(partner_id);

-- Multi-device push token support (fixes single-fcm_token-column flaw)
CREATE TABLE IF NOT EXISTS user_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fcm_token TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, fcm_token)
);

-- Pair is the canonical scoping entity. Fixed timezone at creation (pinned decision).
CREATE TABLE IF NOT EXISTS pairs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a_id UUID NOT NULL REFERENCES users(id),
  user_b_id UUID NOT NULL REFERENCES users(id),
  timezone TEXT NOT NULL,                    -- IANA tz string, e.g. 'Africa/Nairobi'
  invite_code TEXT UNIQUE,
  invite_expires_at TIMESTAMPTZ,
  streak_count INT NOT NULL DEFAULT 0,
  last_active_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  unlinked_at TIMESTAMPTZ                    -- non-null once unlinked; row + children kept forever
);

CREATE TABLE IF NOT EXISTS daily_prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduled_date DATE UNIQUE NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('question', 'either_or')),
  content TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id UUID NOT NULL REFERENCES pairs(id),
  prompt_id UUID NOT NULL REFERENCES daily_prompts(id),
  user_id UUID NOT NULL REFERENCES users(id),
  answer_text TEXT NOT NULL,
  notified_at TIMESTAMPTZ,                   -- idempotency guard for the "both answered" push
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pair_id, prompt_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_prompt_responses_pair_prompt ON prompt_responses(pair_id, prompt_id);

CREATE TABLE IF NOT EXISTS quiz_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduled_date DATE NOT NULL,
  question_order INT NOT NULL CHECK (question_order BETWEEN 1 AND 5),
  type TEXT NOT NULL CHECK (type IN ('guess_partner', 'trivia', 'this_or_that')),
  question_text TEXT NOT NULL,
  choices JSONB,
  correct_answer TEXT,                       -- static answer for trivia/this_or_that; NULL for guess_partner
  content_version INT NOT NULL DEFAULT 1,
  UNIQUE (scheduled_date, question_order)
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id UUID NOT NULL REFERENCES pairs(id),
  quiz_question_id UUID NOT NULL REFERENCES quiz_questions(id),
  user_id UUID NOT NULL REFERENCES users(id),
  answer TEXT NOT NULL,
  correctness_state TEXT NOT NULL DEFAULT 'pending'
    CHECK (correctness_state IN ('pending', 'waiting_for_partner', 'computed')),
  is_correct BOOLEAN,
  answered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pair_id, quiz_question_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_pair_question ON quiz_attempts(pair_id, quiz_question_id);

CREATE TABLE IF NOT EXISTS memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id UUID NOT NULL REFERENCES pairs(id),
  image_url TEXT NOT NULL,
  caption TEXT,
  taken_at DATE NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'widget')),
  deleted_at TIMESTAMPTZ,                    -- soft-delete, 30-day undo window, cleaned by cron
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_memories_pair_taken_at ON memories(pair_id, taken_at);

CREATE TABLE IF NOT EXISTS bucket_list_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id UUID NOT NULL REFERENCES pairs(id),
  title TEXT NOT NULL,
  is_completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- pair_id NULL = global curated idea. A "saved" idea is simply a copied row with pair_id set.
CREATE TABLE IF NOT EXISTS date_ideas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id UUID REFERENCES pairs(id),
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  cost_tier TEXT CHECK (cost_tier IN ('free', '$', '$$', '$$$')),
  is_completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS countdowns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id UUID NOT NULL REFERENCES pairs(id),
  target_date TIMESTAMPTZ NOT NULL,
  label TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  auto_archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unified feed: text, photo, and doodle messages all live here (merges old Note + Doodle tables).
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id UUID NOT NULL REFERENCES pairs(id),
  sender_id UUID NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('text', 'photo', 'doodle')),
  content TEXT,                              -- text body, or doodle caption
  image_url TEXT,                            -- photo or rasterized doodle PNG
  stroke_data JSONB,                         -- optional raw stroke data for doodle replay
  reply_to_message_id UUID REFERENCES messages(id),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  seen_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_messages_pair_sent_at ON messages(pair_id, sent_at);

CREATE TABLE IF NOT EXISTS widget_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id UUID NOT NULL REFERENCES pairs(id),
  sender_id UUID NOT NULL REFERENCES users(id),
  image_url TEXT NOT NULL,
  caption TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  seen_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_widget_photos_pair_created_at ON widget_photos(pair_id, created_at);
