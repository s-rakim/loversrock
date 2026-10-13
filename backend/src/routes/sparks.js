import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import {
  SPARK_PRICES, SPARK_REWARDS, MAX_STREAK_FREEZES, earnSparks, spendSparks, sparkBalance,
} from '../models/sparks.js';
import { notifyUser, userName } from '../models/notify.js';

const router = asyncRouter();

router.use(requireAuth, requirePair);

const RESTORE_WINDOW_DAYS = 3;

// Balance, recent history, and the price list — the Sparks screen in one call.
// First visit after pairing pays a one-time welcome bonus so there's
// something to spend straight away.
router.get('/', async (req, res) => {
  await earnSparks({ pairId: req.pair.id, userId: req.userId, amount: SPARK_REWARDS.welcome, reason: 'welcome', ref: req.pair.id });

  const { rows: history } = await query(
    'SELECT id, amount, reason, ref, created_at FROM spark_ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
    [req.userId]
  );
  const { rows: unlocks } = await query('SELECT item_key, created_at FROM pair_unlocks WHERE pair_id = $1', [req.pair.id]);

  res.json({
    balance: await sparkBalance(req.userId),
    history,
    prices: SPARK_PRICES,
    rewards: SPARK_REWARDS,
    streakFreezes: req.pair.streak_freezes,
    maxStreakFreezes: MAX_STREAK_FREEZES,
    lostStreak: req.pair.lost_streak,
    lostStreakOn: req.pair.lost_streak_on,
    unlocks: unlocks.map((u) => u.item_key),
  });
});

// Send Sparks to your partner.
router.post('/gift', async (req, res) => {
  const amount = Number(req.body?.amount);
  const note = req.body?.note ? String(req.body.note).slice(0, 140) : null;
  if (!Number.isInteger(amount) || amount <= 0 || amount > 1000) {
    return res.status(400).json({ error: 'amount must be a whole number between 1 and 1000' });
  }

  const { balance } = await spendSparks(
    { pairId: req.pair.id, userId: req.userId, amount, reason: 'gift_sent', ref: note },
    (client) =>
      client.query('INSERT INTO spark_ledger (pair_id, user_id, amount, reason, ref) VALUES ($1, $2, $3, $4, $5)', [
        req.pair.id, req.partnerId, amount, 'gift_received', note,
      ])
  );

  const name = await userName(req.userId);
  req.app.get('io').to(`pair:${req.pair.id}`).emit('sparks:gift', { fromUserId: req.userId, amount, note });
  notifyUser(req.partnerId, 'sparks', { title: `${name} sent you ${amount} Sparks ✨`, body: note || 'Spend them on something fun together.' });
  res.json({ balance });
});

// Streak protection: a banked freeze covers one missed day automatically.
router.post('/streak-freeze', async (req, res) => {
  if (req.pair.streak_freezes >= MAX_STREAK_FREEZES) {
    return res.status(409).json({ error: `You can bank at most ${MAX_STREAK_FREEZES} streak freezes` });
  }
  const { balance, result } = await spendSparks(
    { pairId: req.pair.id, userId: req.userId, amount: SPARK_PRICES.streak_freeze, reason: 'streak_freeze' },
    (client) => client.query('UPDATE pairs SET streak_freezes = streak_freezes + 1 WHERE id = $1 RETURNING streak_freezes', [req.pair.id])
  );
  res.json({ balance, streakFreezes: result.rows[0].streak_freezes });
});

// Streak restore: shortly after a streak breaks, buy it back. The days since
// the break are added on top, so the restored streak is continuous.
router.post('/streak-restore', async (req, res) => {
  const { lost_streak: lost, lost_streak_on: lostOn } = req.pair;
  if (!lost || !lostOn) return res.status(409).json({ error: 'There is no broken streak to restore' });
  const ageDays = Math.floor((Date.now() - new Date(`${lostOn}T00:00:00Z`).getTime()) / 86400000);
  if (ageDays > RESTORE_WINDOW_DAYS) {
    return res.status(410).json({ error: `Streaks can only be restored within ${RESTORE_WINDOW_DAYS} days` });
  }

  const { balance, result } = await spendSparks(
    { pairId: req.pair.id, userId: req.userId, amount: SPARK_PRICES.streak_restore, reason: 'streak_restore', ref: lostOn },
    (client) =>
      client.query(
        `UPDATE pairs SET streak_count = streak_count + lost_streak, lost_streak = NULL, lost_streak_on = NULL
         WHERE id = $1 RETURNING streak_count`,
        [req.pair.id]
      )
  );
  res.json({ balance, streakCount: result.rows[0].streak_count });
});

// Generic unlocks: decks with a spark_cost, and the premium date-idea pack.
router.post('/unlock', async (req, res) => {
  const { item } = req.body || {};
  let price;
  if (item === 'dates:premium') {
    price = SPARK_PRICES.premium_dates;
  } else if (typeof item === 'string' && item.startsWith('deck:')) {
    const { rows } = await query('SELECT spark_cost FROM question_decks WHERE slug = $1', [item.slice(5)]);
    if (!rows[0]) return res.status(404).json({ error: 'Deck not found' });
    if (!rows[0].spark_cost) return res.status(400).json({ error: 'That deck is free' });
    price = rows[0].spark_cost;
  } else {
    return res.status(400).json({ error: "item must be 'dates:premium' or 'deck:<slug>'" });
  }

  const { rows: already } = await query('SELECT 1 FROM pair_unlocks WHERE pair_id = $1 AND item_key = $2', [req.pair.id, item]);
  if (already[0]) return res.status(409).json({ error: 'Already unlocked' });

  const { balance } = await spendSparks(
    { pairId: req.pair.id, userId: req.userId, amount: price, reason: 'unlock', ref: item },
    (client) =>
      client.query('INSERT INTO pair_unlocks (pair_id, item_key, unlocked_by) VALUES ($1, $2, $3)', [req.pair.id, item, req.userId])
  );
  req.app.get('io').to(`pair:${req.pair.id}`).emit('sparks:unlock', { item });
  res.json({ balance, unlocked: item });
});

// Game hints cost a few Sparks; the client reveals the hint on success.
router.post('/hint', async (req, res) => {
  const game = String(req.body?.game || 'game');
  const { balance } = await spendSparks({
    pairId: req.pair.id, userId: req.userId, amount: SPARK_PRICES.game_hint, reason: 'game_hint', ref: game,
  });
  res.json({ balance });
});

export default router;
