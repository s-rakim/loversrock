import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/config/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadJson(filename) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, filename), "utf8"));
}

async function seedDailyPrompts() {
  const prompts = loadJson("daily_prompts.json");
  for (const p of prompts) {
    await pool.query(
      `INSERT INTO daily_prompts (scheduled_date, category, content)
       VALUES ($1, $2, $3)
       ON CONFLICT (scheduled_date) DO NOTHING`,
      [p.scheduled_date, p.category, p.content]
    );
  }
  console.log(`Seeded ${prompts.length} daily prompts.`);
}

async function seedQuizQuestions() {
  const questions = loadJson("quiz_questions.json");
  for (const q of questions) {
    await pool.query(
      `INSERT INTO quiz_questions (scheduled_date, question_order, type, question_text, choices, correct_answer)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (scheduled_date, question_order) DO NOTHING`,
      [
        q.scheduled_date,
        q.question_order,
        q.type,
        q.question_text,
        q.choices ? JSON.stringify(q.choices) : null,
        q.correct_answer,
      ]
    );
  }
  console.log(`Seeded ${questions.length} quiz questions.`);
}

async function seedDateIdeas() {
  const ideas = loadJson("date_ideas.json");
  for (const idea of ideas) {
    // No natural unique key for global ideas, so guard against duplicate re-seeding
    // by checking title first (simple approach; fine for a small curated seed set).
    const { rows } = await pool.query(
      `SELECT id FROM date_ideas WHERE pair_id IS NULL AND title = $1`,
      [idea.title]
    );
    if (rows.length > 0) continue;
    await pool.query(
      `INSERT INTO date_ideas (title, description, category, cost_tier)
       VALUES ($1, $2, $3, $4)`,
      [idea.title, idea.description, idea.category, idea.cost_tier]
    );
  }
  console.log(`Seeded ${ideas.length} date ideas (skipping any already present).`);
}

async function main() {
  console.log("Seeding CandleApp database...");
  await seedDailyPrompts();
  await seedQuizQuestions();
  await seedDateIdeas();
  await pool.end();
  console.log("Done. NOTE: seed content only covers a starter window (~10-14 days) — " +
    "extend seed/daily_prompts.json and seed/quiz_questions.json before this runs out, " +
    "or the cron warning in src/cron/index.js will start firing.");
}

main().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
