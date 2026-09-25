import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import { uploadBase64Image } from '../config/storage.js';
import { notifyUser, userName } from '../models/notify.js';
import { earnSparks, SPARK_REWARDS } from '../models/sparks.js';
import { pairLocalDateString } from '../models/pairs.js';

const router = asyncRouter();

router.use(requireAuth, requirePair);

// Lovers X-style joint feed: posts, likes, loves and comments, visible to
// exactly the two people in the pair.
async function hydrate(posts, userId) {
  if (posts.length === 0) return [];
  const ids = posts.map((p) => p.id);
  const [{ rows: reactions }, { rows: comments }] = await Promise.all([
    query('SELECT post_id, user_id, kind FROM feed_reactions WHERE post_id = ANY($1::uuid[])', [ids]),
    query(
      `SELECT c.id, c.post_id, c.author_id, c.body, c.created_at, u.name AS author_name
       FROM feed_comments c JOIN users u ON u.id = c.author_id
       WHERE c.post_id = ANY($1::uuid[]) ORDER BY c.created_at ASC`,
      [ids]
    ),
  ]);

  return posts.map((p) => {
    const mine = reactions.filter((r) => r.post_id === p.id);
    return {
      ...p,
      likes: mine.filter((r) => r.kind === 'like').length,
      loves: mine.filter((r) => r.kind === 'love').length,
      likedByMe: mine.some((r) => r.kind === 'like' && r.user_id === userId),
      lovedByMe: mine.some((r) => r.kind === 'love' && r.user_id === userId),
      comments: comments.filter((c) => c.post_id === p.id),
    };
  });
}

const POST_SELECT = `SELECT p.id, p.pair_id, p.author_id, p.body, p.image_url, p.created_at, u.name AS author_name, u.avatar_url AS author_avatar
  FROM feed_posts p JOIN users u ON u.id = p.author_id`;

router.get('/', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const params = [req.pair.id, limit];
  let before = '';
  if (req.query.before) {
    params.push(req.query.before);
    before = `AND p.created_at < $3`;
  }
  const { rows } = await query(
    `${POST_SELECT} WHERE p.pair_id = $1 AND p.deleted_at IS NULL ${before} ORDER BY p.created_at DESC LIMIT $2`,
    params
  );
  res.json({ posts: await hydrate(rows, req.userId) });
});

// A profile's posts (Lovers X partner profile view).
router.get('/by/:userId', async (req, res) => {
  if (![req.userId, req.partnerId].includes(req.params.userId)) return res.status(404).json({ error: 'Not found' });
  const { rows } = await query(
    `${POST_SELECT} WHERE p.pair_id = $1 AND p.author_id = $2 AND p.deleted_at IS NULL ORDER BY p.created_at DESC LIMIT 100`,
    [req.pair.id, req.params.userId]
  );
  res.json({ posts: await hydrate(rows, req.userId) });
});

router.post('/', async (req, res) => {
  const { body, image } = req.body || {};
  if (!body?.trim() && !image) return res.status(400).json({ error: 'A post needs text, a photo, or both' });

  const imageUrl = image ? await uploadBase64Image(image, { prefix: `feed/${req.pair.id}` }) : null;
  const { rows } = await query(
    `INSERT INTO feed_posts (pair_id, author_id, body, image_url) VALUES ($1, $2, $3, $4) RETURNING id`,
    [req.pair.id, req.userId, body?.trim() || null, imageUrl]
  );
  const { rows: full } = await query(`${POST_SELECT} WHERE p.id = $1`, [rows[0].id]);
  const [post] = await hydrate(full, req.userId);

  await earnSparks({
    pairId: req.pair.id, userId: req.userId, amount: SPARK_REWARDS.feed_post, reason: 'feed_post', ref: pairLocalDateString(req.pair),
  });
  req.app.get('io').to(`pair:${req.pair.id}`).emit('feed:new', { post });
  notifyUser(req.partnerId, 'feed', {
    title: `${post.author_name} shared a new ${imageUrl ? 'moment 📸' : 'post'}`,
    body: post.body || 'Tap to see it.',
  }, { screen: 'Feed', postId: post.id });
  res.status(201).json({ post });
});

router.delete('/:id', async (req, res) => {
  const { rowCount } = await query(
    'UPDATE feed_posts SET deleted_at = now() WHERE id = $1 AND pair_id = $2 AND author_id = $3 AND deleted_at IS NULL',
    [req.params.id, req.pair.id, req.userId]
  );
  if (rowCount === 0) return res.status(404).json({ error: 'Post not found (you can only delete your own)' });
  req.app.get('io').to(`pair:${req.pair.id}`).emit('feed:deleted', { postId: req.params.id });
  res.status(204).end();
});

async function loadPost(req, res) {
  const { rows } = await query('SELECT * FROM feed_posts WHERE id = $1 AND pair_id = $2 AND deleted_at IS NULL', [
    req.params.id, req.pair.id,
  ]);
  if (!rows[0]) res.status(404).json({ error: 'Post not found' });
  return rows[0];
}

// Toggles a like or a love. Returns the post's new counts.
router.post('/:id/react', async (req, res) => {
  const { kind } = req.body || {};
  if (!['like', 'love'].includes(kind)) return res.status(400).json({ error: "kind must be 'like' or 'love'" });
  const post = await loadPost(req, res);
  if (!post) return;

  const { rowCount } = await query('DELETE FROM feed_reactions WHERE post_id = $1 AND user_id = $2 AND kind = $3', [
    post.id, req.userId, kind,
  ]);
  const added = rowCount === 0;
  if (added) {
    await query('INSERT INTO feed_reactions (post_id, user_id, kind) VALUES ($1, $2, $3)', [post.id, req.userId, kind]);
    if (post.author_id !== req.userId) {
      const name = await userName(req.userId);
      notifyUser(post.author_id, 'feed', {
        title: kind === 'love' ? `${name} loved your post 💗` : `${name} liked your post 👍`,
        body: post.body || 'Your moment got some love.',
      }, { screen: 'Feed', postId: post.id });
    }
  }

  const { rows: full } = await query(`${POST_SELECT} WHERE p.id = $1`, [post.id]);
  const [hydrated] = await hydrate(full, req.userId);
  req.app.get('io').to(`pair:${req.pair.id}`).emit('feed:updated', { postId: post.id });
  res.json({ added, post: hydrated });
});

router.post('/:id/comments', async (req, res) => {
  const body = req.body?.body?.trim();
  if (!body) return res.status(400).json({ error: 'body is required' });
  const post = await loadPost(req, res);
  if (!post) return;

  const { rows } = await query(
    `INSERT INTO feed_comments (post_id, author_id, body) VALUES ($1, $2, $3) RETURNING *`,
    [post.id, req.userId, body]
  );
  const name = await userName(req.userId);
  const comment = { ...rows[0], author_name: name };
  req.app.get('io').to(`pair:${req.pair.id}`).emit('feed:updated', { postId: post.id });
  if (post.author_id !== req.userId) {
    notifyUser(post.author_id, 'feed', { title: `${name} commented 💬`, body }, { screen: 'Feed', postId: post.id });
  }
  res.status(201).json({ comment });
});

router.delete('/:id/comments/:commentId', async (req, res) => {
  const { rowCount } = await query(
    `DELETE FROM feed_comments c USING feed_posts p
     WHERE c.id = $1 AND c.post_id = p.id AND p.pair_id = $2 AND c.author_id = $3`,
    [req.params.commentId, req.pair.id, req.userId]
  );
  if (rowCount === 0) return res.status(404).json({ error: 'Comment not found' });
  res.status(204).end();
});

export default router;
