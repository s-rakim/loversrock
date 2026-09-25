import { query, withTransaction } from '../config/db.js';

// Sparks are the in-app relationship currency. The ledger is append-only and
// a balance is always SUM(amount) — there is no mutable balance column that
// could drift out of sync with the history.
export const SPARK_REWARDS = {
  welcome: 25,
  prompt_answer: 5,
  prompt_both: 5,
  daily_snap: 3,
  checkin: 20,
  challenge: 10,
  feed_post: 1,
};

export const SPARK_PRICES = {
  streak_freeze: 40,
  streak_restore: 60,
  game_hint: 5,
  premium_dates: 50,
};

export const MAX_STREAK_FREEZES = 3;

export async function sparkBalance(userId, client = { query }) {
  const { rows } = await client.query('SELECT COALESCE(SUM(amount), 0)::int AS balance FROM spark_ledger WHERE user_id = $1', [
    userId,
  ]);
  return rows[0].balance;
}

/**
 * Credits Sparks. With a `ref`, the award is one-shot per (user, reason, ref)
 * — retries and double taps never double-pay. Returns true if it was new.
 */
export async function earnSparks({ pairId, userId, amount, reason, ref = null }) {
  if (!amount || amount <= 0) return false;
  const { rowCount } = await query(
    `INSERT INTO spark_ledger (pair_id, user_id, amount, reason, ref) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, reason, ref) WHERE ref IS NOT NULL AND amount > 0 DO NOTHING`,
    [pairId, userId, amount, reason, ref]
  );
  return rowCount > 0;
}

/**
 * Debits Sparks inside a transaction, serialised per user with an advisory
 * lock so two concurrent spends can't both pass the balance check. `apply`
 * runs in the same transaction, so the purchase and the debit commit together.
 */
export async function spendSparks({ pairId, userId, amount, reason, ref = null }, apply) {
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [userId]);
    const balance = await sparkBalance(userId, client);
    if (balance < amount) {
      const err = new Error(`Not enough Sparks (have ${balance}, need ${amount})`);
      err.status = 402;
      throw err;
    }
    await client.query(
      'INSERT INTO spark_ledger (pair_id, user_id, amount, reason, ref) VALUES ($1, $2, $3, $4, $5)',
      [pairId, userId, -amount, reason, ref]
    );
    const result = apply ? await apply(client) : null;
    return { balance: balance - amount, result };
  });
}
