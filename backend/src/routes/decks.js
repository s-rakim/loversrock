import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';

const router = asyncRouter();

router.use(requireAuth, requirePair);

router.get('/', async (req, res) => {
  const { rows } = await query('SELECT * FROM question_decks ORDER BY sort_order, title');
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
