import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import { pairLocalDateString } from '../models/pairs.js';

const router = asyncRouter();

router.use(requireAuth, requirePair);

// 'MM-DD' window check; windows may wrap the new year (e.g. 12-15 → 01-05).
function inSeason(deck, monthDay) {
  if (!deck.season_start || !deck.season_end) return true;
  return deck.season_start <= deck.season_end
    ? monthDay >= deck.season_start && monthDay <= deck.season_end
    : monthDay >= deck.season_start || monthDay <= deck.season_end;
}

async function unlockedDeckSlugs(pairId) {
  const { rows } = await query(`SELECT item_key FROM pair_unlocks WHERE pair_id = $1 AND item_key LIKE 'deck:%'`, [pairId]);
  return new Set(rows.map((r) => r.item_key.slice(5)));
}

router.get('/', async (req, res) => {
  const monthDay = pairLocalDateString(req.pair).slice(5);
  const unlocked = await unlockedDeckSlugs(req.pair.id);
  const { rows: all } = await query('SELECT * FROM question_decks ORDER BY sort_order, title');
  // Seasonal decks only appear during their window. Every deck also carries
  // whether this pair can open it (Sparks decks need unlocking first).
  const rows = all
    .filter((d) => inSeason(d, monthDay))
    .map((d) => ({ ...d, is_seasonal: Boolean(d.season_start), unlocked: !d.spark_cost || unlocked.has(d.slug) }));
  const grouped = {};
  for (const deck of rows) {
    if (!grouped[deck.category]) grouped[deck.category] = [];
    grouped[deck.category].push(deck);
  }
  res.json({ decksByCategory: grouped });
});

router.get('/:slug/questions', async (req, res) => {
  const { rows: deckRows } = await query('SELECT * FROM question_decks WHERE slug = $1', [req.params.slug]);
  const deck = deckRows[0];
  if (!deck) return res.status(404).json({ error: 'Deck not found' });
  if (deck.spark_cost && !(await unlockedDeckSlugs(req.pair.id)).has(deck.slug)) {
    return res.status(402).json({ error: `Unlock this deck for ${deck.spark_cost} Sparks`, locked: true, sparkCost: deck.spark_cost, deck });
  }

  const { rows: questions } = await query(
    'SELECT * FROM deck_questions WHERE deck_id = $1 ORDER BY sort_order',
    [deck.id]
  );
  const questionIds = questions.map((q) => q.id);

  const { rows: responses } = questionIds.length
    ? await query('SELECT * FROM deck_question_responses WHERE deck_question_id = ANY($1::uuid[]) AND pair_id = $2', [
        questionIds,
        req.pair.id,
      ])
    : { rows: [] };

  const { rows: skipRows } = await query('SELECT deck_question_id FROM question_skips WHERE user_id = $1', [req.userId]);
  const skipped = new Set(skipRows.map((r) => r.deck_question_id));

  const payload = questions.map((q) => {
    const mine = responses.find((r) => r.deck_question_id === q.id && r.user_id === req.userId);
    const partner = responses.find((r) => r.deck_question_id === q.id && r.user_id === req.partnerId);
    const bothAnswered = Boolean(mine && partner);
    return {
      id: q.id,
      skipped: skipped.has(q.id),
      questionText: q.question_text,
      myAnswer: mine ? mine.answer_text : null,
      // Partner's answer only revealed once both have answered.
      partnerAnswer: bothAnswered ? partner.answer_text : null,
      bothAnswered,
    };
  });

  res.json({ deck, questions: payload });
});

router.post('/questions/:questionId/respond', async (req, res) => {
  const { answerText } = req.body;
  if (!answerText) return res.status(400).json({ error: 'answerText is required' });

  const { rows } = await query(
    `INSERT INTO deck_question_responses (pair_id, deck_question_id, user_id, answer_text)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (pair_id, deck_question_id, user_id) DO UPDATE SET answer_text = EXCLUDED.answer_text
     RETURNING *`,
    [req.pair.id, req.params.questionId, req.userId, answerText]
  );

  res.json({ response: rows[0] });
});

// Adaptive questions: skipping tells the app what to show less of.
router.post('/questions/:questionId/skip', async (req, res) => {
  const { rows } = await query('SELECT id FROM deck_questions WHERE id = $1', [req.params.questionId]);
  if (!rows[0]) return res.status(404).json({ error: 'Question not found' });
  await query(
    'INSERT INTO question_skips (pair_id, user_id, deck_question_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    [req.pair.id, req.userId, rows[0].id]
  );
  res.status(204).end();
});

router.delete('/questions/:questionId/skip', async (req, res) => {
  await query('DELETE FROM question_skips WHERE user_id = $1 AND deck_question_id = $2', [req.userId, req.params.questionId]);
  res.status(204).end();
});

// "For you": unanswered, never-skipped questions from decks this pair can
// open, weighted towards categories you answer and away from ones you skip.
// A category's weight is (answers + 1) / (skips + 1); questions are drawn
// by weighted random so the feed still varies day to day.
router.get('/for-you', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  const monthDay = pairLocalDateString(req.pair).slice(5);
  const unlocked = await unlockedDeckSlugs(req.pair.id);

  const { rows: candidates } = await query(
    `SELECT q.id, q.question_text, d.slug, d.title AS deck_title, d.category, d.emoji, d.spark_cost, d.season_start, d.season_end
     FROM deck_questions q JOIN question_decks d ON d.id = q.deck_id
     WHERE NOT EXISTS (SELECT 1 FROM deck_question_responses r WHERE r.deck_question_id = q.id AND r.pair_id = $1 AND r.user_id = $2)
       AND NOT EXISTS (SELECT 1 FROM question_skips s WHERE s.deck_question_id = q.id AND s.user_id = $2)`,
    [req.pair.id, req.userId]
  );
  const { rows: stats } = await query(
    `SELECT d.category,
            COUNT(DISTINCT r.deck_question_id) FILTER (WHERE r.user_id = $2) AS answers,
            COUNT(DISTINCT s.deck_question_id) AS skips
     FROM question_decks d
     JOIN deck_questions q ON q.deck_id = d.id
     LEFT JOIN deck_question_responses r ON r.deck_question_id = q.id AND r.pair_id = $1 AND r.user_id = $2
     LEFT JOIN question_skips s ON s.deck_question_id = q.id AND s.user_id = $2
     GROUP BY d.category`,
    [req.pair.id, req.userId]
  );
  const weights = Object.fromEntries(stats.map((s) => [s.category, (Number(s.answers) + 1) / (Number(s.skips) + 1)]));

  const pool = candidates
    .filter((c) => (!c.spark_cost || unlocked.has(c.slug)) && inSeason(c, monthDay))
    .map((c) => ({ ...c, weight: weights[c.category] ?? 1 }));
  const picked = [];
  while (picked.length < limit && pool.length > 0) {
    const total = pool.reduce((sum, c) => sum + c.weight, 0);
    let roll = Math.random() * total;
    const idx = pool.findIndex((c) => (roll -= c.weight) <= 0);
    picked.push(pool.splice(idx === -1 ? pool.length - 1 : idx, 1)[0]);
  }

  res.json({
    questions: picked.map((c) => ({
      id: c.id, questionText: c.question_text, deckSlug: c.slug, deckTitle: c.deck_title, category: c.category, emoji: c.emoji,
    })),
    categoryWeights: weights,
  });
});

export default router;
