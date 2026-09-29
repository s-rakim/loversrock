// Exercises the daily-prompt fetcher: normalisation, each provider, and the
// cron job that schedules them against a live database.
//
// The HTTP provider runs against a real local server rather than a mock, so
// the fetch and parse path is genuinely executed; the local provider needs
// nothing but the seeded bank.
// This suite talks to the database directly rather than through the HTTP API,
// so it has to load .env itself - server.js does that for the other suites.
import 'dotenv/config';
import http from 'node:http';
import { query } from '../src/config/db.js';
import {
  TOPICS, pickTopic, normalizeQuestions, htmlToQuestions, sourceUrls,
  fetchFromHttp, fetchFromLocal, fetchQuestions,
} from '../src/services/promptSources.js';
import { refreshDailyPrompts } from '../src/cron/index.js';

let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${JSON.stringify(d)}`); } };

const ARTICLE = `<!doctype html><html><head><title>50 Questions</title>
<style>.q{color:red}</style><script>var x = "What is this?";</script></head>
<body>
<nav><a href="/">Home</a></nav>
<h1>50 questions to ask your partner</h1>
<p>Here is our list. Enjoy them together.</p>
<ol>
  <li>What&rsquo;s a small thing I do that makes you feel loved?</li>
  <li>Where would you want to live if money didn&#39;t matter?</li>
  <li>What&amp;nbsp;memory of us do you return to most?</li>
  <li>Short</li>
  <li>This one is not a question at all.</li>
</ol>
<div>Running prose can hide them too. What scares you most about the future? And we carry on afterwards.</div>
<footer>Copyright 2026</footer>
</body></html>`;

console.log('=== NORMALISATION ===');
check('strips list numbering', normalizeQuestions(['1. What made you smile today?'])[0] === 'What made you smile today?');
check('strips bullets', normalizeQuestions(['- What made you smile today?'])[0] === 'What made you smile today?');
check('drops non-questions', normalizeQuestions(['This is a statement about us.']).length === 0);
check('drops too-short', normalizeQuestions(['Why?']).length === 0);
check('drops too-long', normalizeQuestions([`${'a'.repeat(300)}?`]).length === 0);
check('drops markup and URLs', normalizeQuestions(['<b>What now?</b>', 'See https://x.com, ok?']).length === 0);
check('dedupes case/punctuation variants',
  normalizeQuestions(['What made you smile today?', 'what made you SMILE today?']).length === 1);
check('accepts object shapes', normalizeQuestions([{ question: 'What made you smile today?' }]).length === 1);
check('honours the limit', normalizeQuestions(Array.from({ length: 20 }, (_, i) => `Question number ${i} for us?`), { limit: 6 }).length === 6);
check('tolerates junk input', normalizeQuestions(null).length === 0 && normalizeQuestions([null, 42, {}]).length === 0);

console.log('\n=== TOPICS ===');
check('topic list is non-trivial', TOPICS.length >= 20, TOPICS.length);
const picks = new Set(Array.from({ length: 200 }, () => pickTopic()));
check('topics actually vary across picks', picks.size > 5, picks.size);
check('pickTopic always returns a known topic', [...picks].every((t) => TOPICS.includes(t)));

console.log('\n=== HTTP PROVIDER (real server) ===');
const payloads = {
  '/array': JSON.stringify(['What made you smile today?', 'Where should we go next year?', 'not a question']),
  '/wrapped': JSON.stringify({ questions: ['What made you smile today?', 'Where should we go next year?'] }),
  '/lines': 'What made you smile today?\nWhere should we go next year?\njunk line',
  '/broken': '<<<not json>>>',
};
const server = http.createServer((req, res) => {
  if (req.url === '/500') { res.writeHead(500); res.end('nope'); return; }
  const body = payloads[req.url];
  if (body === undefined) { res.writeHead(404); res.end('{}'); return; }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(body);
});
await new Promise((r) => server.listen(45821, '127.0.0.1', r));
const base = 'http://127.0.0.1:45821';

check('parses a JSON array', (await fetchFromHttp(`${base}/array`, 6)).length === 2);
check('parses {questions:[...]}', (await fetchFromHttp(`${base}/wrapped`, 6)).length === 2);
check('parses newline text', (await fetchFromHttp(`${base}/lines`, 6)).length === 2);
check('filters junk from a text source', !(await fetchFromHttp(`${base}/lines`, 6)).includes('junk line'));
check('unparseable body yields nothing, no throw', (await fetchFromHttp(`${base}/broken`, 6)).length === 0);
check('non-200 yields nothing, no throw', (await fetchFromHttp(`${base}/500`, 6)).length === 0);
check('empty url yields nothing', (await fetchFromHttp('', 6)).length === 0);

console.log('\n=== HTML SCRAPING (a normal web page) ===');
const scraped = normalizeQuestions(htmlToQuestions(ARTICLE), { limit: 20 });
check('pulls questions out of list items', scraped.some((q) => q.startsWith("What's a small thing")), scraped);
check('decodes named entities (&rsquo;)', scraped.some((q) => q.includes("What's a small thing")));
check('decodes numeric entities (&#39;)', scraped.some((q) => q.includes("didn't matter")));
check('finds questions buried in prose', scraped.some((q) => q.includes('scares you most about the future')), scraped);
check('ignores script contents', !scraped.some((q) => q.includes('What is this')), scraped);
check('drops non-questions and too-short lines', !scraped.some((q) => /^Short$|not a question/.test(q)));
check('no markup survives', scraped.every((q) => !/[<>]/.test(q)), scraped);
check('every scraped item is a question', scraped.every((q) => q.endsWith('?')));

payloads['/page'] = ARTICLE;
const viaPage = await fetchFromHttp(`${base}/page`, 6);
check('fetchFromHttp handles an HTML page end to end', viaPage.length >= 3, viaPage);

console.log('\n=== MULTIPLE SOURCES ===');
process.env.PROMPT_SOURCE_URL = ' https://a.example/one , https://b.example/two ';
const urls = sourceUrls();
check('splits and trims a comma-separated list', urls.length === 2 && urls.every((u) => u.startsWith('https://')), urls);
process.env.PROMPT_SOURCE_URL = '';
check('empty setting yields no urls', sourceUrls().length === 0);
process.env.PROMPT_SOURCE_URL = `${base}/500,${base}/page`;
const failover = await fetchQuestions({ count: 6 });
check('a dead url falls through to the next one', failover.source.startsWith('http:') && failover.questions.length > 0, failover.source);
delete process.env.PROMPT_SOURCE_URL;

console.log('\n=== LOCAL PROVIDER ===');
const local = fetchFromLocal(6);
check('local bank returns the asked-for count', local.length === 6, local.length);
check('local questions are all questions', local.every((q) => q.endsWith('?')));
const first = fetchFromLocal(3);
check('exclude removes already-used questions',
  fetchFromLocal(6, { exclude: first }).every((q) => !first.includes(q)));

console.log('\n=== PROVIDER SELECTION / FALLBACK ===');
process.env.PROMPT_SOURCE_URL = `${base}/array`;
const viaHttp = await fetchQuestions({ count: 6 });
check('uses the http source when configured', viaHttp.source.startsWith('http:'), viaHttp.source);
process.env.PROMPT_SOURCE_URL = `${base}/500`;
const viaLocal = await fetchQuestions({ count: 6 });
check('falls back to local when the source fails', viaLocal.source === 'local', viaLocal.source);
check('fallback still returns questions', viaLocal.questions.length === 6, viaLocal.questions.length);
check('a topic is always reported', TOPICS.includes(viaLocal.topic), viaLocal.topic);
delete process.env.PROMPT_SOURCE_URL;

console.log('\n=== THE 365-DAY LIST FIRST, THE BACKUP BEHIND IT ===');
const { promptBank, bankQuestionFor, BANK_SOURCE } = await import('../src/models/promptBank.js');
const list = promptBank();
check('the list has a question for every day of the year', list.length === 365, list.length);
check('no two days share a question', new Set(list.map((q) => q.content.toLowerCase())).size === 365);
check('every one is a question', list.every((q) => q.content.endsWith('?')));
check('the same date gets the same question every year', bankQuestionFor('2027-03-14').content === bankQuestionFor('2031-03-14').content);
check('a leap year\'s last day still gets one', Boolean(bankQuestionFor('2028-12-31')?.content));

const today = new Date();
const day = (o) => new Date(today.getTime() + o * 86400000).toISOString().slice(0, 10);
await query('DELETE FROM daily_prompts WHERE scheduled_date > $1', [day(0)]);

// Something the old nightly job would have left: an AI-written question on a
// day nobody has answered, and one somebody has.
const stamp = Date.now();
const { rows: [u] } = await query(`INSERT INTO users (email, password_hash, name) VALUES ($1, 'x', 'P') RETURNING id`, [`bank-${stamp}@t.dev`]);
const { rows: [u2] } = await query(`INSERT INTO users (email, password_hash, name) VALUES ($1, 'x', 'Q') RETURNING id`, [`bank2-${stamp}@t.dev`]);
const { rows: [pair] } = await query(`INSERT INTO pairs (user_a_id, user_b_id, timezone) VALUES ($1, $2, 'UTC') RETURNING id`, [u.id, u2.id]);
await query(`INSERT INTO daily_prompts (scheduled_date, category, content, source) VALUES ($1, 'x', 'An AI question nobody answered?', 'ai:test')`, [day(2)]);
const { rows: [answeredRow] } = await query(
  `INSERT INTO daily_prompts (scheduled_date, category, content, source) VALUES ($1, 'x', 'An AI question somebody answered?', 'ai:test') RETURNING id`, [day(3)]);
await query(`INSERT INTO prompt_responses (pair_id, prompt_id, user_id, answer_text) VALUES ($1, $2, $3, 'mine')`, [pair.id, answeredRow.id, u.id]);

const run = await refreshDailyPrompts(today);
const { rows: after } = await query(
  `SELECT scheduled_date::text AS date, content, source FROM daily_prompts WHERE scheduled_date > $1 AND scheduled_date <= $2 ORDER BY 1`,
  [day(0), day(30)]
);
const at = (d) => after.find((r) => r.date === d);
check('every day of the coming month has a question', after.length === 30, after.length);
check('from the list, each on its own day of the year',
  after.filter((r) => r.date !== day(3)).every((r) => r.source === BANK_SOURCE && r.content === bankQuestionFor(r.date).content), after.slice(0, 3));
check('an unanswered AI question went back to the list', at(day(2))?.content === bankQuestionFor(day(2)).content, at(day(2)));
check('an answered one is never changed', at(day(3))?.content === 'An AI question somebody answered?', at(day(3)));
check('it says what it did', run.fromBank > 0 && run.restored >= 1, run);

const second = await refreshDailyPrompts(today);
check('running again changes nothing', second.scheduled === 0 && second.restored === 0, second);

await query('DELETE FROM daily_prompts WHERE scheduled_date = $1', [day(5)]);
const third = await refreshDailyPrompts(today);
check('a freed day gets its list question back', third.scheduled === 1 && (await query('SELECT content FROM daily_prompts WHERE scheduled_date = $1', [day(5)])).rows[0]?.content === bankQuestionFor(day(5)).content, third);

// The backup: the list's question for a day is already on a date close by,
// so that day goes to fetchQuestions (AI, then the web, then local files).
await query('DELETE FROM daily_prompts WHERE scheduled_date = $1', [day(7)]);
await query(`INSERT INTO daily_prompts (scheduled_date, category, content, source) VALUES ($1, 'x', $2, 'test')`, [day(60), bankQuestionFor(day(7)).content]);
const fourth = await refreshDailyPrompts(today);
const { rows: [filled] } = await query('SELECT content, source FROM daily_prompts WHERE scheduled_date = $1', [day(7)]);
check('a day the list cannot fill comes from the backup', fourth.backup === 1 && filled && filled.source !== BANK_SOURCE && filled.content !== bankQuestionFor(day(7)).content, { fourth, filled });

await query('DELETE FROM daily_prompts WHERE scheduled_date = $1', [day(60)]);
await query('DELETE FROM users WHERE id = ANY($1)', [[u.id, u2.id]]);

server.close();
console.log(`\nPROMPT RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
process.exit(0);
