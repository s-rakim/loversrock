// The optional quiz question generator, end to end, with no real model: two
// local stand-ins answer as Anthropic's Messages API and as an OpenAI-style
// chat API would, and the questions go into the real database.
import http from 'node:http';
import { query, pool } from '../src/config/db.js';
import {
  quizLlmConfig, validateQuestions, parseReply, generateQuizQuestions, freshenUpcomingDays,
} from '../src/models/quizGenerator.js';

let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${JSON.stringify(d)}`); } };
const throws = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };

console.log('=== SETTINGS ===');
check('off unless a provider is named', quizLlmConfig({}) === null);
check('an unknown provider is a clear error', /is not one of/.test(throws(() => quizLlmConfig({ QUIZ_LLM_PROVIDER: 'skynet', QUIZ_LLM_API_KEY: 'k' }))));
check('a key is required', /QUIZ_LLM_API_KEY is needed/.test(throws(() => quizLlmConfig({ QUIZ_LLM_PROVIDER: 'groq' }))));
check('a model is required for anyone but Anthropic', /QUIZ_LLM_MODEL is needed/.test(throws(() => quizLlmConfig({ QUIZ_LLM_PROVIDER: 'groq', QUIZ_LLM_API_KEY: 'k' }))));
const claude = quizLlmConfig({ QUIZ_LLM_PROVIDER: 'Anthropic', QUIZ_LLM_API_KEY: 'k' });
check('Anthropic has a default model', claude.model === 'claude-opus-5' && claude.provider === 'anthropic', claude);
const groq = quizLlmConfig({ QUIZ_LLM_PROVIDER: 'groq', QUIZ_LLM_API_KEY: 'k', QUIZ_LLM_MODEL: 'm' });
check('presets fill in the address', groq.baseUrl === 'https://api.groq.com/openai/v1', groq);
check('ollama needs no key', quizLlmConfig({ QUIZ_LLM_PROVIDER: 'ollama', QUIZ_LLM_MODEL: 'llama3' })?.apiKey === '');
check('custom needs an address', /QUIZ_LLM_BASE_URL is needed/.test(throws(() => quizLlmConfig({ QUIZ_LLM_PROVIDER: 'custom', QUIZ_LLM_API_KEY: 'k', QUIZ_LLM_MODEL: 'm' }))));

console.log('\n=== ONLY GOOD QUESTIONS GET THROUGH ===');
const good = [
  { type: 'trivia', questionText: 'Which planet is known as the Red Planet?', choices: ['Venus', 'Mars', 'Jupiter', 'Saturn'], correctAnswer: 'mars' },
  { type: 'guess_partner', questionText: 'What would you order at a cafe?', choices: ['Latte', 'Tea', 'Hot chocolate', 'Smoothie'], correctAnswer: null },
  { type: 'this_or_that', questionText: 'Beach holiday or mountain cabin?', choices: ['Beach', 'Mountains'], correctAnswer: null },
];
const bad = [
  { type: 'trivia', questionText: 'Which is the largest ocean on Earth?', choices: ['Atlantic', 'Indian', 'Arctic', 'Southern'], correctAnswer: 'Pacific' },
  { type: 'this_or_that', questionText: 'Tea or coffee in the morning?', choices: ['Tea', 'Coffee', 'Juice'], correctAnswer: null },
  { type: 'guess_partner', questionText: 'Pick a dessert you love most?', choices: ['Cake', 'cake', 'Pie', 'Tart'], correctAnswer: null },
  { type: 'essay', questionText: 'Write about your perfect day together', choices: [], correctAnswer: null },
  { type: 'guess_partner', questionText: 'Hi?', choices: ['a', 'b', 'c', 'd'], correctAnswer: null },
];
const kept = validateQuestions([...good, ...bad]);
check('good questions are kept', kept.length === 3, kept);
check('a trivia answer is matched to its choice exactly', kept[0].correctAnswer === 'Mars');
check('wrong answers, wrong choice counts, duplicates, unknown types and stubs are dropped', kept.every((q) => good.some((g) => g.questionText === q.questionText)));
check('a question already in the bank is not taken again', validateQuestions(good, ['which planet is known as the red planet']).length === 2);
check('replies wrapped in chatter or fences still parse', parseReply('Sure!\n```json\n{"questions":[{"type":"trivia"}]}\n```').length === 1);

console.log('\n=== THE TWO WAYS OF ASKING ===');
let n = 0;
const makeQuestions = (count) => Array.from({ length: count }, () => {
  n += 1;
  return n % 3 === 0
    ? { type: 'this_or_that', questionText: `Fresh this or that number ${n}?`, choices: ['This', 'That'], correctAnswer: null }
    : { type: 'trivia', questionText: `Fresh trivia question number ${n}?`, choices: ['A', 'B', 'C', 'D'].map((c) => `${c}${n}`), correctAnswer: `B${n}` };
});
const seen = { anthropic: [], openai: [] };
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const payload = JSON.parse(body || '{}');
    const count = Number((payload.messages?.at(-1)?.content || '').match(/Write (\d+) new questions/)?.[1] || 5);
    if (req.url === '/v1/messages') {
      seen.anthropic.push({ payload, key: req.headers['x-api-key'] });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        id: 'msg_test', type: 'message', role: 'assistant', model: payload.model,
        content: [{ type: 'text', text: JSON.stringify({ questions: makeQuestions(count) }) }],
        stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
      }));
    } else if (req.url === '/v1/chat/completions') {
      seen.openai.push({ payload, auth: req.headers.authorization });
      if (payload.response_format && seen.openai.length === 1) {
        res.statusCode = 400;
        return res.end('{"error":"response_format not supported"}');
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: `Here you go:\n${JSON.stringify({ questions: makeQuestions(count) })}` } }] }));
    } else { res.statusCode = 404; res.end(); }
  });
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const viaClaude = await generateQuizQuestions(7, [], { provider: 'anthropic', apiKey: 'sk-test', model: 'claude-haiku-4-5', baseUrl: base });
check('Claude, through the official SDK, returns checked questions', viaClaude.length === 7, viaClaude.length);
const sent = seen.anthropic[0]?.payload;
check('  with the key, the model and a JSON schema for the reply',
  seen.anthropic[0]?.key === 'sk-test' && sent?.model === 'claude-haiku-4-5'
  && sent?.output_config?.format?.type === 'json_schema' && sent.output_config.format.schema.required.includes('questions'), sent?.output_config);

const viaOpenAi = await generateQuizQuestions(4, [], { provider: 'groq', apiKey: 'gsk-test', model: 'some-model', baseUrl: `${base}/v1` });
check('an OpenAI-style provider returns checked questions', viaOpenAi.length === 4, viaOpenAi.length);
check('  sending the key as a bearer token', seen.openai.every((s) => s.auth === 'Bearer gsk-test'));
check('  and retrying without JSON mode when a model refuses it', seen.openai.length === 2 && !seen.openai[1].payload.response_format);

const many = await generateQuizQuestions(45, [], { provider: 'anthropic', apiKey: 'k', model: 'm', baseUrl: base });
check('large requests come in batches, with no repeats between them', many.length === 45 && new Set(many.map((q) => q.questionText)).size === 45);

console.log('\n=== INTO THE QUIZ ===');
// Far in the future so nothing real is touched.
const today = new Date('2099-03-01T12:00:00Z');
const day = (i) => new Date(Date.UTC(2099, 2, 1 + i)).toISOString().slice(0, 10);
const cfg = { provider: 'anthropic', apiKey: 'k', model: 'm', baseUrl: base };
await query("DELETE FROM quiz_questions WHERE scheduled_date >= '2099-01-01'");
// An original, then recycled copies of it on the following days.
const add = (d, order, text) => query(
  `INSERT INTO quiz_questions (scheduled_date, question_order, type, question_text, choices)
   VALUES ($1, $2, 'this_or_that', $3, '["x","y"]') RETURNING id`, [d, order, text]);
for (let o = 1; o <= 5; o += 1) await add(day(-1), o, `Original ${o}?`);
for (let i = 1; i <= 3; i += 1) for (let o = 1; o <= 5; o += 1) await add(day(i), o, `Original ${o}?`);
// Day 2 has been started by someone.
const stamp = Date.now();
const users = [];
for (const who of ['a', 'b']) {
  const { rows } = await query(`INSERT INTO users (name, email, password_hash) VALUES ($1, $2, 'x') RETURNING id`, [`Q${who}`, `q${who}${stamp}@t.dev`]);
  users.push(rows[0].id);
}
const { rows: pairRows } = await query(`INSERT INTO pairs (user_a_id, user_b_id, timezone) VALUES ($1, $2, 'UTC') RETURNING id`, users);
const { rows: startedQ } = await query('SELECT id FROM quiz_questions WHERE scheduled_date = $1 AND question_order = 1', [day(2)]);
await query(`INSERT INTO quiz_attempts (pair_id, quiz_question_id, user_id, answer, correctness_state) VALUES ($1, $2, $3, 'x', 'computed')`,
  [pairRows[0].id, startedQ[0].id, users[0]]);

const dry = await freshenUpcomingDays({ days: 3, today, config: cfg, dryRun: true });
check('a dry run shows questions and changes nothing', dry.preview?.length > 0
  && (await query('SELECT count(*) FROM quiz_questions WHERE scheduled_date = $1 AND question_text LIKE $2', [day(1), 'Fresh%'])).rows[0].count === '0');

const result = await freshenUpcomingDays({ days: 3, today, config: cfg });
check('recycled days nobody has started get fresh questions', JSON.stringify(result.days) === JSON.stringify([day(1), day(3)]), result);
const onDay = async (d) => (await query('SELECT question_text FROM quiz_questions WHERE scheduled_date = $1 ORDER BY question_order', [d])).rows.map((r) => r.question_text);
check('  five of them each', (await onDay(day(1))).length === 5 && (await onDay(day(1))).every((t) => t.startsWith('Fresh')));
check('  a day someone has started is left exactly as it was', (await onDay(day(2))).every((t) => t.startsWith('Original')));
check('  and today is left alone unless asked', (await onDay(day(0))).length === 0);
const again = await freshenUpcomingDays({ days: 3, today, config: cfg });
check('run again, it does not pay to replace fresh days', again.days.length === 0, again);
const forced = await freshenUpcomingDays({ days: 3, today, config: cfg, onlyRecycled: false });
check('unless told to replace those too', forced.days.includes(day(1)) && !forced.days.includes(day(2)), forced);
check('the trivia answers stored are real choices', (await query(
  `SELECT count(*) FROM quiz_questions WHERE scheduled_date >= '2099-01-01' AND type = 'trivia'
     AND NOT (choices ? correct_answer)`)).rows[0].count === '0');

await query("DELETE FROM quiz_questions WHERE scheduled_date >= '2099-01-01'");
await query('DELETE FROM pairs WHERE id = $1', [pairRows[0].id]);
await query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
server.close();
await pool.end();

console.log(`\nQUIZ GENERATOR RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log('FAILURES:', fails); process.exit(1); }
