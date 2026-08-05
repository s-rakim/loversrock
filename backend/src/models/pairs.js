import { query } from "../config/db.js";

// Returns the user's currently active pair (unlinked_at IS NULL), or null.
// This is the one place "which pair am I in right now" logic should live —
// route files should always go through this rather than querying pairs directly,
// so the unlink/re-pair privacy rule (docs/SPEC.md pinned decision #3) stays enforced
// in exactly one spot.
export async function getActivePairForUser(userId) {
  const { rows } = await query(
    `SELECT p.*
     FROM pairs p
     JOIN users u ON u.partner_id IS NOT NULL
     WHERE (p.user_a_id = $1 OR p.user_b_id = $1)
       AND p.unlinked_at IS NULL
       AND u.id = $1
     LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

export async function getPartnerUserId(userId) {
  const { rows } = await query(`SELECT partner_id FROM users WHERE id = $1`, [userId]);
  return rows[0]?.partner_id || null;
}
