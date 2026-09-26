// Fresh daily-quiz questions, now, from the model set in .env — and the way
// to check a key works before trusting the nightly job with it.
//
//   npm run quiz:generate                  the next 7 days, from tomorrow
//   npm run quiz:generate -- --today       starting with today
//   npm run quiz:generate -- --days 3
//   npm run quiz:generate -- --all         replace fresh days too, not only
//                                          recycled ones
//   npm run quiz:generate -- --dry-run     show what it would write, change nothing
//
// In Docker:  docker compose exec backend npm run quiz:generate -- --today
//
// Days somebody has already started are never touched.
import 'dotenv/config';
import { pool } from '../src/config/db.js';
import { refillQuizBank } from '../src/cron/index.js';
import { freshenUpcomingDays, quizLlmConfig } from '../src/models/quizGenerator.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const daysArg = Number(args[args.indexOf('--days') + 1]);
const days = args.includes('--days') && Number.isInteger(daysArg) && daysArg > 0 ? Math.min(daysArg, 14) : 7;

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
    console.error('No model set. Add QUIZ_LLM_PROVIDER and QUIZ_LLM_API_KEY to backend/.env (see docs/QUIZ.md).');
    process.exitCode = 1;
    return;
  }

  console.log(`Asking ${config.provider} (${config.model}) for ${days} day(s) of questions${flag('dry-run') ? ' — dry run' : ''} ...`);
  // Make sure the days exist first, so there is something to replace.
  if (!flag('dry-run')) await refillQuizBank();
  const result = await freshenUpcomingDays({
    days, includeToday: flag('today'), onlyRecycled: !flag('all'), config, dryRun: flag('dry-run'),
  });

  if (result.preview) {
    for (const q of result.preview) {
      console.log(`\n[${q.type}] ${q.questionText}`);
      q.choices.forEach((c) => console.log(`   ${c === q.correctAnswer ? '*' : '-'} ${c}`));
    }
    console.log(`\n${result.preview.length} questions would fill ${result.days.length} day(s).`);
  } else if (result.days.length === 0) {
    console.log('Nothing to replace: every day in range is already fresh or has been started. Try --all or --today.');
  } else {
    console.log(`Done: ${result.questions} fresh questions on ${result.days.join(', ')}.`);
  }
}

main()
  .catch((err) => { console.error(`Failed: ${err.message}`); process.exitCode = 1; })
  .finally(() => pool.end());
