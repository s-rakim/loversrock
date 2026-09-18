import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import { pairLocalDateString, getUserDeviceTokens } from '../models/pairs.js';
import { sendNotification } from '../config/firebase.js';

const router = asyncRouter();

router.use(requireAuth, requirePair);

async function attemptsFor(pairId, questionIds) {
  if (questionIds.length === 0) return [];
  const { rows } = await query(
    'SELECT * FROM quiz_attempts WHERE pair_id = $1 AND quiz_question_id = ANY($2::uuid[])',
    [pairId, questionIds]
  );
  return rows;
}

router.get('/today', async (req, res) => {
  const today = pairLocalDateString(req.pair);
  const { rows: questions } = await query(
    'SELECT * FROM quiz_questions WHERE scheduled_date = $1 ORDER BY question_order',
    [today]
  );
  if (questions.length === 0) return res.status(404).json({ error: 'No quiz scheduled for today' });

  const attempts = await attemptsFor(req.pair.id, questions.map((q) => q.id));

  const payload = questions.map((q) => {
    const mine = attempts.find((a) => a.quiz_question_id === q.id && a.user_id === req.userId);
    const partner = attempts.find((a) => a.quiz_question_id === q.id && a.user_id === req.partnerId);
    return {
      id: q.id,
      questionOrder: q.question_order,
      type: q.type,
      questionText: q.question_text,
      choices: q.choices,
      myAnswer: mine ? mine.answer : null,
      myCorrectnessState: mine ? mine.correctness_state : 'pending',
      isCorrect: mine ? mine.is_correct : null,
      partnerAnswered: Boolean(partner),
    };
  });

  res.json({ scheduledDate: today, questions: payload });
});

router.post('/:questionId/respond', async (req, res) => {
  const { answer } = req.body;
  if (!answer) return res.status(400).json({ error: 'answer is required' });

  const { rows: qRows } = await query('SELECT * FROM quiz_questions WHERE id = $1', [req.params.questionId]);
  const question = qRows[0];
  if (!question) return res.status(404).json({ error: 'Question not found' });

  if (question.type === 'trivia') {
    const isCorrect = answer.trim().toLowerCase() === (question.correct_answer || '').trim().toLowerCase();
    const { rows } = await query(
      `INSERT INTO quiz_attempts (pair_id, quiz_question_id, user_id, answer, correctness_state, is_correct)
       VALUES ($1, $2, $3, $4, 'computed', $5)
       ON CONFLICT (pair_id, quiz_question_id, user_id)
       DO UPDATE SET answer = EXCLUDED.answer, is_correct = EXCLUDED.is_correct, correctness_state = 'computed'
       RETURNING *`,
      [req.pair.id, question.id, req.userId, answer, isCorrect]
    );
    return res.json(toAttemptPayload(rows[0]));
  }

  if (question.type === 'this_or_that') {
    // No right answer — just a shared preference pick, always immediately computed.
    const { rows } = await query(
      `INSERT INTO quiz_attempts (pair_id, quiz_question_id, user_id, answer, correctness_state, is_correct)
       VALUES ($1, $2, $3, $4, 'computed', NULL)
       ON CONFLICT (pair_id, quiz_question_id, user_id)
       DO UPDATE SET answer = EXCLUDED.answer
       RETURNING *`,
      [req.pair.id, question.id, req.userId, answer]
    );
    return res.json(toAttemptPayload(rows[0]));
  }

  // guess_partner: waits until both partners have submitted for this
  // question_order, then compares the two answers to each other
  // case-insensitively and marks both correct/incorrect together.
  await query(
    `INSERT INTO quiz_attempts (pair_id, quiz_question_id, user_id, answer, correctness_state, is_correct)
     VALUES ($1, $2, $3, $4, 'waiting_for_partner', NULL)
     ON CONFLICT (pair_id, quiz_question_id, user_id)
     DO UPDATE SET answer = EXCLUDED.answer, correctness_state = 'waiting_for_partner', is_correct = NULL`,
    [req.pair.id, question.id, req.userId, answer]
  );

  const { rows: bothRows } = await query(
    'SELECT * FROM quiz_attempts WHERE pair_id = $1 AND quiz_question_id = $2',
    [req.pair.id, question.id]
  );

  if (bothRows.length === 2) {
    const [a, b] = bothRows;
    const isMatch = a.answer.trim().toLowerCase() === b.answer.trim().toLowerCase();
    await query(
      `UPDATE quiz_attempts SET correctness_state = 'computed', is_correct = $1 WHERE pair_id = $2 AND quiz_question_id = $3`,
      [isMatch, req.pair.id, question.id]
    );

    const tokens = [
      ...(await getUserDeviceTokens(req.userId)),
      ...(await getUserDeviceTokens(req.partnerId)),
    ];
    await sendNotification(tokens, {
      title: 'Quiz answer revealed 🔮',
      body: isMatch ? "You matched — you know each other!" : "You didn't match this time.",
    }).catch((err) => console.error('[quiz] reveal push failed:', err.message));

    const { rows: mine } = await query(
      'SELECT * FROM quiz_attempts WHERE pair_id = $1 AND quiz_question_id = $2 AND user_id = $3',
      [req.pair.id, question.id, req.userId]
    );
    return res.json(toAttemptPayload(mine[0]));
  }

  const { rows: mine } = await query(
    'SELECT * FROM quiz_attempts WHERE pair_id = $1 AND quiz_question_id = $2 AND user_id = $3',
    [req.pair.id, question.id, req.userId]
  );
  res.json(toAttemptPayload(mine[0]));
});

function toAttemptPayload(row) {
  return {
    questionId: row.quiz_question_id,
    answer: row.answer,
    correctnessState: row.correctness_state,
    isCorrect: row.is_correct,
  };
}

router.get('/archive', async (req, res) => {
  const month = req.query.month; // YYYY-MM
  if (!/^\d{4}-\d{2}$/.test(month || '')) {
    return res.status(400).json({ error: 'month must be formatted YYYY-MM' });
  }

  const { rows: questions } = await query(
    `SELECT id, scheduled_date FROM quiz_questions WHERE to_char(scheduled_date, 'YYYY-MM') = $1`,
    [month]
  );

  const questionIds = questions.map((q) => q.id);
  const attempts = await attemptsFor(req.pair.id, questionIds);

  const byDate = {};
  for (const q of questions) {
    const key = q.scheduled_date;
    if (!byDate[key]) byDate[key] = { total: 0, attempted: 0, scored: 0, correct: 0 };
    byDate[key].total += 1;
    const mine = attempts.find((a) => a.quiz_question_id === q.id && a.user_id === req.userId);
    if (mine) {
      byDate[key].attempted += 1;
      if (mine.is_correct !== null) {
        byDate[key].scored += 1;
        if (mine.is_correct) byDate[key].correct += 1;
      }
    }
  }

  const days = Object.entries(byDate).map(([date, d]) => ({
    date,
    completionFraction: d.total ? d.attempted / d.total : 0,
    score: d.scored ? d.correct / d.scored : null,
  }));

  res.json({ month, days });
});

export default router;
