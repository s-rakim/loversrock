import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { query } from "../config/db.js";
import { requireAuth, signAccessToken, signRefreshToken } from "../middleware/auth.js";

export const authRouter = Router();

// --- Signup ---
authRouter.post("/signup", async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: "name, email, and password are required" });
  }

  const existing = await query("SELECT id FROM users WHERE email = $1", [email]);
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: "An account with this email already exists" });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const { rows } = await query(
    `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3)
     RETURNING id, name, email, avatar_url, partner_id, created_at`,
    [name, email, passwordHash]
  );
  const user = rows[0];

  return res.status(201).json({
    user,
    accessToken: signAccessToken(user.id),
    refreshToken: signRefreshToken(user.id),
  });
});

// --- Login ---
authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await query("SELECT * FROM users WHERE email = $1", [email]);
  const user = rows[0];

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const { password_hash, ...safeUser } = user;
  return res.json({
    user: safeUser,
    accessToken: signAccessToken(user.id),
    refreshToken: signRefreshToken(user.id),
  });
});

// --- Refresh access token ---
authRouter.post("/refresh", async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: "refreshToken is required" });

  try {
    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    // Rotate: issue a brand new refresh token alongside the new access token.
    return res.json({
      accessToken: signAccessToken(payload.sub),
      refreshToken: signRefreshToken(payload.sub),
    });
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired refresh token" });
  }
});

// --- Register / refresh a push token for this device ---
authRouter.post("/fcm-token", requireAuth, async (req, res) => {
  const { fcmToken, platform } = req.body;
  if (!fcmToken || !platform) {
    return res.status(400).json({ error: "fcmToken and platform are required" });
  }
  await query(
    `INSERT INTO user_devices (user_id, fcm_token, platform, last_seen_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id, fcm_token)
     DO UPDATE SET last_seen_at = now(), platform = EXCLUDED.platform`,
    [req.userId, fcmToken, platform]
  );
  return res.status(204).send();
});

// --- Generate an invite code for pairing ---
authRouter.post("/invite", requireAuth, async (req, res) => {
  const { rows: userRows } = await query("SELECT partner_id FROM users WHERE id = $1", [req.userId]);
  if (userRows[0]?.partner_id) {
    return res.status(400).json({ error: "You already have a partner linked" });
  }

  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  const timezone = req.body.timezone || "UTC"; // client should send Intl.DateTimeFormat().resolvedOptions().timeZone

  const { rows } = await query(
    `INSERT INTO pairs (user_a_id, user_b_id, timezone, invite_code, invite_expires_at)
     VALUES ($1, $1, $2, $3, now() + interval '7 days')
     RETURNING id, invite_code, invite_expires_at`,
    [req.userId, timezone, code]
  );
  // Note: user_b_id is temporarily set to user_a_id as a placeholder until the
  // invite is accepted below, since the column is NOT NULL. Accepting the invite
  // overwrites it with the real partner.

  return res.status(201).json(rows[0]);
});

// --- Accept an invite code ---
authRouter.post("/invite/accept", requireAuth, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "code is required" });

  const { rows: userRows } = await query("SELECT partner_id FROM users WHERE id = $1", [req.userId]);
  if (userRows[0]?.partner_id) {
    return res.status(400).json({ error: "You already have a partner linked" });
  }

  const { rows: pairRows } = await query(
    `SELECT * FROM pairs
     WHERE invite_code = $1 AND unlinked_at IS NULL AND invite_expires_at > now()`,
    [code]
  );
  const pair = pairRows[0];
  if (!pair) return res.status(404).json({ error: "Invalid or expired invite code" });
  if (pair.user_a_id === req.userId) {
    return res.status(400).json({ error: "You can't accept your own invite code" });
  }

  await query("BEGIN");
  try {
    await query(`UPDATE pairs SET user_b_id = $1, invite_code = NULL WHERE id = $2`, [
      req.userId,
      pair.id,
    ]);
    await query(`UPDATE users SET partner_id = $1 WHERE id = $2`, [req.userId, pair.user_a_id]);
    await query(`UPDATE users SET partner_id = $1 WHERE id = $2`, [pair.user_a_id, req.userId]);
    await query("COMMIT");
  } catch (err) {
    await query("ROLLBACK");
    throw err;
  }

  return res.json({ pairId: pair.id, timezone: pair.timezone });
});

// --- Unlink partner ---
// Privacy rule (docs/SPEC.md pinned decision #3): this NEVER deletes pair data.
// It only clears the live partner_id link and stamps unlinked_at. Re-pairing later
// (with anyone) always creates a brand-new pairs row, so old history is never
// visible under a new pairing.
authRouter.post("/unlink", requireAuth, async (req, res) => {
  const { rows: userRows } = await query("SELECT partner_id FROM users WHERE id = $1", [req.userId]);
  const partnerId = userRows[0]?.partner_id;
  if (!partnerId) return res.status(400).json({ error: "You don't have a partner linked" });

  await query("BEGIN");
  try {
    await query(
      `UPDATE pairs SET unlinked_at = now()
       WHERE (user_a_id = $1 AND user_b_id = $2) OR (user_a_id = $2 AND user_b_id = $1)
       AND unlinked_at IS NULL`,
      [req.userId, partnerId]
    );
    await query(`UPDATE users SET partner_id = NULL WHERE id IN ($1, $2)`, [req.userId, partnerId]);
    await query("COMMIT");
  } catch (err) {
    await query("ROLLBACK");
    throw err;
  }

  return res.status(204).send();
});
