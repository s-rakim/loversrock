import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import { inSeason, daysUntilSeason } from '../models/seasons.js';
import { quizLlmConfig } from '../models/quizGenerator.js';
import { generateDeckQuestions } from '../models/contentGenerator.js';

const router = asyncRouter();

router.use(requireAuth, requirePair);

router.get('/', async (req, res) => {
  const { rows } = await query('SELECT * FROM question_decks ORDER BY sort_order, title');

  // Anniversary decks are in season during the month the two of you started,
  // which is a different month per couple.
  const togetherSince = req.pair.together_since || null;
  const opts = { togetherSince };

  const grouped = {};
  const soon = [];
  for (const deck of rows) {
    const seasonal = Boolean(deck.season_start || deck.season_anchor);
    if (seasonal && !inSeason(deck, undefined, opts)) {
      const days = daysUntilSeason(deck, new Date(), opts);
      // Out of season, but NOT hidden outright when it is close. "Back in 12
      // days" is the difference between something people look forward to and
      // something they never learn exists.
      if (days !== null && days <= 30) soon.push({ ...deck, daysUntilSeason: days });
      continue;
    }
    const entry = { ...deck, seasonal, inSeason: true };
    if (!grouped[deck.category]) grouped[deck.category] = [];
    grouped[deck.category].push(entry);
  }

  soon.sort((a, b) => a.daysUntilSeason - b.daysUntilSeason);
  res.json({ decksByCategory: grouped, seasonalSoon: soon });
});

async function backfillDeck(deck) {
  let config = null;
  try { config = quizLlmConfig(); } catch { /* misconfigured: no backup */ }
  if (!config) return [];
  try {
    const written = await generateDeckQuestions({ title: deck.title, category: deck.category }, 12, [], { config });
    for (const [i, text] of written.entries()) {
      await query(
        `INSERT INTO deck_questions (deck_id, question_text, sort_order)
         SELECT $1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM deck_questions WHERE deck_id = $1 AND question_text = $2)`,
        [deck.id, text, i + 1]
      );
    }
  } catch (err) {
    console.error(`[decks] AI backup for "${deck.slug}" failed: ${err.message}`);
  }
  const { rows } = await query('SELECT * FROM deck_questions WHERE deck_id = $1 ORDER BY sort_order', [deck.id]);
  return rows;
}

router.get('/:slug/questions', async (req, res) => {
  const { rows: deckRows } = await query('SELECT * FROM question_decks WHERE slug = $1', [req.params.slug]);
  const deck = deckRows[0];
  if (!deck) return res.status(404).json({ error: 'Deck not found' });

  // An out-of-season deck opened by an old link or a stale list is not an
  // error — the questions are still there and there is no paywall here. It
  // just says so, and the client can decide whether to make a thing of it.
  const seasonal = Boolean(deck.season_start || deck.season_anchor);
  deck.seasonal = seasonal;
  deck.inSeason = !seasonal || inSeason(deck, undefined, { togetherSince: req.pair.together_since || null });

  let { rows: questions } = await query(
    'SELECT * FROM deck_questions WHERE deck_id = $1 ORDER BY sort_order',
    [deck.id]
  );
  // Every deck is seeded with questions. The AI connector is the backup for a
  // deck that still has none: it writes some on the first open, and they are
  // kept, so it is asked once per deck at most.
  if (!questions.length) questions = await backfillDeck(deck);
  const questionIds = questions.map((q) => q.id);

  const { rows: responses } = questionIds.length
    ? await query('SELECT * FROM deck_question_responses WHERE deck_question_id = ANY($1::uuid[]) AND pair_id = $2', [
        questionIds,
        req.pair.id,
      ])
    : { rows: [] };

  const payload = questions.map((q) => {
    const mine = responses.find((r) => r.deck_question_id === q.id && r.user_id === req.userId);
    const partner = responses.find((r) => r.deck_question_id === q.id && r.user_id === req.partnerId);
    const bothAnswered = Boolean(mine && partner);
    return {
      id: q.id,
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

export default router;
