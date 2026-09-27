import crypto from 'crypto';
import { asyncRouter } from '../lib/asyncRouter.js';
import { query } from '../config/db.js';
import { requireAuth, requirePair } from '../middleware/auth.js';
import { putBuffer, statObject, getObjectStream, getPartialObjectStream, deleteObject } from '../config/storage.js';
import { sendToTokens, sendNotification, deepLink, CHANNELS } from '../config/firebase.js';
import { senderName } from './messages.js';
import {
  transcribeConfig, translateConfig, transcribe, translate, voiceAiStatus, TRANSLATE_LANGUAGES,
} from '../models/voiceAi.js';
import { applyVoiceFilter, VOICE_FILTERS } from '../models/voiceFilters.js';

/**
 * Voice notes.
 *
 * Held on the mic in the middle of the nav bar; played OUT LOUD on the other
 * phone the moment it lands, whether the app is open or not.
 *
 * "Whether the app is open or not" decides the shape of all of this. A socket
 * reaches a phone only while the app is running, so the push is the real
 * delivery path: a data-only, high-priority FCM message that wakes a small
 * native service on Android (mobile/native/android/voice/), which fetches the
 * audio and plays it. That service has no access token — it runs before
 * anybody opens the app, and the token lives in the JS side's secure store —
 * so the audio URL carries its own proof instead: a signature over the note,
 * the listener and an expiry. It opens exactly one recording, for exactly one
 * person, for a week, and nothing else.
 */

const router = asyncRouter();

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_DURATION_MS = 5 * 60 * 1000;
const LINK_TTL_SECONDS = 7 * 24 * 60 * 60;

// What a phone's recorder produces, and the extension stored with it. Android
// and iOS both record AAC in an MPEG-4 container, which arrives under three
// different names depending on who is asked.
const AUDIO_TYPES = {
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
  'audio/3gpp': '3gp',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
};

function signature(voiceId, userId, expires) {
  return crypto
    .createHmac('sha256', process.env.JWT_ACCESS_SECRET)
    .update(`voice:${voiceId}:${userId}:${expires}`)
    .digest('base64url');
}

/** The path, relative to the API, that plays one note for one listener. */
export function signedAudioPath(voiceId, userId, now = Date.now()) {
  const expires = Math.floor(now / 1000) + LINK_TTL_SECONDS;
  const sig = signature(voiceId, userId, expires);
  return `/voice/${voiceId}/audio?u=${userId}&e=${expires}&s=${sig}`;
}

export function verifyAudioSignature(voiceId, userId, expires, sig, now = Date.now()) {
  if (!voiceId || !userId || !expires || !sig) return false;
  if (Number(expires) < Math.floor(now / 1000)) return false;
  const expected = Buffer.from(signature(voiceId, userId, expires));
  const given = Buffer.from(String(sig));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/**
 * The base URL the partner's phone can reach this server at.
 *
 * The native service prefers the address the app itself saved, and only falls
 * back to this. The sender's own request is the best guess the server has: the
 * two phones are pointed at the same server, usually by the same address.
 */
function baseUrlOf(req) {
  const proto = req.get('x-forwarded-proto') || req.protocol;
  return `${proto}://${req.get('host')}`;
}

function publicRow(row, viewerId) {
  return {
    id: row.id,
    sender_id: row.sender_id,
    duration_ms: row.duration_ms,
    mime_type: row.mime_type,
    listened_at: row.listened_at,
    created_at: row.created_at,
    filter: row.filter || null,
    transcript: row.transcript || null,
    transcript_status: row.transcript_status || 'off',
    translations: row.translations || {},
    mine: row.sender_id === viewerId,
    path: signedAudioPath(row.id, viewerId),
  };
}

// ------------------------------------------------------------------ audio
//
// Before the auth middleware on purpose: this is the one route the signature
// authorises instead of a bearer token. Everything below it needs both.
router.get('/:id/audio', async (req, res) => {
  const { u: userId, e: expires, s: sig } = req.query;
  if (!verifyAudioSignature(req.params.id, userId, expires, sig)) {
    return res.status(403).json({ error: 'This voice note link is not valid or has expired' });
  }

  // The link names a listener; they must still be in the pair it was sent
  // to. Someone who has since unpaired does not keep a key to the recordings.
  const { rows } = await query(
    `SELECT v.* FROM voice_messages v
       JOIN pairs p ON p.id = v.pair_id
      WHERE v.id = $1 AND p.unlinked_at IS NULL AND ($2 IN (p.user_a_id, p.user_b_id))`,
    [req.params.id, userId]
  );
  const voice = rows[0];
  if (!voice) return res.status(404).json({ error: 'Voice note not found' });

  if (voice.sender_id !== userId && !voice.listened_at) {
    const { rows: heard } = await query(
      `UPDATE voice_messages SET listened_at = now()
        WHERE id = $1 AND listened_at IS NULL RETURNING listened_at`,
      [voice.id]
    );
    if (heard[0]) {
      req.app.get('io')?.to(`pair:${voice.pair_id}`)
        .emit('voice:listened', { id: voice.id, listened_at: heard[0].listened_at });
    }
  }

  const meta = await statObject(voice.audio_key).catch(() => null);
  if (!meta) return res.status(404).json({ error: 'Voice note audio is missing' });
  const size = meta.size;

  res.setHeader('Content-Type', voice.mime_type);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=604800, immutable');

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  let stream;
  if (range && (range[1] || range[2])) {
    let start;
    let end;
    if (range[1]) {
      start = Number(range[1]);
      end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    } else {
      // "bytes=-500": the last 500 bytes.
      start = Math.max(size - Number(range[2]), 0);
      end = size - 1;
    }
    if (start >= size || start > end) {
      res.setHeader('Content-Range', `bytes */${size}`);
      return res.status(416).end();
    }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', end - start + 1);
    stream = await getPartialObjectStream(voice.audio_key, start, end - start + 1);
  } else {
    res.setHeader('Content-Length', size);
    stream = await getObjectStream(voice.audio_key);
  }
  stream.on('error', () => res.destroy());
  stream.pipe(res);
});

router.use(requireAuth, requirePair);

/**
 * What the AI connector can do right now, the voice effects on offer, and
 * the caller's own translation choice — everything the app needs to decide
 * which buttons to show.
 */
router.get('/ai', async (req, res) => {
  const { rows } = await query('SELECT voice_translate_to FROM users WHERE id = $1', [req.userId]);
  res.json({
    ...voiceAiStatus(),
    languages: TRANSLATE_LANGUAGES,
    filters: Object.fromEntries(Object.entries(VOICE_FILTERS).map(([id, f]) => [id, f.label])),
    translateTo: rows[0]?.voice_translate_to || null,
  });
});

/** The language the caller wants notes translated into, or null for none. */
router.put('/settings', async (req, res) => {
  const { translateTo } = req.body || {};
  if (translateTo != null && !TRANSLATE_LANGUAGES[translateTo]) {
    return res.status(400).json({ error: 'translateTo must be one of the offered languages, or null' });
  }
  await query('UPDATE users SET voice_translate_to = $2 WHERE id = $1', [req.userId, translateTo || null]);
  res.json({ translateTo: translateTo || null });
});

/** The pair's notes, newest first, each with a playable link for the caller. */
router.get('/', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 300);
  const { rows } = await query(
    `SELECT * FROM voice_messages WHERE pair_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [req.pair.id, limit]
  );
  res.json({ voiceMessages: rows.map((row) => publicRow(row, req.userId)) });
});

router.post('/', async (req, res) => {
  const { audio, mimeType, durationMs } = req.body || {};
  if (!audio || typeof audio !== 'string') {
    return res.status(400).json({ error: 'audio (base64) is required' });
  }

  // Either bare base64 or a data URL; the data URL's type wins if both say.
  const match = /^data:([\w/+.-]+);base64,(.+)$/s.exec(audio);
  const type = String((match ? match[1] : mimeType) || 'audio/mp4').toLowerCase();
  const ext = AUDIO_TYPES[type];
  if (!ext) return res.status(400).json({ error: `Unsupported audio type: ${type}` });

  const buffer = Buffer.from(match ? match[2] : audio, 'base64');
  if (buffer.length < 64) return res.status(400).json({ error: 'That recording is empty' });
  if (buffer.length > MAX_BYTES) return res.status(413).json({ error: 'That recording is too long to send' });

  const duration = Math.round(Number(durationMs) || 0);
  if (duration < 0 || duration > MAX_DURATION_MS) {
    return res.status(400).json({ error: 'durationMs must be between 0 and 5 minutes' });
  }

  // A voice effect, if one was asked for and ffmpeg is here to apply it.
  // If it cannot be, the note goes as recorded rather than not at all.
  const wanted = req.body.filter && VOICE_FILTERS[req.body.filter] ? req.body.filter : null;
  if (req.body.filter && !wanted) return res.status(400).json({ error: `Unknown voice effect: ${req.body.filter}` });
  let stored = buffer;
  let storedType = type;
  let storedExt = ext;
  let filter = null;
  if (wanted) {
    const filtered = await applyVoiceFilter(buffer, wanted);
    if (filtered) {
      stored = filtered;
      storedType = 'audio/mp4';
      storedExt = 'm4a';
      filter = wanted;
    }
  }

  let transcriptStatus = 'off';
  try {
    if (transcribeConfig()) transcriptStatus = 'pending';
  } catch (err) {
    console.error('[voice] transcription is misconfigured:', err.message);
  }

  const key = `voice/${req.pair.id}/${crypto.randomUUID()}.${storedExt}`;
  await putBuffer(key, stored, storedType);

  const { rows } = await query(
    `INSERT INTO voice_messages (pair_id, sender_id, audio_key, mime_type, duration_ms, size_bytes, filter, transcript_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [req.pair.id, req.userId, key, storedType, duration, stored.length, filter, transcriptStatus]
  );
  const voice = rows[0];

  const partnerPath = signedAudioPath(voice.id, req.partnerId);
  const from = await senderName(req.pair.id, req.userId, req.partnerId);

  // Android and iOS are sent different messages, because only one of them
  // can do the job.
  //
  // Android gets DATA ONLY. A message with a `notification` block is drawn by
  // the system while the app is in the background and never reaches app code
  // at all — which would mean a banner, not a voice. Data-only is what wakes
  // the native service so it can play.
  //
  // iOS will not let an app that is not running play sound on its own, full
  // stop. So an iPhone gets an ordinary notification, and plays it on tap.
  const { rows: devices } = await query(
    'SELECT fcm_token, platform FROM user_devices WHERE user_id = $1',
    [req.partnerId]
  );
  const android = devices.filter((d) => d.platform !== 'ios').map((d) => d.fcm_token);
  const ios = devices.filter((d) => d.platform === 'ios').map((d) => d.fcm_token);

  let pushed = false;
  const results = await Promise.allSettled([
    sendToTokens(android, {
      data: {
        type: 'voice',
        voiceId: voice.id,
        path: partnerPath,
        url: `${baseUrlOf(req)}${partnerPath}`,
        from,
        durationMs: String(duration),
        sentAt: new Date(voice.created_at).toISOString(),
      },
      priority: 'high',
    }),
    sendNotification(
      ios,
      { title: from, body: 'Sent you a voice message' },
      deepLink('voice', { voiceId: voice.id }),
      { channel: CHANNELS.partner, priority: 'high' }
    ),
  ]);
  for (const result of results) {
    if (result.status === 'fulfilled') pushed = pushed || (result.value?.successCount || 0) > 0;
    else console.error('[voice] push failed:', result.reason?.message);
  }

  // The socket too, for a phone with the app open — and because a push can
  // fail (no Firebase set up yet), `pushed` tells the open app whether it has
  // to play the note itself.
  req.app.get('io')?.to(`pair:${req.pair.id}`).emit('voice:new', {
    voice: publicRow(voice, req.userId),
    recipientId: req.partnerId,
    recipientPath: partnerPath,
    from,
    pushed,
  });

  res.status(201).json({ voice: publicRow(voice, req.userId), pushed, filterApplied: filter === wanted });

  // After the reply, not before it: a transcript takes a few seconds and the
  // note itself should not wait on it. The original recording is transcribed
  // even when an effect was applied — a chipmunk is harder to transcribe.
  if (transcriptStatus === 'pending') {
    processTranscript({
      voice, audio: buffer, mimeType: type, io: req.app.get('io'),
      recipientId: req.partnerId, from, partnerPath, baseUrl: baseUrlOf(req),
    }).catch((err) => console.error('[voice] transcript job failed:', err.message));
  }
});

/**
 * Transcribes a note, translates it if the listener asked for that, and
 * tells both phones. The listener's Android phone also gets a data push, so
 * a note that arrived silently (on silent, or auto-play off) can show its
 * words in the notification — the point of a transcript is the moment you
 * cannot listen.
 */
async function processTranscript({ voice, audio, mimeType, io, recipientId, from, partnerPath, baseUrl }) {
  let transcript = null;
  let status = 'failed';
  const translations = {};
  try {
    transcript = await transcribe(audio, mimeType);
    status = 'done';

    const { rows } = await query('SELECT voice_translate_to FROM users WHERE id = $1', [recipientId]);
    const language = rows[0]?.voice_translate_to;
    let canTranslate = false;
    try {
      canTranslate = Boolean(translateConfig());
    } catch (err) {
      console.error('[voice] translation is misconfigured:', err.message);
    }
    if (language && transcript && canTranslate) {
      try {
        translations[language] = await translate(transcript, language);
      } catch (err) {
        console.error('[voice] translation failed:', err.message);
      }
    }
  } catch (err) {
    console.error('[voice] transcription failed:', err.message);
  }

  const { rows } = await query(
    `UPDATE voice_messages
        SET transcript = $2, transcript_status = $3, translations = translations || $4::jsonb
      WHERE id = $1 RETURNING *`,
    [voice.id, transcript, status, JSON.stringify(translations)]
  );
  if (!rows[0]) return; // Unsent in the meantime.

  io?.to(`pair:${voice.pair_id}`).emit('voice:transcript', {
    id: voice.id,
    transcript: rows[0].transcript,
    transcript_status: rows[0].transcript_status,
    translations: rows[0].translations,
  });

  const text = Object.values(translations)[0] || transcript;
  if (!text) return;
  const { rows: devices } = await query(
    `SELECT fcm_token FROM user_devices WHERE user_id = $1 AND platform <> 'ios'`,
    [recipientId]
  );
  await sendToTokens(devices.map((d) => d.fcm_token), {
    data: {
      type: 'voice_text', voiceId: voice.id, text: text.slice(0, 1000), from,
      path: partnerPath, url: `${baseUrl}${partnerPath}`,
    },
    priority: 'high',
  }).catch((err) => console.error('[voice] transcript push failed:', err.message));
}

/** Transcribe again — for a note whose transcript failed, or one sent before keys were set. */
router.post('/:id/transcribe', async (req, res) => {
  const { rows } = await query('SELECT * FROM voice_messages WHERE id = $1 AND pair_id = $2', [req.params.id, req.pair.id]);
  const voice = rows[0];
  if (!voice) return res.status(404).json({ error: 'Voice note not found' });

  let config;
  try {
    config = transcribeConfig();
  } catch (err) {
    return res.status(503).json({ error: err.message });
  }
  if (!config) return res.status(503).json({ error: 'Transcription is not set up on the server' });

  const stream = await getObjectStream(voice.audio_key);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  try {
    const transcript = await transcribe(Buffer.concat(chunks), voice.mime_type, config);
    const { rows: updated } = await query(
      `UPDATE voice_messages SET transcript = $2, transcript_status = 'done' WHERE id = $1 RETURNING *`,
      [voice.id, transcript]
    );
    req.app.get('io')?.to(`pair:${voice.pair_id}`).emit('voice:transcript', {
      id: voice.id, transcript, transcript_status: 'done', translations: updated[0].translations,
    });
    res.json({ voice: publicRow(updated[0], req.userId) });
  } catch (err) {
    await query(`UPDATE voice_messages SET transcript_status = 'failed' WHERE id = $1`, [voice.id]);
    res.status(502).json({ error: err.message });
  }
});

/** The transcript in another language — from the cache if it has been asked for before. */
router.post('/:id/translate', async (req, res) => {
  const language = req.body?.language;
  if (!TRANSLATE_LANGUAGES[language]) return res.status(400).json({ error: 'language must be one of the offered languages' });

  const { rows } = await query('SELECT * FROM voice_messages WHERE id = $1 AND pair_id = $2', [req.params.id, req.pair.id]);
  const voice = rows[0];
  if (!voice) return res.status(404).json({ error: 'Voice note not found' });
  if (voice.translations?.[language]) {
    return res.json({ language, translation: voice.translations[language], cached: true });
  }
  if (!voice.transcript) {
    return res.status(409).json({ error: 'This voice note has no transcript to translate yet' });
  }

  let config;
  try {
    config = translateConfig();
  } catch (err) {
    return res.status(503).json({ error: err.message });
  }
  if (!config) return res.status(503).json({ error: 'Translation is not set up on the server' });

  try {
    const translation = await translate(voice.transcript, language, config);
    await query(
      `UPDATE voice_messages SET translations = translations || jsonb_build_object($2::text, $3::text) WHERE id = $1`,
      [voice.id, language, translation]
    );
    res.json({ language, translation, cached: false });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

/** Unsend. Only the person who recorded it, and the audio goes too. */
router.delete('/:id', async (req, res) => {
  const { rows } = await query(
    `DELETE FROM voice_messages WHERE id = $1 AND pair_id = $2 AND sender_id = $3 RETURNING *`,
    [req.params.id, req.pair.id, req.userId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Voice note not found' });
  await deleteObject(rows[0].audio_key).catch(() => {});
  req.app.get('io')?.to(`pair:${req.pair.id}`).emit('voice:deleted', { id: rows[0].id });
  res.status(204).end();
});

export default router;
