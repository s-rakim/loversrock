import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';

import { initSockets } from './sockets/index.js';
import { startCronJobs } from './cron/index.js';
import { ensureBucket, getObjectStream } from './config/storage.js';
import { requireAuth } from './middleware/auth.js';
import { wrapAsync } from './lib/asyncRouter.js';

import authRoutes from './routes/auth.js';
import dailyPromptRoutes from './routes/dailyPrompt.js';
import dailyQuizRoutes from './routes/dailyQuiz.js';
import memoriesRoutes from './routes/memories.js';
import bucketListRoutes from './routes/bucketList.js';
import dateIdeasRoutes from './routes/dateIdeas.js';
import countdownsRoutes from './routes/countdowns.js';
import messagesRoutes from './routes/messages.js';
import widgetPhotosRoutes from './routes/widgetPhotos.js';
import decksRoutes from './routes/decks.js';
import gamesRoutes from './routes/games.js';
import locationRoutes from './routes/location.js';
import periodRoutes from './routes/period.js';
import widgetRoutes from './routes/widget.js';
import profileRoutes from './routes/profile.js';
import sparksRoutes from './routes/sparks.js';
import achievementsRoutes from './routes/achievements.js';
import feedRoutes from './routes/feed.js';
import notesRoutes from './routes/notes.js';
import secretsRoutes from './routes/secrets.js';
import canvasRoutes from './routes/canvas.js';
import datesRoutes from './routes/dates.js';
import checkinsRoutes from './routes/checkins.js';
import challengesRoutes from './routes/challenges.js';
import gamesExtraRoutes from './routes/gamesExtra.js';
import nudgesRoutes from './routes/nudges.js';
import timelineRoutes from './routes/timeline.js';

const app = express();
const httpServer = createServer(app);

const corsOrigins = (process.env.CORS_ORIGINS || '').split(',').filter(Boolean);

app.use(cors({ origin: corsOrigins.length ? corsOrigins : true, credentials: true }));
app.use(express.json({ limit: '15mb' })); // base64 image uploads

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/auth', authRoutes);
app.use('/daily-prompt', dailyPromptRoutes);
app.use('/quiz', dailyQuizRoutes);
app.use('/memories', memoriesRoutes);
app.use('/bucket-list', bucketListRoutes);
app.use('/date-ideas', dateIdeasRoutes);
app.use('/countdowns', countdownsRoutes);
app.use('/messages', messagesRoutes);
app.use('/widget-photos', widgetPhotosRoutes);
app.use('/decks', decksRoutes);
app.use('/games', gamesRoutes);
app.use('/location', locationRoutes);
app.use('/period', periodRoutes);
app.use('/widget', widgetRoutes);
app.use('/profile', profileRoutes);
app.use('/sparks', sparksRoutes);
app.use('/achievements', achievementsRoutes);
app.use('/feed', feedRoutes);
app.use('/notes', notesRoutes);
app.use('/secrets', secretsRoutes);
app.use('/canvas', canvasRoutes);
app.use('/dates', datesRoutes);
app.use('/checkins', checkinsRoutes);
app.use('/challenges', challengesRoutes);
app.use('/games', gamesExtraRoutes); // /games/wml, /games/chess — GET /games itself stays in games.js
app.use('/nudges', nudgesRoutes);
app.use('/timeline', timelineRoutes);

// Auth-gated media streaming out of MinIO — mobile clients never get direct
// storage credentials or presigned URLs, everything proxies through here.
app.get(
  '/media/:key(*)',
  wrapAsync(requireAuth),
  wrapAsync(async (req, res) => {
    try {
      const stream = await getObjectStream(req.params.key);
      stream.on('error', () => res.status(404).end());
      stream.pipe(res);
    } catch (err) {
      res.status(404).json({ error: 'Not found' });
    }
  })
);

app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ error: status === 500 ? 'Internal server error' : err.message });
});

// Last-resort net. Handlers are already wrapped (src/lib/asyncRouter.js), but
// this is a server two people rely on being up — a stray rejection from a
// timer, socket callback, or cron tick must never take it down.
process.on('unhandledRejection', (reason) => {
  console.error('[server] unhandled rejection (kept alive):', reason);
});

const io = initSockets(httpServer, corsOrigins.length ? corsOrigins : true);
app.set('io', io);

const PORT = process.env.PORT || 4000;

ensureBucket()
  .catch((err) => console.error('[storage] failed to ensure bucket exists:', err.message))
  .finally(() => {
    httpServer.listen(PORT, () => {
      console.log(`[server] listening on :${PORT}`);
      startCronJobs();
    });
  });
