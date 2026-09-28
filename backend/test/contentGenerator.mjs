// AI-written content beyond the quiz: daily prompts, date ideas (the Swipe
// Dates cards too), bucket-list ideas and challenges. Against the live
// database, with a stand-in provider that mixes good answers with the kinds of
// bad ones a real model sometimes gives, so the checks are what is tested.
import 'dotenv/config';
import http from 'node:http';
import { query, pool } from '../src/config/db.js';

let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${JSON.stringify(d)}`); } };

const stamp = Date.now() % 1e7;
let n = 0;
const next = () => `${stamp}-${(n += 1)}`;
const kindOf = (system) => (/daily question/.test(system) ? 'prompts'
  : /date ideas/.test(system) ? 'dates'
    : /bucket-list/.test(system) ? 'bucket'
      : /relationship challenges/.test(system) ? 'challenges' : 'unknown');

const replies = {
  prompts: () => ({ questions: [
    `What made you laugh today, number ${next()}?`,
    'Not a question at all',
    'Too short?',
    `What is one place you want us to see, version ${next()}?`,
    `Visit https://example.com for the answer ${next()}?`,
  ] }),
  dates: () => ({ ideas: [
    { title: `Cook the same recipe on a video call ${next()}`, description: 'Pick a recipe, shop for it separately, and cook it side by side on a call.', category: 'at_home', costTier: '$' },
    { title: `Stargaze together ${next()}`, description: 'Find the same constellation from wherever you each are and describe it to each other.', category: 'outdoors', costTier: 'free' },
    { title: 'Bad category', description: 'A perfectly good description that goes nowhere.', category: 'nightclub', costTier: '$' },
    { title: 'Bad cost', description: 'A perfectly good description that goes nowhere.', category: 'culture', costTier: 'cheap' },
    { title: 'x', description: 'Title too short to be anything useful.', category: 'culture', costTier: 'free' },
  ] }),
  bucket: () => ({ ideas: [
    `See the northern lights together ${next()}`,
    `Learn to sail a small boat ${next()}`,
    'Is this a question?',
    'x'.repeat(90),
  ] }),
  challenges: () => ({ challenges: [
    { title: `Send a voice note ${next()}`, detail: 'Record thirty seconds about your favourite moment this week and send it.', scope: 'now', category: 'words' },
    { title: `Plan a surprise ${next()}`, detail: 'Plan a small surprise for your next call and do not give it away.', scope: 'week', category: 'acts' },
    { title: 'Bad scope', detail: 'Something that takes a month is not a challenge here.', scope: 'month', category: 'acts' },
  ] }),
};

const asked = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const payload = JSON.parse(body || '{}');
    const kind = kindOf(payload.messages?.[0]?.content || '');
    asked.push(kind);
    const reply = replies[kind]?.() ?? {};
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }));
  });
});
await new Promise((r) => server.listen(0, r));
Object.assign(process.env, {
  QUIZ_LLM_PROVIDER: 'custom',
  QUIZ_LLM_API_KEY: 'test-key',
  QUIZ_LLM_MODEL: 'test-model',
  QUIZ_LLM_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`,
});

const gen = await import('../src/models/contentGenerator.js');
const { fetchQuestions } = await import('../src/services/promptSources.js');
const { freshenPrompts } = await import('../src/cron/index.js');
const { quizLlmConfig } = await import('../src/models/quizGenerator.js');
const config = quizLlmConfig();

console.log('=== EACH KIND IS CHECKED BEFORE IT IS KEPT ===');
const prompts = await gen.generatePrompts(2, [], { config });
check('prompts: only real questions survive', prompts.length === 2 && prompts.every((p) => p.endsWith('?') && !/http/.test(p)), prompts);
const dates = await gen.generateDateIdeas(2, [], { config });
check('date ideas: bad categories, costs and titles are dropped',
  dates.length === 2 && dates.every((d) => gen.DATE_CATEGORIES.includes(d.category) && gen.COST_TIERS.includes(d.costTier)), dates);
const bucket = await gen.generateBucketIdeas(2, [], { config });
check('bucket ideas: questions and overlong ones are dropped', bucket.length === 2 && bucket.every((b) => !b.includes('?') && b.length <= 70), bucket);
const challenges = await gen.generateChallenges(2, [], { config });
check('challenges: an unknown scope is dropped', challenges.length === 2 && challenges.every((c) => gen.CHALLENGE_SCOPES.includes(c.scope)), challenges);
const repeat = await gen.generateBucketIdeas(1, [bucket[0]], { config });
check('something already there is never suggested again', !repeat.includes(bucket[0]), repeat);

console.log('\n=== THE DAILY PROMPT ASKS THE AI FIRST ===');
const fetched = await fetchQuestions({ count: 2, exclude: [] });
check('with a connector set up, the prompt comes from it', fetched.source === 'ai:custom' && fetched.questions.length > 0, fetched);

console.log('\n=== INTO THE CATALOGUES ===');
const before = (await query(`SELECT count(*)::int AS n FROM date_ideas WHERE source = 'ai'`)).rows[0].n;
const added = await gen.growCatalogues({ dateIdeas: 2, bucketIdeas: 2, challenges: 2, config });
const after = (await query(`SELECT count(*)::int AS n FROM date_ideas WHERE source = 'ai'`)).rows[0].n;
check('new date ideas land in the catalogue Date Ideas and Swipe Dates read', after - before === added.dateIdeas.length && added.dateIdeas.length === 2, { before, after });
const dateRow = (await query('SELECT * FROM date_ideas WHERE title = $1', [added.dateIdeas[0].title])).rows[0];
check('as catalogue ideas, not anybody\'s own', dateRow && dateRow.pair_id === null && dateRow.source === 'ai', dateRow);
const bucketRows = (await query(`SELECT title FROM bucket_suggestions WHERE title = ANY($1)`, [added.bucketIdeas])).rows;
check('bucket-list ideas are saved as suggestions', bucketRows.length === 2, bucketRows);
const challengeRows = (await query(`SELECT slug, source FROM challenges WHERE title = ANY($1)`, [added.challenges.map((c) => c.title)])).rows;
check('challenges are saved, with a stable slug', challengeRows.length === 2 && challengeRows.every((c) => c.slug.startsWith('ai-') && c.source === 'ai'), challengeRows);
const dry = await gen.growCatalogues({ dateIdeas: 1, bucketIdeas: 0, challenges: 0, config, dryRun: true });
const afterDry = (await query(`SELECT count(*)::int AS n FROM date_ideas WHERE source = 'ai'`)).rows[0].n;
check('a dry run writes nothing', dry.dateIdeas.length === 1 && afterDry === after, { afterDry, after });

console.log('\n=== UPCOMING PROMPTS BECOME AI-WRITTEN, ANSWERED ONES NEVER DO ===');
// A pair and a user, for an answer to exist at all.
const { rows: [u] } = await query(
  `INSERT INTO users (email, password_hash, name) VALUES ($1, 'x', 'Tester') RETURNING id`, [`content-${stamp}@t.dev`]
);
const { rows: [u2] } = await query(
  `INSERT INTO users (email, password_hash, name) VALUES ($1, 'x', 'Tester2') RETURNING id`, [`content2-${stamp}@t.dev`]
);
const { rows: [pair] } = await query(
  `INSERT INTO pairs (user_a_id, user_b_id, timezone) VALUES ($1, $2, 'UTC') RETURNING id`, [u.id, u2.id]
);
const day = (offset) => new Date(Date.UTC(2090, 0, 1 + offset)).toISOString().slice(0, 10);
await query(`DELETE FROM daily_prompts WHERE scheduled_date >= '2090-01-01' AND scheduled_date < '2090-02-01'`);
const ids = [];
for (let i = 0; i < 3; i += 1) {
  const { rows } = await query(
    `INSERT INTO daily_prompts (scheduled_date, category, content, source) VALUES ($1, 'test', $2, 'local') RETURNING id`,
    [day(i), `Built-in question ${stamp} ${i}?`]
  );
  ids.push(rows[0].id);
}
await query(`INSERT INTO prompt_responses (pair_id, prompt_id, user_id, answer_text) VALUES ($1, $2, $3, 'my answer')`, [pair.id, ids[1], u.id]);

const fresh = await freshenPrompts({ days: 3, includeToday: true, today: new Date(`${day(0)}T12:00:00Z`), config });
const now = (await query('SELECT id, content, source FROM daily_prompts WHERE id = ANY($1)', [ids])).rows;
const byId = Object.fromEntries(now.map((r) => [r.id, r]));
check('unanswered upcoming prompts are replaced with AI-written ones',
  fresh.replaced === 2 && byId[ids[0]].source === 'ai:custom' && byId[ids[2]].source === 'ai:custom', { fresh, now });
check('a prompt somebody answered is left exactly as it was',
  byId[ids[1]].source === 'local' && byId[ids[1]].content === `Built-in question ${stamp} 1?`, byId[ids[1]]);
const again = await freshenPrompts({ days: 3, includeToday: true, today: new Date(`${day(0)}T12:00:00Z`), config });
check('and running again does not pay twice for the same days', again.replaced === 0, again);

// Tidy up: this runs against a real database, so what it added comes out.
await query('DELETE FROM date_ideas WHERE pair_id IS NULL AND title = ANY($1)', [added.dateIdeas.map((d) => d.title)]);
await query('DELETE FROM bucket_suggestions WHERE title = ANY($1)', [added.bucketIdeas]);
await query('DELETE FROM challenges WHERE title = ANY($1)', [added.challenges.map((c) => c.title)]);
// And the far-future prompt rows.
await query(`DELETE FROM daily_prompts WHERE scheduled_date >= '2090-01-01' AND scheduled_date < '2090-02-01'`);
await query('DELETE FROM users WHERE id = ANY($1)', [[u.id, u2.id]]);

console.log('\n=== WITHOUT A CONNECTOR, NOTHING HAPPENS ===');
const none = await gen.growCatalogues({ config: null });
check('no connector, nothing asked and nothing added', none.dateIdeas.length === 0 && none.bucketIdeas.length === 0, none);
check('each kind was asked for by its own instructions', ['prompts', 'dates', 'bucket', 'challenges'].every((k) => asked.includes(k)) && !asked.includes('unknown'), asked);

server.close();
await pool.end();
console.log(`\nCONTENT GENERATOR RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
fails.forEach((f) => console.log(`  - ${f}`));
process.exit(fails.length ? 1 : 0);
