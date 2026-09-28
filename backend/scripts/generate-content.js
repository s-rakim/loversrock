// Everything the AI connector writes, now, from the model set in .env
// (QUIZ_LLM_*): the daily quiz, the daily prompts, date ideas (which are also
// the Swipe Dates cards), bucket-list ideas and challenges. The nightly and
// weekly jobs do the same on their own; this is for "now", and for checking a
// key works.
//
//   npm run ai:generate                    all of it
//   npm run ai:generate -- --dry-run       show what it would add, change nothing
//   npm run ai:generate -- --today         include today's prompt and quiz
//   npm run ai:generate -- --only prompts  or: quiz, catalogues
//
// In Docker:  docker compose exec backend npm run ai:generate -- --dry-run
//
// A prompt or quiz day somebody has already answered is never touched.
import 'dotenv/config';
import { pool } from '../src/config/db.js';
import { refillQuizBank, refreshDailyPrompts, freshenPrompts } from '../src/cron/index.js';
import { freshenUpcomingDays, quizLlmConfig } from '../src/models/quizGenerator.js';
import { growCatalogues } from '../src/models/contentGenerator.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const want = (part) => !only || only === part;
const dryRun = flag('dry-run');

async function main() {
  let config;
  try {
    config = quizLlmConfig();
  } catch (err) {
    console.error(`Not set up: ${err.message}`);
    process.exitCode = 1;
    return;
  }
  if (!config) {
    console.error('No model set. Add QUIZ_LLM_PROVIDER, QUIZ_LLM_API_KEY and QUIZ_LLM_MODEL to backend/.env (see docs/QUIZ.md).');
    process.exitCode = 1;
    return;
  }
  console.log(`Using ${config.provider} (${config.model})${dryRun ? ' — dry run, nothing is saved' : ''}.\n`);

  if (want('quiz')) {
    if (!dryRun) await refillQuizBank();
    const quiz = await freshenUpcomingDays({ days: 7, includeToday: flag('today'), config, dryRun });
    if (quiz.preview) {
      console.log(`QUIZ: ${quiz.preview.length} questions, for example:`);
      quiz.preview.slice(0, 3).forEach((q) => console.log(`  [${q.type}] ${q.questionText}`));
    } else {
      console.log(`QUIZ: ${quiz.questions} fresh questions on ${quiz.days.length} day(s).`);
    }
  }

  if (want('prompts')) {
    if (!dryRun) await refreshDailyPrompts();
    const prompts = await freshenPrompts({ includeToday: flag('today'), config, dryRun });
    if (dryRun) {
      console.log(`\nPROMPTS: ${prompts.preview.length} new${prompts.topic ? ` on "${prompts.topic}"` : ''}:`);
      prompts.preview.forEach((p) => console.log(`  - ${p}`));
    } else {
      console.log(`\nPROMPTS: ${prompts.replaced} day(s) now AI-written.`);
    }
  }

  if (want('catalogues')) {
    const added = await growCatalogues({ config, dryRun });
    console.log(`\nDATE IDEAS (and Swipe Dates): ${dryRun ? 'would add' : 'added'} ${added.dateIdeas.length}`);
    added.dateIdeas.forEach((d) => console.log(`  - ${d.title} (${d.category}, ${d.costTier}): ${d.description}`));
    console.log(`\nBUCKET-LIST IDEAS: ${dryRun ? 'would add' : 'added'} ${added.bucketIdeas.length}`);
    added.bucketIdeas.forEach((b) => console.log(`  - ${b}`));
    console.log(`\nCHALLENGES: ${dryRun ? 'would add' : 'added'} ${added.challenges.length}`);
    added.challenges.forEach((c) => console.log(`  - ${c.title} [${c.scope}]: ${c.detail}`));
  }
}

main()
  .catch((err) => { console.error(`Failed: ${err.message}`); process.exitCode = 1; })
  .finally(() => pool.end());
