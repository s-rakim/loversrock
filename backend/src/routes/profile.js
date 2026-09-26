import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import { MASCOT_ARTS, resolveMascotArt } from '../models/mascotArt.js';
import { getActivePairForUser, otherUserId } from '../models/pairs.js';

const router = asyncRouter();

// Long enough for "my ridiculous little bear", short enough that it still fits
// a widget line and a chat header.
const MAX_NICKNAME_LENGTH = 30;
const THEME_PREFERENCES = ['system', 'light', 'dark'];

/**
 * Which side of the cycle tracker somebody is on.
 *
 *   owner    tracks their own cycle, edits all of it
 *   partner  sees what the owner chose to share, and only that
 *
 * The two are not symmetric and must not be treated as a display toggle: the
 * partner view is a privacy boundary, not a skin.
 */
const CYCLE_ROLES = ['owner', 'partner'];

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
function present(user, nickname, mascotArt = null) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    avatarUrl: user.avatar_url,
    nickname: nickname || null,
    // Resolved server-side so no screen has to re-implement the fallback.
    displayName: nickname || user.name,
    themePreference: user.theme_preference || 'system',
    // Which side of the cycle tracker they are on: 'owner', 'partner', or
    // null when they have not chosen yet. Null is what makes the app ask
    // rather than assume, so it is passed through as-is.
    cycleRole: user.cycle_role || null,
    // Which mascot picture is this person, 'a' or 'b' — always resolved,
    // never null, so the two phones cannot both claim the same picture.
    // mascotArtChosen says whether it was picked or inferred.
    mascotArt,
    mascotArtChosen: MASCOT_ARTS.includes(user.mascot_art),
    // Null for the partner by construction — see the query in GET /.
    chatWallpaper: user.chat_wallpaper || null,
    // The public half of their encryption key. Public by design: it is what
    // the other phone encrypts to, and it opens nothing on its own.
    publicKey: user.public_key || null,
    publicKeySetAt: user.public_key_set_at || null,
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

  // chat_wallpaper is selected only for the caller. This query loads both
  // people, and a wallpaper is a private reading preference with no reason
  // to appear in the other direction - so the column is nulled out for
  // anyone who is not the person asking.
  const { rows: users } = await query(
    `SELECT id, name, avatar_url, theme_preference, public_key, public_key_set_at,
            cycle_role, mascot_art,
            CASE WHEN id = $2 THEN chat_wallpaper ELSE NULL END AS chat_wallpaper
     FROM users WHERE id = ANY($1::uuid[])`,
    [partnerId ? [req.userId, partnerId] : [req.userId], req.userId]
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

  // Days together, computed here so both phones agree rather than each
  // doing its own date arithmetic in its own timezone.
  const togetherSince = pair?.together_since || null;
  const daysTogether = togetherSince
    ? Math.max(0, Math.floor((Date.now() - new Date(togetherSince).getTime()) / 86400000))
    : null;

  const meRow = byId.get(req.userId);
  const partnerRow = partnerId ? byId.get(partnerId) : null;
  const art = resolveMascotArt(
    { art: meRow?.mascot_art, cycleRole: meRow?.cycle_role },
    partnerRow ? { art: partnerRow.mascot_art, cycleRole: partnerRow.cycle_role } : null,
    pair ? pair.user_a_id === req.userId : true
  );

  res.json({
    paired: Boolean(pair),
    me: present(meRow, nicknameTheyGaveMe, art.mine),
    partner: present(partnerRow, nicknameIGaveThem, partnerRow ? art.theirs : null),
    togetherSince,
    daysTogether,
    streak: pair?.streak_count ?? 0,
  });
});

/**
 * Publishes this device's PUBLIC encryption key.
 *
 * Only ever your own row: the user id comes from the bearer token, never the
 * body, so nobody can publish a key on someone else's behalf and read their
 * mail. The server stores it and hands it to the partner; it has no use for
 * it itself and no way to derive anything from it.
 *
 * Replacing a key is allowed — a reinstall generates a new one — and it
 * changes the safety number, which is exactly the signal the other person
 * should see.
 */
router.put('/keys', requireAuth, async (req, res) => {
  const publicKey = String(req.body?.publicKey || '').trim();

  // A Curve25519 public key is 32 bytes, which is 44 base64 characters.
  // Refusing anything else keeps junk out of a column the other phone will
  // try to encrypt to, where a bad value means a message that cannot be sent.
  if (!/^[A-Za-z0-9+/]{43}=$/.test(publicKey)) {
    return res.status(400).json({ error: 'publicKey must be a base64 32-byte key' });
  }

  const { rows } = await query(
    `UPDATE users SET public_key = $1, public_key_set_at = now()
      WHERE id = $2 RETURNING public_key, public_key_set_at`,
    [publicKey, req.userId]
  );
  res.json({ publicKey: rows[0].public_key, publicKeySetAt: rows[0].public_key_set_at });
});

/**
 * When the two of you started.
 *
 * On the pair rather than either person, because it is not a fact about a
 * user — and it is what "days together" and the anniversary countdown both
 * read, neither of which is a screen anybody opens on purpose.
 */
router.put('/together-since', requireAuth, requirePair, async (req, res) => {
  const value = req.body?.togetherSince;

  if (value === null) {
    const { rows } = await query(
      'UPDATE pairs SET together_since = NULL WHERE id = $1 RETURNING together_since',
      [req.pair.id]
    );
    return res.json({ togetherSince: rows[0].together_since });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    return res.status(400).json({ error: 'togetherSince must be YYYY-MM-DD or null' });
  }
  // A start date in the future would make "days together" negative, which is
  // not a state a relationship can be in.
  if (new Date(value) > new Date()) {
    return res.status(400).json({ error: 'togetherSince cannot be in the future' });
  }

  const { rows } = await query(
    'UPDATE pairs SET together_since = $1 WHERE id = $2 RETURNING together_since',
    [value, req.pair.id]
  );
  res.json({ togetherSince: rows[0].together_since });
});

/**
 * Device-level preferences mirrored onto the account. Deliberately takes no
 * `userId` — a client can only ever write its own row.
 */
router.patch('/preferences', requireAuth, async (req, res) => {
  const { themePreference, chatWallpaper, cycleRole, mascotArt } = req.body || {};

  if (mascotArt !== undefined) {
    // null hands the choice back to the inference in models/mascotArt.js.
    if (mascotArt !== null && !MASCOT_ARTS.includes(mascotArt)) {
      return res.status(400).json({ error: `mascotArt must be one of ${MASCOT_ARTS.join(', ')}, or null` });
    }
    await query('UPDATE users SET mascot_art = $1 WHERE id = $2', [mascotArt, req.userId]);
    // There are two pictures and two of you, so saying which one is you says
    // which one is them. A partner who had claimed the same picture is reset
    // to follow, rather than left disagreeing phone to phone.
    if (mascotArt !== null) {
      const pair = await getActivePairForUser(req.userId);
      if (pair) {
        await query('UPDATE users SET mascot_art = NULL WHERE id = $1 AND mascot_art = $2',
          [otherUserId(pair, req.userId), mascotArt]);
      }
    }
  }

  if (cycleRole !== undefined) {
    // null is a legitimate value: it clears the choice and makes the app ask
    // again, which is what "switch mode" needs before it knows the answer.
    if (cycleRole !== null && !CYCLE_ROLES.includes(cycleRole)) {
      return res.status(400).json({ error: `cycleRole must be one of ${CYCLE_ROLES.join(', ')}, or null` });
    }
    await query('UPDATE users SET cycle_role = $1 WHERE id = $2', [cycleRole, req.userId]);
  }

  if (themePreference !== undefined) {
    if (!THEME_PREFERENCES.includes(themePreference)) {
      return res.status(400).json({ error: `themePreference must be one of ${THEME_PREFERENCES.join(', ')}` });
    }
    await query('UPDATE users SET theme_preference = $1 WHERE id = $2', [themePreference, req.userId]);
  }

  if (chatWallpaper !== undefined) {
    const problem = validateWallpaper(chatWallpaper);
    if (problem) return res.status(400).json({ error: problem });
    await query('UPDATE users SET chat_wallpaper = $1 WHERE id = $2', [chatWallpaper, req.userId]);
  }

  const { rows } = await query(
    'SELECT theme_preference, chat_wallpaper FROM users WHERE id = $1',
    [req.userId]
  );
  res.json({ themePreference: rows[0].theme_preference, chatWallpaper: rows[0].chat_wallpaper });
});

/**
 * A wallpaper is either a built-in id or 'photo:<storage key>'.
 *
 * The photo form is checked rather than trusted: the key is bounded, and it
 * must look like a storage key rather than a URL or a path, so this cannot
 * become a way to point the app at an arbitrary address. Whether the key
 * belongs to this pair is enforced where it is read - the image is served
 * through the same /media route as every other picture, which already scopes
 * by pair.
 */
function validateWallpaper(value) {
  if (value === null || value === '') return null;   // clearing it
  if (typeof value !== 'string') return 'chatWallpaper must be a string or null';
  if (value.length > 300) return 'chatWallpaper is too long';

  if (value.startsWith('photo:')) {
    const key = value.slice(6);
    if (!key) return 'chatWallpaper photo needs a key';
    if (/^https?:|^\/\/|\.\./i.test(key)) return 'chatWallpaper photo must be a stored key, not a URL';
    return null;
  }

  if (!/^[a-z0-9_-]{1,40}$/.test(value)) {
    return 'chatWallpaper must be a built-in id or photo:<key>';
  }
  return null;
}

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
