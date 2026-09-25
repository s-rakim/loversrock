// The joint feed: everything the two of you have done, in order.
//
// DERIVED, not materialised, and that is the design decision worth stating.
// The obvious alternative is a feed_items table that every feature writes to.
// It paginates beautifully and it is wrong here: every future feature has to
// remember to write its row, a missed write is an invisible hole in your
// history, an edit or a delete needs a matching update, and getting any of it
// wrong is discovered months later when somebody notices a day is missing.
//
// A UNION over the sources cannot drift and needs no backfill. For two people
// with a few thousand rows between them it is not a performance problem, and
// if it ever becomes one that is a change to this one query rather than to
// nine features.
import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import { BY_SLUG } from '../models/achievements.js';

const router = asyncRouter();
router.use(requireAuth, requirePair);

const PAGE = 30;

/**
 * Every source, as one shape.
 *
 * Each branch produces (kind, id, at, actor_id, title, body, image, meta).
 * Keeping the shape identical here rather than in JS means one ORDER BY over
 * the lot, which is the only way keyset pagination can work across sources.
 */
const FEED_SQL = `
  WITH items AS (
    SELECT 'memory' AS kind, m.id, m.taken_at AS at, m.created_by AS actor_id,
           NULL::text AS title, m.caption AS body, m.image_url AS image, NULL::jsonb AS meta
      FROM memories m WHERE m.pair_id = $1 AND m.deleted_at IS NULL

    UNION ALL
    SELECT 'locket', w.id, w.created_at, w.sender_id,
           NULL, w.caption, w.image_url, NULL
      FROM widget_photos w WHERE w.pair_id = $1

    UNION ALL
    -- A prompt is a feed item only once BOTH answered. One answer is not an
    -- event that happened to the two of you; it is half of one.
    SELECT 'prompt', dp.id, max(pr.created_at), NULL,
           dp.content, NULL, NULL,
           jsonb_build_object('category', dp.category,
                              'answers', jsonb_agg(jsonb_build_object('userId', pr.user_id, 'text', pr.answer_text)
                                                   ORDER BY pr.created_at))
      FROM prompt_responses pr
      JOIN daily_prompts dp ON dp.id = pr.prompt_id
     WHERE pr.pair_id = $1
     GROUP BY dp.id
    HAVING count(DISTINCT pr.user_id) = 2

    UNION ALL
    SELECT 'quiz', qd.id, qd.revealed_at, NULL,
           NULL, NULL, NULL,
           jsonb_build_object('date', qd.scheduled_date,
                              'correct', (SELECT count(*)::int FROM quiz_attempts qa
                                           JOIN quiz_questions qq ON qq.id = qa.quiz_question_id
                                          WHERE qa.pair_id = qd.pair_id
                                            AND qq.scheduled_date = qd.scheduled_date
                                            AND qa.is_correct = TRUE),
                              'total', (SELECT count(*)::int FROM quiz_attempts qa
                                         JOIN quiz_questions qq ON qq.id = qa.quiz_question_id
                                        WHERE qa.pair_id = qd.pair_id
                                          AND qq.scheduled_date = qd.scheduled_date))
      FROM quiz_days qd WHERE qd.pair_id = $1

    UNION ALL
    SELECT 'drawing', cd.id, cd.updated_at, cd.updated_by,
           cd.title, NULL, NULL,
           jsonb_build_object('canvasColor', cd.canvas_color,
                              'strokeCount', jsonb_array_length(cd.stroke_data -> 'strokes'))
      FROM canvas_drawings cd WHERE cd.pair_id = $1

    UNION ALL
    SELECT 'date', di.id, di.scheduled_for, NULL,
           di.title, di.description, NULL,
           jsonb_build_object('status', di.status, 'category', di.category)
      FROM date_ideas di
     WHERE di.pair_id = $1 AND di.scheduled_for IS NOT NULL

    UNION ALL
    SELECT 'bucket', b.id, b.completed_at, NULL,
           b.title, NULL, NULL, NULL
      FROM bucket_list_items b
     WHERE b.pair_id = $1 AND b.is_completed = TRUE AND b.completed_at IS NOT NULL

    UNION ALL
    SELECT 'challenge', pc.id, pc.closed_at, pc.drawn_by,
           c.title, c.detail, NULL,
           jsonb_build_object('scope', c.scope)
      FROM pair_challenges pc JOIN challenges c ON c.id = pc.challenge_id
     WHERE pc.pair_id = $1 AND pc.status = 'done' AND pc.closed_at IS NOT NULL

    UNION ALL
    SELECT 'checkin', ck.id, max(cc.completed_at), NULL,
           NULL, NULL, NULL, jsonb_build_object('month', ck.month)
      FROM checkins ck JOIN checkin_completions cc ON cc.checkin_id = ck.id
     WHERE ck.pair_id = $1
     GROUP BY ck.id
    HAVING count(*) = 2

    UNION ALL
    SELECT 'milestone', pa.id, pa.earned_at, NULL,
           pa.slug, NULL, NULL, NULL
      FROM pair_achievements pa WHERE pa.pair_id = $1
  )
  SELECT * FROM items
   WHERE at IS NOT NULL
     -- Keyset, not OFFSET. Two people adding things while you scroll would
     -- shift an offset window and you would see the same item twice, or miss
     -- one entirely. (at, id) is unique enough to be a stable cursor.
     AND ($2::timestamptz IS NULL OR (at, id) < ($2::timestamptz, $3::uuid))
   ORDER BY at DESC, id DESC
   LIMIT $4
`;

router.get('/', async (req, res) => {
  const { cursorAt, cursorId } = req.query;
  const limit = Math.min(60, Math.max(5, Number(req.query.limit) || PAGE));

  const { rows } = await query(FEED_SQL, [
    req.pair.id,
    cursorAt || null,
    cursorId || null,
    limit + 1,   // one extra, purely to know whether there is another page
  ]);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  // Comments and reactions in two more queries rather than 2N. A feed that
  // does a round trip per item is the classic way to make thirty rows take
  // four seconds.
  const keys = page.map((r) => `${r.kind}:${r.id}`);
  const [{ rows: comments }, { rows: reactions }] = keys.length
    ? await Promise.all([
      query(
        `SELECT * FROM feed_comments
          WHERE pair_id = $1 AND (item_kind || ':' || item_id) = ANY($2::text[])
          ORDER BY created_at`,
        [req.pair.id, keys]
      ),
      query(
        `SELECT user_id, target_kind, target_id, emoji FROM reactions
          WHERE pair_id = $1 AND (target_kind || ':' || target_id) = ANY($2::text[])`,
        [req.pair.id, keys]
      ),
    ])
    : [{ rows: [] }, { rows: [] }];

  const commentsFor = new Map();
  for (const c of comments) {
    const key = `${c.item_kind}:${c.item_id}`;
    if (!commentsFor.has(key)) commentsFor.set(key, []);
    commentsFor.get(key).push({ id: c.id, authorId: c.author_id, body: c.body, createdAt: c.created_at });
  }
  const reactionsFor = new Map();
  for (const r of reactions) {
    const key = `${r.target_kind}:${r.target_id}`;
    if (!reactionsFor.has(key)) reactionsFor.set(key, []);
    reactionsFor.get(key).push({ userId: r.user_id, emoji: r.emoji });
  }

  const last = page[page.length - 1];

  res.json({
    items: page.map((r) => {
      const key = `${r.kind}:${r.id}`;
      return {
        kind: r.kind,
        id: r.id,
        at: r.at,
        actorId: r.actor_id,
        // Badge slugs are stored, not their titles — so the wording can be
        // improved without rewriting history.
        title: r.kind === 'milestone' ? (BY_SLUG[r.title]?.title || r.title) : r.title,
        body: r.kind === 'milestone' ? (BY_SLUG[r.title]?.blurb || null) : r.body,
        image: r.image,
        meta: r.meta,
        comments: commentsFor.get(key) || [],
        reactions: reactionsFor.get(key) || [],
      };
    }),
    nextCursor: hasMore && last ? { at: last.at, id: last.id } : null,
  });
});

router.post('/:kind/:id/comments', async (req, res) => {
  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
  if (!body) return res.status(400).json({ error: 'body is required' });

  const { rows } = await query(
    `INSERT INTO feed_comments (pair_id, author_id, item_kind, item_id, body)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [req.pair.id, req.userId, req.params.kind, req.params.id, body.slice(0, 1000)]
  );

  req.app.get('io')?.to(`pair:${req.pair.id}`)
    .emit('feed:comment', { kind: req.params.kind, id: req.params.id, comment: rows[0] });

  res.status(201).json({
    comment: { id: rows[0].id, authorId: rows[0].author_id, body: rows[0].body, createdAt: rows[0].created_at },
  });
});

router.delete('/comments/:id', async (req, res) => {
  const { rowCount } = await query(
    // Your own comments only. Deleting each other's words is not a feature
    // any two-person app needs and is a bad thing to have during an argument.
    'DELETE FROM feed_comments WHERE id = $1 AND pair_id = $2 AND author_id = $3',
    [req.params.id, req.pair.id, req.userId]
  );
  if (rowCount === 0) return res.status(404).json({ error: 'Comment not found' });
  res.status(204).end();
});

export default router;
