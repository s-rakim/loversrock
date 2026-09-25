import { asyncRouter } from '../lib/asyncRouter.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import { evaluateAchievements } from '../models/achievements.js';

const router = asyncRouter();

router.use(requireAuth, requirePair);

router.get('/', async (req, res) => {
  const { achievements, newlyUnlocked, stats } = await evaluateAchievements(req.pair);
  res.json({
    achievements,
    newlyUnlocked,
    stats,
    unlockedCount: achievements.filter((a) => a.unlocked).length,
    total: achievements.length,
  });
});

export default router;
