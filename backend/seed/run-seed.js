import 'dotenv/config';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { pool, query } from '../src/config/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadJson(name) {
  return JSON.parse(readFileSync(join(__dirname, name), 'utf8'));
}

function dateWithOffset(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function seedDailyPrompts() {
  const prompts = loadJson('daily_prompts.json');
  for (const p of prompts) {
    await query(
      `INSERT INTO daily_prompts (scheduled_date, category, content)
       VALUES ($1, $2, $3) ON CONFLICT (scheduled_date) DO NOTHING`,
      [dateWithOffset(p.dayOffset), p.category, p.content]
    );
  }
  console.log(`[seed] daily_prompts: ${prompts.length} days`);
}

async function seedQuizQuestions() {
  const days = loadJson('quiz_questions.json');
  let count = 0;
  for (const day of days) {
    const scheduledDate = dateWithOffset(day.dayOffset);
    for (const q of day.questions) {
      await query(
        `INSERT INTO quiz_questions (scheduled_date, question_order, type, question_text, choices, correct_answer)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (scheduled_date, question_order) DO NOTHING`,
        [
          scheduledDate,
          q.questionOrder,
          q.type,
          q.questionText,
          q.choices ? JSON.stringify(q.choices) : null,
          q.correctAnswer || null,
        ]
      );
      count += 1;
    }
  }
  console.log(`[seed] quiz_questions: ${count} questions across ${days.length} days`);
}

async function seedDateIdeas() {
  const ideas = loadJson('date_ideas.json');
  let inserted = 0;
  for (const idea of ideas) {
    const { rows } = await query('SELECT 1 FROM date_ideas WHERE pair_id IS NULL AND title = $1', [idea.title]);
    if (rows.length > 0) continue;
    await query(
      `INSERT INTO date_ideas (title, description, category, cost_tier) VALUES ($1, $2, $3, $4)`,
      [idea.title, idea.description, idea.category, idea.costTier]
    );
    inserted += 1;
  }
  console.log(`[seed] date_ideas: ${inserted} new / ${ideas.length} total`);
}

async function seedQuestionDecks() {
  const decks = loadJson('question_decks.json');
  for (const deck of decks) {
    await query(
      `INSERT INTO question_decks (slug, category, emoji, title, sort_order,
                                   season_start, season_end, season_anchor)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (slug) DO UPDATE SET
         category = EXCLUDED.category, emoji = EXCLUDED.emoji, title = EXCLUDED.title,
         sort_order = EXCLUDED.sort_order,
         -- Re-seeding must be able to CLEAR a season as well as set one, so
         -- these take the new value even when it is null.
         season_start = EXCLUDED.season_start, season_end = EXCLUDED.season_end,
         season_anchor = EXCLUDED.season_anchor`,
      [deck.slug, deck.category, deck.emoji, deck.title, deck.sortOrder,
        deck.seasonStart || null, deck.seasonEnd || null, deck.seasonAnchor || null]
    );
  }
  console.log(`[seed] question_decks: ${decks.length} decks`);

  const deckQuestionsBySlug = loadJson('deck_questions.json');
  let questionCount = 0;
  for (const [slug, questions] of Object.entries(deckQuestionsBySlug)) {
    const { rows } = await query('SELECT id FROM question_decks WHERE slug = $1', [slug]);
    const deckId = rows[0]?.id;
    if (!deckId) {
      console.warn(`[seed] skipping deck_questions for unknown deck slug: ${slug}`);
      continue;
    }
    for (let i = 0; i < questions.length; i += 1) {
      const { rows: existing } = await query(
        'SELECT 1 FROM deck_questions WHERE deck_id = $1 AND question_text = $2',
        [deckId, questions[i]]
      );
      if (existing.length > 0) continue;
      await query(
        `INSERT INTO deck_questions (deck_id, question_text, sort_order) VALUES ($1, $2, $3)`,
        [deckId, questions[i], i + 1]
      );
      questionCount += 1;
    }
  }
  console.log(`[seed] deck_questions: ${questionCount} new questions`);
}

async function seedFollowUps() {
  const byCategory = loadJson('prompt_follow_ups.json');
  let count = 0;
  for (const [category, templates] of Object.entries(byCategory)) {
    for (let i = 0; i < templates.length; i += 1) {
      await query(
        `INSERT INTO prompt_follow_ups (category, template, sort_order)
         VALUES ($1, $2, $3)
         ON CONFLICT (category, template) DO UPDATE SET sort_order = EXCLUDED.sort_order`,
        [category, templates[i], i + 1]
      );
      count += 1;
    }
  }
  console.log(`[seed] prompt_follow_ups: ${count} templates`);
}

async function seedChallenges() {
  const challenges = loadJson('challenges.json');
  for (const c of challenges) {
    await query(
      `INSERT INTO challenges (slug, title, detail, scope, category)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (slug) DO UPDATE SET
         title = EXCLUDED.title, detail = EXCLUDED.detail,
         scope = EXCLUDED.scope, category = EXCLUDED.category`,
      [c.slug, c.title, c.detail, c.scope, c.category]
    );
  }
  console.log(`[seed] challenges: ${challenges.length} challenges`);
}

async function seedGamesCatalog() {
  const games = loadJson('games_catalog.json');
  for (const game of games) {
    await query(
      `INSERT INTO games_catalog (slug, emoji, title, subtitle, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (slug) DO UPDATE SET
         emoji = EXCLUDED.emoji, title = EXCLUDED.title, subtitle = EXCLUDED.subtitle,
         sort_order = EXCLUDED.sort_order`,
      [game.slug, game.emoji, game.title, game.subtitle, game.sortOrder]
    );
  }
  console.log(`[seed] games_catalog: ${games.length} games`);
}

/** True when a table has no rows at all — a fresh database. */
async function isEmpty(table) {
  const { rows } = await query(`SELECT NOT EXISTS (SELECT 1 FROM ${table}) AS empty`);
  return rows[0].empty;
}

/**
 * `--startup`: what the backend container runs on every start, after the
 * migration and before the server.
 *
 * The reference lists — games, question decks, follow-ups, challenges, date
 * ideas — are the app's own catalogue, not anybody's data. Every one of them
 * is an upsert or a skip-if-present, so they are brought up to date on every
 * start: a game added to games_catalog.json appears after a rebuild with
 * nothing to remember. Before this, the arcade stayed empty on any server
 * where `npm run seed` had not been run by hand since the games list last
 * changed.
 *
 * Daily prompts and quiz days are different: they are dated relative to
 * TODAY, so re-running them on every restart would keep laying the same
 * content onto new dates. They are only filled into an empty database.
 */
async function run() {
  const startup = process.argv.includes('--startup');

  if (!startup || await isEmpty('daily_prompts')) await seedDailyPrompts();
  if (!startup || await isEmpty('quiz_questions')) await seedQuizQuestions();
  await seedDateIdeas();
  await seedQuestionDecks();
  await seedFollowUps();
  await seedChallenges();
  await seedGamesCatalog();
  await pool.end();
  console.log('[seed] done');
}

run().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
