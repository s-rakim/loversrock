import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';

import { initSockets } from './sockets/index.js';
import { startCronJobs } from './cron/index.js';
import { ensureBucket, getObjectStream } from './config/storage.js';
import { requireAuth } from './middleware/auth.js';

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

// Auth-gated media streaming out of MinIO — mobile clients never get direct
// storage credentials or presigned URLs, everything proxies through here.
app.get('/media/:key(*)', requireAuth, async (req, res) => {
  try {
    const stream = await getObjectStream(req.params.key);
    stream.on('error', () => res.status(404).end());
    stream.pipe(res);
  } catch (err) {
    res.status(404).json({ error: 'Not found' });
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
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
