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
  -- 'system' | 'light' | 'dark'. Mirrored from the device so a reinstall or a
  -- second device starts in the theme the person actually chose.
  theme_preference           TEXT NOT NULL DEFAULT 'system',
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS theme_preference TEXT NOT NULL DEFAULT 'system';

-- Which side of the cycle tracker this person is on.
--
--   'owner'    they track their own cycle, and can edit all of it
--   'partner'  they see what their partner chose to share, read only
--
-- Chosen at sign-in rather than inferred, because there is nothing in an
-- account that reliably says which one somebody is, and guessing wrong means
-- either handing someone a read-only screen they cannot log into, or showing
-- private health data to the wrong person. Changeable later from Settings.
--
-- Nullable on purpose: an account created before this existed has not chosen,
-- and the app asks rather than assuming. NOT NULL with a default would have
-- silently made every existing account an owner.
ALTER TABLE users ADD COLUMN IF NOT EXISTS cycle_role TEXT
  CHECK (cycle_role IN ('owner', 'partner'));

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
  content         TEXT NOT NULL,
  -- Which provider produced this row: seed, http or local. Purely for
  -- observability - you can see at a glance whether the daily fetch is working
  -- or whether everything has quietly been coming from the local bank.
  source          TEXT NOT NULL DEFAULT 'seed',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE daily_prompts ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'seed';
ALTER TABLE daily_prompts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

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

-- Server-authoritative match state for the two-player games.
--
-- The board lives here, not on either phone. A move is a POST that the server
-- validates against the current state; an illegal move is a 400 and changes
-- nothing. That is the whole point: neither device can desync, replay an old
-- move, or move on the other's turn, because neither device is ever asked.
--
-- Scoped by pair_id like every other content table (docs/SPEC.md #3), so a
-- match belongs to the pairing it was played in and does not survive a
-- re-pairing into a new one.
-- One row per pair per quiz day, written the moment BOTH partners have
-- answered every question. Its only job is to make the reveal happen exactly
-- once: the insert is the claim, so a retried request or both phones
-- finishing simultaneously cannot send the notification twice.
-- What each person wants behind their own message thread. Personal, not
-- shared: a wallpaper is a reading preference, and the two of you having
-- different taste is not a conflict to resolve. Stored on the account rather
-- than the device so it follows you to a new phone.
--
-- Holds either a built-in id ('blush') or 'photo:<storage key>' pointing at
-- one of the pair's own memories.
ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_wallpaper TEXT;

-- The PUBLIC half of this device's encryption keypair, base64.
--
-- The private half never leaves the phone's keychain and this server has no
-- way to ask for it. All this column does is let each partner fetch the other's
-- public key so they can encrypt to it; publishing public keys is what they
-- are for. If this column leaked in full it would reveal nothing.
ALTER TABLE users ADD COLUMN IF NOT EXISTS public_key TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS public_key_set_at TIMESTAMPTZ;

-- Whether `content` is ciphertext rather than text.
--
-- A column rather than sniffing the prefix, so a message that happens to
-- begin with the marker is never mistaken for one, and so the server can say
-- truthfully what it is storing without being able to read it.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS encrypted BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS quiz_days (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id         UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  scheduled_date  DATE NOT NULL,
  revealed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pair_id, scheduled_date)
);

CREATE TABLE IF NOT EXISTS game_matches (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id        UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  game           TEXT NOT NULL,
  -- Seat assignment. Both are users in this pair; seat 1 moves first.
  player1_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player2_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Whose turn it is, as a user id. NULL once the match is over.
  turn_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  -- The full game state, shape defined by each game's engine. Includes
  -- information one player must not see (Uno hands), which is why the API
  -- never returns this column raw - see redactFor() in models/gameEngines.
  state          JSONB NOT NULL,
  status         TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'finished', 'abandoned')),
  -- 'player1' | 'player2' | 'draw', set only when status = 'finished'.
  result         TEXT CHECK (result IS NULL OR result IN ('player1', 'player2', 'draw')),
  move_count     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The lookup every request makes: this pair's live match of this game.
CREATE INDEX IF NOT EXISTS game_matches_pair_game_idx
  ON game_matches (pair_id, game, status);

-- One live match per game per pair. Partial, so finished matches pile up as
-- history without blocking a rematch.
CREATE UNIQUE INDEX IF NOT EXISTS game_matches_one_active_idx
  ON game_matches (pair_id, game) WHERE status = 'active';

-- Every move, in order. Kept separate from the state blob so a match can be
-- replayed, and so "who did what" survives even after the board is overwritten.
CREATE TABLE IF NOT EXISTS game_moves (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id     UUID NOT NULL REFERENCES game_matches(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ply          INTEGER NOT NULL,
  move         JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(match_id, ply)
);

-- Running tally per pair, so the games hub can show "you 4 - 2 them" without
-- walking every match.
CREATE TABLE IF NOT EXISTS game_scores (
  pair_id    UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  game       TEXT NOT NULL,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wins       INTEGER NOT NULL DEFAULT 0,
  draws      INTEGER NOT NULL DEFAULT 0,
  losses     INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (pair_id, game, user_id)
);

-- Voice and video calls.
--
-- Only the CALL is recorded here - who rang whom, when, how it ended, how
-- long it lasted. Media never touches the server: WebRTC connects the two
-- phones directly and the audio and video go peer to peer. The server's
-- whole job is to carry the offer, the answer and the ICE candidates until
-- the two sides have found each other, and then to get out of the way.
--
-- That is also why there is no recording, and no column that could hold one.
CREATE TABLE IF NOT EXISTS call_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id      UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  caller_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  callee_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('voice', 'video')),
  status       TEXT NOT NULL DEFAULT 'ringing'
               CHECK (status IN ('ringing', 'connected', 'ended', 'missed', 'declined', 'failed')),
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at  TIMESTAMPTZ,
  ended_at     TIMESTAMPTZ,
  end_reason   TEXT
);

CREATE INDEX IF NOT EXISTS call_sessions_pair_idx
  ON call_sessions (pair_id, started_at DESC);

-- At most one call ringing or connected per pair, so a second tap on the
-- call button joins or is refused rather than starting a rival call.
CREATE UNIQUE INDEX IF NOT EXISTS call_sessions_one_live_idx
  ON call_sessions (pair_id) WHERE status IN ('ringing', 'connected');

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
  flow          TEXT,
  symptoms      JSONB,
  mood          TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, log_date)
);

-- The daily log grew well past flow/symptoms/mood/notes. Added as ALTERs
-- rather than in the CREATE so existing installs pick them up on migrate;
-- every one is nullable, because a day with one field filled in is the normal
-- case and a half-filled log must never be rejected.
ALTER TABLE period_daily_logs ADD COLUMN IF NOT EXISTS moods JSONB;
ALTER TABLE period_daily_logs ADD COLUMN IF NOT EXISTS energy TEXT;
ALTER TABLE period_daily_logs ADD COLUMN IF NOT EXISTS intercourse JSONB;
ALTER TABLE period_daily_logs ADD COLUMN IF NOT EXISTS medicine JSONB;
ALTER TABLE period_daily_logs ADD COLUMN IF NOT EXISTS breast_self_exam BOOLEAN;
ALTER TABLE period_daily_logs ADD COLUMN IF NOT EXISTS ovulation_test TEXT;
ALTER TABLE period_daily_logs ADD COLUMN IF NOT EXISTS pregnancy_test TEXT;
ALTER TABLE period_daily_logs ADD COLUMN IF NOT EXISTS cervical_mucus TEXT;
ALTER TABLE period_daily_logs ADD COLUMN IF NOT EXISTS weight_kg NUMERIC(5,2);
ALTER TABLE period_daily_logs ADD COLUMN IF NOT EXISTS temperature_c NUMERIC(4,2);
ALTER TABLE period_daily_logs ADD COLUMN IF NOT EXISTS water_ml INTEGER;
ALTER TABLE period_daily_logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Self-reported, not derived from the intercourse record: the partner view
-- shows "Sex drive: Low" and a one-word "Moment" the owner picked, which is a
-- different thing from "there was activity logged today".
ALTER TABLE period_daily_logs ADD COLUMN IF NOT EXISTS sex_drive TEXT;
ALTER TABLE period_daily_logs ADD COLUMN IF NOT EXISTS moment TEXT;
ALTER TABLE period_daily_logs DROP CONSTRAINT IF EXISTS period_daily_logs_sex_drive_check;
ALTER TABLE period_daily_logs ADD CONSTRAINT period_daily_logs_sex_drive_check
  CHECK (sex_drive IS NULL OR sex_drive IN ('none', 'low', 'medium', 'high'));

-- The original CHECK only allowed spotting/light/medium/heavy; the daily log
-- offers Light/Medium/Heavy/Disaster. Dropped and rebuilt as a superset so no
-- existing row becomes invalid.
ALTER TABLE period_daily_logs DROP CONSTRAINT IF EXISTS period_daily_logs_flow_check;
ALTER TABLE period_daily_logs ADD CONSTRAINT period_daily_logs_flow_check
  CHECK (flow IS NULL OR flow IN ('spotting', 'light', 'medium', 'heavy', 'disaster'));

-- What the partner is allowed to see, per category (docs/SPEC.md #5, amended).
-- Everything but the phase defaults to false: someone who never opens the
-- sharing screen shares exactly what they shared before this table existed.
-- period_settings.sharing_enabled remains the master switch above all of these.
CREATE TABLE IF NOT EXISTS period_sharing (
  user_id          UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  share_phase      BOOLEAN NOT NULL DEFAULT TRUE,
  share_symptoms   BOOLEAN NOT NULL DEFAULT FALSE,
  share_mood       BOOLEAN NOT NULL DEFAULT FALSE,
  share_flow       BOOLEAN NOT NULL DEFAULT FALSE,
  share_sex_drive  BOOLEAN NOT NULL DEFAULT FALSE,
  share_notes      BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
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

-- What each partner calls the other. Keyed by (pair_id, set_by_id): a
-- nickname belongs to a specific pairing, not to a person, so unlinking and
-- re-pairing starts from blank rather than carrying a name given by an ex
-- into a new relationship (docs/SPEC.md #3 and #6). Each row is one
-- direction: set_by_id chose this name for the other member of the pair.
CREATE TABLE IF NOT EXISTS pair_nicknames (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id     UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  set_by_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pair_id, set_by_id)
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
CREATE INDEX IF NOT EXISTS idx_pair_nicknames_pair ON pair_nicknames(pair_id);


-- ---------------------------------------------------------------------------
-- Ambient presence: the things that make a partner feel present without the
-- app being open. Anniversary, mood, notes, reactions.
-- ---------------------------------------------------------------------------

-- When the two of you started. Drives "days together" and the anniversary
-- countdown, both of which are widgets rather than screens — nobody opens an
-- app to find out how long they have been together.
ALTER TABLE pairs ADD COLUMN IF NOT EXISTS together_since DATE;

-- The current mood, one row per person per pair.
--
-- Deliberately NOT the cycle mood log, which is private by default and
-- belongs to one person's health data. This is the thing you WANT the other
-- to see, so it is a different table with different rules.
CREATE TABLE IF NOT EXISTS partner_moods (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id     UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mood        TEXT NOT NULL,
  note        TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pair_id, user_id)
);

-- Love notes, and the sealed kind.
--
-- `sealed` is what makes the secret-message widget work: the widget says a
-- note is waiting without saying what it is, and opening it in the app is
-- what reveals it. `opened_at` is therefore meaningful state, not analytics —
-- it is the difference between "you have something" and "you read it".
CREATE TABLE IF NOT EXISTS notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id     UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  author_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  sealed      BOOLEAN NOT NULL DEFAULT FALSE,
  opened_at   TIMESTAMPTZ,
  pinned      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notes_pair_idx ON notes (pair_id, created_at DESC);

-- Reactions on anything a pair shares.
--
-- One table rather than one per target, keyed by (kind, target_id): the
-- alternative is message_reactions, memory_reactions, note_reactions and a
-- fourth the day something else becomes reactable.
--
-- The unique index is per person per target, so reacting again REPLACES
-- rather than stacks — two people cannot run up a counter between them, which
-- is the whole point when there are only two of you.
CREATE TABLE IF NOT EXISTS reactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id     UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('message', 'memory', 'note', 'doodle')),
  target_id   UUID NOT NULL,
  emoji       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, target_kind, target_id)
);

CREATE INDEX IF NOT EXISTS reactions_target_idx ON reactions (target_kind, target_id);

-- ---------------------------------------------------------------------------
-- Achievements and streak repair.
-- ---------------------------------------------------------------------------

-- Earned badges, one row per pair per achievement.
--
-- The catalogue itself lives in code (models/achievements.js) rather than a
-- table: it is a fixed list that ships with the app, and putting it in the
-- database would mean a migration every time one is added and a seed that
-- can drift from the rules that award them.
CREATE TABLE IF NOT EXISTS pair_achievements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id     UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  slug        TEXT NOT NULL,
  earned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pair_id, slug)
);

-- Streak repair.
--
-- `longest_streak` is kept separately because a repaired streak should not be
-- able to invent a record that never happened, and because losing a streak
-- should not erase the memory of how far you got.
ALTER TABLE pairs ADD COLUMN IF NOT EXISTS longest_streak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pairs ADD COLUMN IF NOT EXISTS streak_repairs_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pairs ADD COLUMN IF NOT EXISTS last_repair_at TIMESTAMPTZ;
ALTER TABLE pairs ADD COLUMN IF NOT EXISTS broken_streak INTEGER;
ALTER TABLE pairs ADD COLUMN IF NOT EXISTS broken_streak_at DATE;

-- ---------------------------------------------------------------------------
-- Date matching and scheduling.
-- ---------------------------------------------------------------------------

ALTER TABLE date_ideas ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;
ALTER TABLE date_ideas ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'idea'
  CHECK (status IN ('idea', 'scheduled', 'done', 'skipped'));
ALTER TABLE date_ideas ADD COLUMN IF NOT EXISTS image_url TEXT;

-- One vote per person per idea.
--
-- A MATCH is both of you voting yes, and neither sees the other's vote until
-- they have cast their own — same rule as the daily prompt, for the same
-- reason: knowing what they picked changes what you pick, and then the match
-- means nothing.
CREATE TABLE IF NOT EXISTS date_idea_votes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id      UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  date_idea_id UUID NOT NULL REFERENCES date_ideas(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  liked        BOOLEAN NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (date_idea_id, user_id)
);

CREATE INDEX IF NOT EXISTS date_idea_votes_pair_idx ON date_idea_votes (pair_id, date_idea_id);

-- ---------------------------------------------------------------------------
-- Characters: one per person, dressed by their owner, seen by their partner.
-- ---------------------------------------------------------------------------

-- Appearance is columns; the outfit is jsonb.
--
-- The split is deliberate. Skin, hair and build are a fixed, small set that
-- the renderer must always have a value for, so they get columns and defaults.
-- The wardrobe is a bag of slots that will grow — a hat today, a scarf next
-- month — and adding a column per garment would mean a migration per garment.
CREATE TABLE IF NOT EXISTS user_avatars (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  skin        TEXT NOT NULL DEFAULT 'medium',
  hair        TEXT NOT NULL DEFAULT 'short',
  hair_color  TEXT NOT NULL DEFAULT 'black',
  build       TEXT NOT NULL DEFAULT 'average',
  outfit      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- The canvas gallery: drawings kept, rather than sent and lost in the thread.
-- ---------------------------------------------------------------------------

-- Strokes, not pixels.
--
-- A drawing is stored exactly as it is drawn: a list of stroke objects, each
-- with its points, colour, width and tool. That is what lets the other phone
-- re-render it as real vectors at its own resolution, lets a drawing be
-- reopened and added to months later, and keeps a whole gallery in a few
-- kilobytes rather than a few megabytes of PNG.
--
-- `canvas_color` travels with it because an eraser stroke is painted IN the
-- canvas colour — without it, a drawing made on the dark paper reopens on the
-- light paper with every erased area drawn in as a stripe.
CREATE TABLE IF NOT EXISTS canvas_drawings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id      UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  created_by   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT,
  stroke_data  JSONB NOT NULL,
  canvas_color TEXT NOT NULL DEFAULT '#FFFDF8',
  -- A drawing either of you can keep adding to. The gallery shows who
  -- touched it last, which is not necessarily who started it.
  updated_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  pinned       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pinned first, then newest: the gallery's one and only sort order, so it is
-- an index rather than a sort on every read.
CREATE INDEX IF NOT EXISTS canvas_drawings_pair_idx
  ON canvas_drawings (pair_id, pinned DESC, updated_at DESC);

-- ---------------------------------------------------------------------------
-- Nudges: the quick-kiss widget, and anything else that is a tap and a feeling.
-- ---------------------------------------------------------------------------

-- Deliberately not the thumb-kiss socket event.
--
-- Thumb kiss is synchronous: both of you have to be holding the same screen at
-- the same moment, which is lovely and happens rarely. A widget kiss is the
-- opposite — one tap from a home screen, delivered whether or not they are
-- looking. So it is a stored row rather than a relayed packet: it survives
-- their phone being in a pocket, and the widget on the other side can say
-- "kissed you, 4m ago" hours later.
CREATE TABLE IF NOT EXISTS nudges (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id    UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  from_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'kiss' CHECK (kind IN ('kiss', 'hug', 'thinking', 'miss')),
  seen_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only ever read as "the most recent one from them", so that is the index.
CREATE INDEX IF NOT EXISTS nudges_pair_idx ON nudges (pair_id, from_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Seasonal decks: ones that appear when they are relevant and retire after.
-- ---------------------------------------------------------------------------

-- The window is stored as two MM-DD strings rather than dates, because a deck
-- recurs every year — a real date would need re-seeding each January.
--
-- A window may WRAP the year end (New Year runs 12-26 → 01-07), which is why
-- the comparison lives in models/seasons.js rather than in SQL: "between" is
-- wrong for half of these, and wrong in a way that silently shows nothing.
ALTER TABLE question_decks ADD COLUMN IF NOT EXISTS season_start TEXT;
ALTER TABLE question_decks ADD COLUMN IF NOT EXISTS season_end TEXT;

-- Some seasons are not the same date for everybody. `anniversary` means the
-- month the two of you started, which is a different month per couple and
-- cannot be a fixed window at all.
ALTER TABLE question_decks ADD COLUMN IF NOT EXISTS season_anchor TEXT
  CHECK (season_anchor IS NULL OR season_anchor IN ('anniversary'));

-- ---------------------------------------------------------------------------
-- Follow-ups: questions that pick up on what you actually said.
-- ---------------------------------------------------------------------------

-- No LLM, and that is a constraint rather than a compromise.
--
-- These follow-ups are templates keyed to the category of the question that
-- produced them, with a `{answer}` placeholder that is filled with what your
-- PARTNER wrote. The adaptivity is real — the question you get depends on what
-- was said — without a paid API in the loop or a model quietly rewriting one
-- of your answers back at you.
--
-- Templates are global, like daily_prompts. Which one a pair gets, and what it
-- is filled with, is per-pair and lives in prompt_follow_up_picks.
CREATE TABLE IF NOT EXISTS prompt_follow_ups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category    TEXT NOT NULL,
  template    TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (category, template)
);

CREATE INDEX IF NOT EXISTS prompt_follow_ups_category_idx ON prompt_follow_ups (category);

-- One follow-up per pair per prompt, chosen once and then fixed.
--
-- Fixed matters: a follow-up that re-rolled on every read would change under
-- you between opening the screen and answering, and the answer would end up
-- attached to a question you never saw.
CREATE TABLE IF NOT EXISTS prompt_follow_up_picks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id       UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  prompt_id     UUID NOT NULL REFERENCES daily_prompts(id) ON DELETE CASCADE,
  follow_up_id  UUID NOT NULL REFERENCES prompt_follow_ups(id) ON DELETE CASCADE,
  -- The TEMPLATE, not a rendered question.
  --
  -- The two of you share one follow-up, but the quote inside it is different
  -- for each of you: a follow-up quotes your PARTNER. Storing the rendered
  -- text meant whoever opened the screen first decided whose words both of
  -- you were asked about — so Ben was asked about Ben.
  template_text TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pair_id, prompt_id)
);

CREATE TABLE IF NOT EXISTS prompt_follow_up_answers (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pick_id  UUID NOT NULL REFERENCES prompt_follow_up_picks(id) ON DELETE CASCADE,
  user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answer   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pick_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Monthly check-in.
-- ---------------------------------------------------------------------------

-- Once a month, the two of you answer the same short set of questions, and
-- neither sees the other's answers until both are done.
--
-- The scores are the point of keeping them rather than making it a
-- conversation prompt: "we were at 6 in March and 9 in June" is a thing you
-- can only know if somebody wrote it down at the time.
CREATE TABLE IF NOT EXISTS checkins (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id    UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  -- The first of the month it belongs to, so "one per month" is a unique
  -- index rather than something the application has to remember to check.
  month      DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pair_id, month)
);

CREATE TABLE IF NOT EXISTS checkin_answers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkin_id  UUID NOT NULL REFERENCES checkins(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The question's stable key, not its text: the wording can be improved
  -- later without orphaning two years of answers.
  question_key TEXT NOT NULL,
  score       INTEGER CHECK (score IS NULL OR (score BETWEEN 1 AND 10)),
  answer      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (checkin_id, user_id, question_key)
);

CREATE TABLE IF NOT EXISTS checkin_completions (
  checkin_id   UUID NOT NULL REFERENCES checkins(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (checkin_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Random challenge.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS challenges (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  detail      TEXT,
  -- How long it is meant to take, which decides whether drawing a new one
  -- tomorrow is reasonable.
  scope       TEXT NOT NULL DEFAULT 'today' CHECK (scope IN ('now', 'today', 'week')),
  category    TEXT NOT NULL DEFAULT 'together'
);

-- One live challenge per pair. A second draw while one is open would turn the
-- feature into a slot machine you pull until you get an easy one.
CREATE TABLE IF NOT EXISTS pair_challenges (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id      UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'skipped')),
  drawn_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  drawn_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at    TIMESTAMPTZ
);

-- At most one open challenge per pair, enforced by the database rather than by
-- everyone remembering to check.
CREATE UNIQUE INDEX IF NOT EXISTS pair_challenges_one_open
  ON pair_challenges (pair_id) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS pair_challenges_history_idx
  ON pair_challenges (pair_id, drawn_at DESC);

-- ---------------------------------------------------------------------------
-- The joint feed.
-- ---------------------------------------------------------------------------

-- DERIVED, not materialised, and that is the whole design decision.
--
-- The obvious alternative is a `feed_items` table written to by every feature
-- that produces one. It paginates beautifully and it is wrong here: every
-- future feature has to remember to write its row, a missed write is an
-- invisible hole in your history, an edit or delete needs a matching update,
-- and getting any of it wrong is only discovered months later when somebody
-- notices a day is missing.
--
-- A UNION over the source tables cannot drift, needs no backfill, and for two
-- people with a few thousand rows between them is not remotely a performance
-- problem. If it ever becomes one, a materialised view is a change to one
-- query rather than to nine features.
--
-- So the only new table here is the one with genuinely new data in it.
CREATE TABLE IF NOT EXISTS feed_comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id    UUID NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  author_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- (kind, id) rather than a foreign key, because the target lives in one of
  -- eight tables. The trade is that a deleted source leaves an orphan, which
  -- the feed query drops on its own by never selecting it.
  item_kind  TEXT NOT NULL,
  item_id    UUID NOT NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feed_comments_item_idx
  ON feed_comments (pair_id, item_kind, item_id, created_at);

-- Reactions already existed for messages and memories; the feed adds the rest
-- of the things worth reacting to.
ALTER TABLE reactions DROP CONSTRAINT IF EXISTS reactions_target_kind_check;
ALTER TABLE reactions ADD CONSTRAINT reactions_target_kind_check
  CHECK (target_kind IN (
    'message', 'memory', 'note', 'doodle',
    'prompt', 'quiz', 'locket', 'drawing', 'date', 'challenge', 'checkin', 'milestone'
  ));

-- ---------------------------------------------------------------------------
-- The paywall columns, removed.
-- ---------------------------------------------------------------------------

-- `is_locked` shipped 17 of the 27 decks behind a Premium badge, on a server
-- two people run for themselves — which meant the owner was locked out of his
-- own content. It was set to false everywhere long ago; the column is dropped
-- now so there is no longer a flag to flip, by a seed file, a migration, or
-- anybody's future good idea.
--
-- `is_implemented` goes with it: every game in the catalogue has a screen, so
-- the flag can only ever say something untrue, and the "Coming soon" label it
-- drove was a promise nobody had made.
ALTER TABLE question_decks DROP COLUMN IF EXISTS is_locked;
ALTER TABLE games_catalog DROP COLUMN IF EXISTS is_locked;
ALTER TABLE games_catalog DROP COLUMN IF EXISTS is_implemented;
