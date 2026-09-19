import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';

const router = asyncRouter();

// Long enough for "my ridiculous little bear", short enough that it still fits
// a widget line and a chat header.
const MAX_NICKNAME_LENGTH = 30;

/**
 * Nicknames are free text typed by one partner and rendered to the other, so
 * they get trimmed and bounded here rather than trusted. Control characters
 * are rejected outright: a newline inside a nickname breaks every single-line
 * layout that shows it.
 */
function validateNickname(raw) {
  if (typeof raw !== 'string') return { error: 'nickname must be a string' };

  const nickname = raw.trim();
  if (!nickname) return { error: 'nickname cannot be empty — use DELETE to clear it' };

  // Counted in code points, so an emoji costs one character rather than two.
  if ([...nickname].length > MAX_NICKNAME_LENGTH) {
    return { error: `nickname cannot be longer than ${MAX_NICKNAME_LENGTH} characters` };
  }
  if (/[\u0000-\u001F\u007F]/.test(nickname)) {
    return { error: 'nickname cannot contain line breaks or control characters' };
  }

  return { nickname };
}

/** The name to render for someone: their nickname if one was given, else their real name. */
function present(user, nickname) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    avatarUrl: user.avatar_url,
    nickname: nickname || null,
    // Resolved server-side so no screen has to re-implement the fallback.
    displayName: nickname || user.name,
  };
}

/**
 * Who the two of you are, by whatever names you call each other.
 *
 * Deliberately works unpaired too — the login/pairing flow needs to render
 * your own name before a partner exists — so it takes requireAuth but not
 * requirePair, and reports `paired: false` with a null partner instead of 403.
 */
router.get('/', requireAuth, async (req, res) => {
  const { rows: pairRows } = await query(
    `SELECT * FROM pairs
     WHERE (user_a_id = $1 OR user_b_id = $1) AND unlinked_at IS NULL AND user_b_id IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
    [req.userId]
  );

  const pair = pairRows[0] || null;
  const partnerId = pair ? (pair.user_a_id === req.userId ? pair.user_b_id : pair.user_a_id) : null;

  const { rows: users } = await query(
    'SELECT id, name, avatar_url FROM users WHERE id = ANY($1::uuid[])',
    [partnerId ? [req.userId, partnerId] : [req.userId]]
  );
  const byId = new Map(users.map((u) => [u.id, u]));

  // One row per direction. Mine names my partner; theirs names me.
  let nicknameIGaveThem = null;
  let nicknameTheyGaveMe = null;

  if (pair) {
    const { rows: nicknames } = await query(
      'SELECT set_by_id, nickname FROM pair_nicknames WHERE pair_id = $1',
      [pair.id]
    );
    for (const row of nicknames) {
      if (row.set_by_id === req.userId) nicknameIGaveThem = row.nickname;
      else nicknameTheyGaveMe = row.nickname;
    }
  }

  res.json({
    paired: Boolean(pair),
    me: present(byId.get(req.userId), nicknameTheyGaveMe),
    partner: present(partnerId ? byId.get(partnerId) : null, nicknameIGaveThem),
  });
});

/** Sets what *I* call my partner. Only ever writes my own row. */
router.put('/nickname', requireAuth, requirePair, async (req, res) => {
  const { nickname, error } = validateNickname(req.body?.nickname);
  if (error) return res.status(400).json({ error });

  const { rows } = await query(
    `INSERT INTO pair_nicknames (pair_id, set_by_id, nickname)
     VALUES ($1, $2, $3)
     ON CONFLICT (pair_id, set_by_id)
     DO UPDATE SET nickname = EXCLUDED.nickname, updated_at = now()
     RETURNING nickname, updated_at`,
    [req.pair.id, req.userId, nickname]
  );

  // So the other phone re-renders without waiting for a refresh.
  req.app.get('io').to(`pair:${req.pair.id}`).emit('nickname:update', {
    setByUserId: req.userId,
    nickname: rows[0].nickname,
  });

  res.json({ nickname: rows[0].nickname, updatedAt: rows[0].updated_at });
});

/** Clears the nickname I gave — falls back to their real name. */
router.delete('/nickname', requireAuth, requirePair, async (req, res) => {
  await query('DELETE FROM pair_nicknames WHERE pair_id = $1 AND set_by_id = $2', [
    req.pair.id,
    req.userId,
  ]);

  req.app.get('io').to(`pair:${req.pair.id}`).emit('nickname:update', {
    setByUserId: req.userId,
    nickname: null,
  });

  res.status(204).end();
});

export default router;
