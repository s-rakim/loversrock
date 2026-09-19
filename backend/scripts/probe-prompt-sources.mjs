// Checks every URL in PROMPT_SOURCE_URL and reports how many usable questions
// each one yields, so a source that returns nothing is found now rather than
// at 04:00 when the cron runs and silently falls back to the local bank.
//
//   npm run prompts:probe
//   npm run prompts:probe -- https://example.com/one https://example.com/two
import 'dotenv/config';
import { htmlToQuestions, normalizeQuestions, sourceUrls } from '../src/services/promptSources.js';

const urls = process.argv.slice(2).length ? process.argv.slice(2) : sourceUrls();

if (urls.length === 0) {
  console.log('No URLs. Set PROMPT_SOURCE_URL in backend/.env, or pass them as arguments.');
  process.exit(0);
}

let usable = 0;

for (const url of urls) {
  console.log(`\n${url}`);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'text/html,application/json,text/plain',
        'User-Agent': 'Mozilla/5.0 (compatible; loversrock/1.0; +self-hosted couples app)',
        'Accept-Language': 'en',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
    });

    const body = await response.text();
    if (!response.ok) {
      console.log(`  HTTP ${response.status} - unusable`);
      continue;
    }

    let candidates;
    try {
      const json = JSON.parse(body);
      candidates = Array.isArray(json) ? json : json?.questions || json?.prompts || json?.data || [];
    } catch {
      candidates = htmlToQuestions(body);
    }

    const questions = normalizeQuestions(candidates, { limit: 500 });
    const verdict = questions.length >= 6 ? 'GOOD' : questions.length > 0 ? 'THIN' : 'NOTHING';
    console.log(`  HTTP ${response.status}  ${(body.length / 1024).toFixed(0)} KB  ->  ${questions.length} questions  [${verdict}]`);
    questions.slice(0, 4).forEach((q) => console.log(`    - ${q.slice(0, 100)}`));
    if (questions.length === 0) {
      console.log('    Nothing static to read. The page most likely builds its');
      console.log('    questions with JavaScript, or puts them behind a form.');
    }
    if (questions.length) usable++;
  } catch (err) {
    console.log(`  failed: ${err.message}`);
  }
}

console.log(`\n${usable}/${urls.length} sources returned questions.`);
if (usable === 0) console.log('All sources are dry - the nightly job will fall back to the local bank.');
