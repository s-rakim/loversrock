// Exercises the daily-prompt fetcher: normalisation, each provider, and the
// cron job that schedules them against a live database.
//
// The Claude provider is driven through an injected fake client so the suite
// costs nothing and needs no key; the HTTP provider runs against a real local
// server, so the fetch/parse path is genuinely executed.
// This suite talks to the database directly rather than through the HTTP API,
// so it has to load .env itself - server.js does that for the other suites.
import 'dotenv/config';
import http from 'node:http';
import { query } from '../src/config/db.js';
import {
  TOPICS, pickTopic, normalizeQuestions,
  fetchFromHttp, fetchFromLocal, fetchFromClaude, fetchQuestions,
} from '../src/services/promptSources.js';
import { refreshDailyPrompts } from '../src/cron/index.js';

let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${JSON.stringify(d)}`); } };

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

console.log('\n=== LOCAL PROVIDER ===');
const local = fetchFromLocal(6);
check('local bank returns the asked-for count', local.length === 6, local.length);
check('local questions are all questions', local.every((q) => q.endsWith('?')));
const first = fetchFromLocal(3);
check('exclude removes already-used questions',
  fetchFromLocal(6, { exclude: first }).every((q) => !first.includes(q)));

console.log('\n=== CLAUDE PROVIDER (injected fake client) ===');
const fakeClient = (payload, stop = 'end_turn') => ({
  beta: { messages: { create: async (params) => {
    fakeClient.lastParams = params;
    return { stop_reason: stop, content: [{ type: 'text', text: payload }] };
  } } },
});
const ok = fakeClient(JSON.stringify({ questions: ['What made you smile today?', 'Where should we go next year?'] }));
check('parses a structured response', (await fetchFromClaude('travel', 6, { client: ok })).length === 2);
const refused = fakeClient('{}', 'refusal');
check('a refusal yields nothing rather than throwing', (await fetchFromClaude('x', 6, { client: refused })).length === 0);
const garbled = fakeClient('not json at all');
check('unparseable model output yields nothing', (await fetchFromClaude('x', 6, { client: garbled })).length === 0);

console.log('\n=== PROVIDER SELECTION / FALLBACK ===');
delete process.env.ANTHROPIC_API_KEY; delete process.env.PROMPT_ANTHROPIC_API_KEY;
process.env.PROMPT_SOURCE_URL = `${base}/array`;
const viaHttp = await fetchQuestions({ count: 6 });
check('uses the http source when configured', viaHttp.source === 'http', viaHttp);
process.env.PROMPT_SOURCE_URL = `${base}/500`;
const viaLocal = await fetchQuestions({ count: 6 });
check('falls back to local when the source fails', viaLocal.source === 'local', viaLocal.source);
check('fallback still returns questions', viaLocal.questions.length === 6, viaLocal.questions.length);
check('a topic is always reported', TOPICS.includes(viaLocal.topic), viaLocal.topic);
delete process.env.PROMPT_SOURCE_URL;

console.log('\n=== CRON JOB AGAINST THE REAL DATABASE ===');
const today = new Date();
const day = (o) => new Date(today.getTime() + o * 86400000).toISOString().slice(0, 10);
await query('DELETE FROM daily_prompts WHERE scheduled_date > $1', [day(0)]);

const run = await refreshDailyPrompts(today);
check('schedules into empty upcoming days', run.scheduled > 0, run);
const { rows: after } = await query(
  'SELECT scheduled_date, content, source, category FROM daily_prompts WHERE scheduled_date > $1 ORDER BY scheduled_date',
  [day(0)]
);
check('rows landed on future dates only', after.every((r) => r.scheduled_date > day(0)), after.map((r) => r.scheduled_date));
check('today was not overwritten', !after.some((r) => r.scheduled_date === day(0)));
check('source is recorded', after.every((r) => r.source && r.source !== 'seed'), after.map((r) => r.source));
check('category carries the topic', after.every((r) => TOPICS.includes(r.category)), after.map((r) => r.category));
check('no duplicate questions scheduled', new Set(after.map((r) => r.content)).size === after.length);

const second = await refreshDailyPrompts(today);
check('re-running is a no-op once the bank is full', second.scheduled === 0, second);

await query('DELETE FROM daily_prompts WHERE scheduled_date = $1', [day(3)]);
const third = await refreshDailyPrompts(today);
check('a single freed day gets refilled', third.scheduled === 1, third);

server.close();
console.log(`\nPROMPT RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
process.exit(0);
