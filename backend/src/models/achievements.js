import { query } from '../config/db.js';
import { earnSparks } from './sparks.js';
import { notifyUser } from './notify.js';

// Achievement definitions. `stat` names a counter from pairStats(); the
// achievement unlocks once that counter reaches `goal`.
export const ACHIEVEMENTS = [
  { key: 'first_answer', title: 'First Words', description: 'Both answer your first daily question', icon: 'chatbox-ellipses', stat: 'promptsTogether', goal: 1, sparks: 10 },
  { key: 'prompts_30', title: 'Deep Talkers', description: 'Answer 30 daily questions together', icon: 'chatbubbles', stat: 'promptsTogether', goal: 30, sparks: 50 },
  { key: 'streak_7', title: 'One Week Strong', description: 'Reach a 7-day streak', icon: 'flame', stat: 'bestStreak', goal: 7, sparks: 25 },
  { key: 'streak_30', title: 'Month of Us', description: 'Reach a 30-day streak', icon: 'flame', stat: 'bestStreak', goal: 30, sparks: 75 },
  { key: 'streak_100', title: 'Unstoppable', description: 'Reach a 100-day streak', icon: 'bonfire', stat: 'bestStreak', goal: 100, sparks: 200 },
  { key: 'memories_10', title: 'Scrapbookers', description: 'Save 10 memories', icon: 'images', stat: 'memories', goal: 10, sparks: 25 },
  { key: 'first_snap', title: 'Say Cheese', description: 'Send your first Daily Snap', icon: 'camera', stat: 'snaps', goal: 1, sparks: 10 },
  { key: 'bucket_5', title: 'Dream Chasers', description: 'Complete 5 bucket list items', icon: 'checkbox', stat: 'bucketDone', goal: 5, sparks: 40 },
  { key: 'first_date', title: 'It\'s a Date', description: 'Complete a scheduled date', icon: 'calendar', stat: 'datesDone', goal: 1, sparks: 20 },
  { key: 'date_match', title: 'Perfect Match', description: 'Both like the same date idea', icon: 'heart-circle', stat: 'dateMatches', goal: 1, sparks: 10 },
  { key: 'first_checkin', title: 'Checking In', description: 'Complete a monthly check-in together', icon: 'pulse', stat: 'checkinsTogether', goal: 1, sparks: 20 },
  { key: 'artists', title: 'Artists in Love', description: 'Save 5 drawings to the Canvas gallery', icon: 'color-palette', stat: 'drawings', goal: 5, sparks: 25 },
  { key: 'notes_10', title: 'Love Letters', description: 'Write 10 notes', icon: 'document-text', stat: 'notes', goal: 10, sparks: 20 },
  { key: 'chatterboxes', title: 'Chatterboxes', description: 'Send 100 messages', icon: 'chatbubble', stat: 'messages', goal: 100, sparks: 25 },
  { key: 'posters', title: 'Our Story', description: 'Share 10 posts on your feed', icon: 'newspaper', stat: 'posts', goal: 10, sparks: 20 },
  { key: 'challengers', title: 'Challenge Accepted', description: 'Complete 5 random challenges', icon: 'dice', stat: 'challenges', goal: 5, sparks: 30 },
  { key: 'grandmasters', title: 'Checkmate, Darling', description: 'Finish a game of chess', icon: 'trophy', stat: 'chessFinished', goal: 1, sparks: 15 },
  { key: 'secret_keeper', title: 'Secret Keeper', description: 'Send a secret message', icon: 'mail-unread', stat: 'secrets', goal: 1, sparks: 10 },
  { key: 'days_100', title: '100 Days', description: 'Be together on loversrock for 100 days', icon: 'sparkles', stat: 'daysTogether', goal: 100, sparks: 50 },
  { key: 'days_365', title: 'One Year', description: 'A whole year together', icon: 'diamond', stat: 'daysTogether', goal: 365, sparks: 150 },
];

export async function pairStats(pair) {
  const p = pair.id;
  const count = async (sql, params = [p]) => Number((await query(sql, params)).rows[0].n);

  const [
    promptsTogether, memories, snaps, bucketDone, datesDone, dateMatches, checkinsTogether,
    drawings, notes, messages, posts, challenges, chessFinished, secrets,
  ] = await Promise.all([
    count(`SELECT COUNT(*) AS n FROM (SELECT prompt_id FROM prompt_responses WHERE pair_id = $1 GROUP BY prompt_id HAVING COUNT(*) >= 2) t`),
    count(`SELECT COUNT(*) AS n FROM memories WHERE pair_id = $1 AND deleted_at IS NULL`),
    count(`SELECT COUNT(*) AS n FROM widget_photos WHERE pair_id = $1`),
    count(`SELECT COUNT(*) AS n FROM bucket_list_items WHERE pair_id = $1 AND is_completed`),
    count(`SELECT COUNT(*) AS n FROM date_plans WHERE pair_id = $1 AND status = 'done'`),
    count(`SELECT COUNT(*) AS n FROM (SELECT idea_id FROM date_idea_votes WHERE pair_id = $1 AND liked GROUP BY idea_id HAVING COUNT(*) >= 2) t`),
    count(`SELECT COUNT(*) AS n FROM (SELECT month FROM checkins WHERE pair_id = $1 GROUP BY month HAVING COUNT(*) >= 2) t`),
    count(`SELECT COUNT(*) AS n FROM canvas_drawings WHERE pair_id = $1`),
    count(`SELECT COUNT(*) AS n FROM notes WHERE pair_id = $1`),
    count(`SELECT COUNT(*) AS n FROM messages WHERE pair_id = $1`),
    count(`SELECT COUNT(*) AS n FROM feed_posts WHERE pair_id = $1 AND deleted_at IS NULL`),
    count(`SELECT COUNT(*) AS n FROM challenge_completions WHERE pair_id = $1`),
    count(`SELECT COUNT(*) AS n FROM chess_games WHERE pair_id = $1 AND status <> 'active'`),
    count(`SELECT COUNT(*) AS n FROM secret_messages WHERE pair_id = $1`),
  ]);

  const since = pair.together_since || pair.created_at;
  const daysTogether = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 86400000));
  // The best streak ever is at least the current one, and a lost streak that
  // was later restored has already been folded back into streak_count.
  const bestStreak = Math.max(pair.streak_count || 0, pair.lost_streak || 0);

  return {
    promptsTogether, memories, snaps, bucketDone, datesDone, dateMatches, checkinsTogether,
    drawings, notes, messages, posts, challenges, chessFinished, secrets, daysTogether, bestStreak,
  };
}

/**
 * Computes every achievement's progress, persists newly unlocked ones, and
 * pays their Sparks to both partners exactly once. Safe to call on any read.
 */
export async function evaluateAchievements(pair) {
  const stats = await pairStats(pair);
  const { rows: existing } = await query('SELECT key, unlocked_at FROM pair_achievements WHERE pair_id = $1', [pair.id]);
  const unlockedAt = Object.fromEntries(existing.map((r) => [r.key, r.unlocked_at]));
  const newlyUnlocked = [];

  for (const a of ACHIEVEMENTS) {
    if (unlockedAt[a.key] || (stats[a.stat] || 0) < a.goal) continue;
    const { rows } = await query(
      `INSERT INTO pair_achievements (pair_id, key) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING unlocked_at`,
      [pair.id, a.key]
    );
    if (!rows[0]) continue; // another request got there first
    unlockedAt[a.key] = rows[0].unlocked_at;
    newlyUnlocked.push(a);
    for (const userId of [pair.user_a_id, pair.user_b_id]) {
      await earnSparks({ pairId: pair.id, userId, amount: a.sparks, reason: 'achievement', ref: a.key });
      notifyUser(userId, 'achievements', { title: `Achievement unlocked: ${a.title} 🏆`, body: `${a.description} (+${a.sparks} Sparks)` });
    }
  }

  const achievements = ACHIEVEMENTS.map((a) => ({
    key: a.key,
    title: a.title,
    description: a.description,
    icon: a.icon,
    sparks: a.sparks,
    goal: a.goal,
    progress: Math.min(stats[a.stat] || 0, a.goal),
    unlocked: Boolean(unlockedAt[a.key]),
    unlockedAt: unlockedAt[a.key] || null,
  }));

  return { achievements, newlyUnlocked: newlyUnlocked.map((a) => a.key), stats };
}
