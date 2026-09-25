import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';

import { initSockets } from './sockets/index.js';
import { startCronJobs } from './cron/index.js';
import { ensureBucket, getObjectStream, statObject } from './config/storage.js';
import { requireAuthAllowingQuery } from './middleware/auth.js';
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
import callsRoutes from './routes/calls.js';
import locationRoutes from './routes/location.js';
import periodRoutes from './routes/period.js';
import widgetRoutes from './routes/widget.js';
import profileRoutes from './routes/profile.js';
import presenceRoutes from './routes/presence.js';

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
app.use('/calls', callsRoutes);
app.use('/location', locationRoutes);
app.use('/period', periodRoutes);
app.use('/widget', widgetRoutes);
app.use('/profile', profileRoutes);
// Moods, notes and reactions — see routes/presence.js for why they share one.
app.use('/presence', presenceRoutes);

/** image/jpeg for a .jpg, and so on. */
const EXTENSION_TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', bmp: 'image/bmp',
};

function contentTypeFor(key, meta) {
  const stored = meta?.metaData
    && Object.entries(meta.metaData)
      .find(([name]) => name.toLowerCase() === 'content-type')?.[1];
  if (stored && stored !== 'application/octet-stream') return stored;

  const extension = String(key).split('.').pop().toLowerCase();
  return EXTENSION_TYPES[extension] || stored || 'application/octet-stream';
}

// Auth-gated media streaming out of MinIO — mobile clients never get direct
// storage credentials or presigned URLs, everything proxies through here.
//
// The token may arrive in the query string here (see requireAuthAllowingQuery):
// the native image loaders cannot attach headers, so header-only auth meant
// every photo in the app came back 401 and rendered as nothing.
app.get(
  '/media/:key(*)',
  wrapAsync(requireAuthAllowingQuery),
  wrapAsync(async (req, res) => {
    try {
      // Without a Content-Type the iOS image loader refuses the bytes
      // outright and Android only guesses right by luck, so the stored
      // type is read back rather than left to the default.
      //
      // Belt and braces on the lookup: metaData comes back from the storage
      // backend, and the exact casing of its keys is the backend's business,
      // not ours. Every key we store ends in a real image extension, so that
      // is a reliable fallback and 'application/octet-stream' — which is what
      // makes an <Image> render nothing — is a last resort rather than the
      // default any hiccup lands on.
      const meta = await statObject(req.params.key).catch(() => null);
      res.setHeader('Content-Type', contentTypeFor(req.params.key, meta));
      if (meta?.size) res.setHeader('Content-Length', meta.size);
      // Immutable: every key is a fresh UUID, so a cached copy can never
      // go stale. This is what stops the thread re-downloading every photo
      // on each scroll.
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');

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
