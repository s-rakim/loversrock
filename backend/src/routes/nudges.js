import { asyncRouter } from '../lib/asyncRouter.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import { notifyUser, userName } from '../models/notify.js';

const router = asyncRouter();

router.use(requireAuth, requirePair);

// One-tap "thinking of you" nudges — the Quick Kiss widget and the Thumb Kiss
// invite both land here.
const NUDGES = {
  thumbkiss: { category: 'thumbkiss', title: (n) => `${n} wants a Thumb Kiss 💋`, body: 'Open Thumb Kiss and put your thumb on the screen.', screen: 'ThumbKiss' },
  kiss: { category: 'thumbkiss', title: (n) => `${n} sent you a kiss 😘`, body: 'Send one back?', screen: 'Home' },
  miss_you: { category: 'mood', title: (n) => `${n} misses you 🥺`, body: 'Tap to say hi.', screen: 'Messages' },
  hug: { category: 'mood', title: (n) => `${n} sent you a hug 🤗`, body: 'Consider yourself squeezed.', screen: 'Home' },
};

router.post('/', async (req, res) => {
  const kind = req.body?.kind;
  const nudge = NUDGES[kind];
  if (!nudge) return res.status(400).json({ error: `kind must be one of ${Object.keys(NUDGES).join(', ')}` });
  const name = await userName(req.userId);
  req.app.get('io').to(`pair:${req.pair.id}`).emit('nudge', { kind, fromUserId: req.userId, name });
  await notifyUser(req.partnerId, nudge.category, { title: nudge.title(name), body: nudge.body }, { screen: nudge.screen });
  res.status(202).json({ sent: kind });
});

export default router;
