package com.loversrock.app.voice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Plays one voice note, out loud, with or without the app.
 *
 * A foreground service, because that is the only thing Android lets run long
 * enough to download a few seconds of audio and play it once the push that
 * woke it has been handled. Starting one from the background is normally
 * forbidden; a high-priority FCM message is one of the exemptions, and it is
 * the reason the server sends these as high priority.
 *
 * The note is downloaded to a file first rather than streamed. A phone's
 * recorder writes the .m4a index at the END of the file, so streaming means a
 * seek before the first sound, and on a bad connection a file that is either
 * all there or not is easier to reason about than one that stops halfway.
 */
class VoicePlaybackService : Service() {

    companion object {
        const val ACTION_PLAY = "com.loversrock.app.voice.PLAY"
        const val ACTION_STOP = "com.loversrock.app.voice.STOP"
        const val EXTRA_ID = "voiceId"
        const val EXTRA_URL = "url"
        const val EXTRA_FROM = "from"

        // Two channels. Arriving is worth a sound (it only posts when the note
        // could NOT play out loud); playing is not, because the note IS the sound.
        private const val CHANNEL_ARRIVED = "voice_notes"
        private const val CHANNEL_PLAYING = "voice_playing"
        private const val PLAYING_NOTIFICATION_ID = 7301

        fun ensureChannels(context: Context) {
            if (Build.VERSION.SDK_INT < 26) return
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (manager.getNotificationChannel(CHANNEL_ARRIVED) == null) {
                manager.createNotificationChannel(
                    NotificationChannel(CHANNEL_ARRIVED, "Voice messages", NotificationManager.IMPORTANCE_HIGH).apply {
                        description = "A voice message that could not play out loud when it arrived"
                    }
                )
            }
            if (manager.getNotificationChannel(CHANNEL_PLAYING) == null) {
                manager.createNotificationChannel(
                    NotificationChannel(CHANNEL_PLAYING, "Voice message playing", NotificationManager.IMPORTANCE_LOW).apply {
                        description = "Shown while a voice message plays, with a Stop button"
                        setSound(null, null)
                    }
                )
            }
        }

        fun playIntent(context: Context, voiceId: String, url: String, from: String): Intent =
            Intent(context, VoicePlaybackService::class.java)
                .setAction(ACTION_PLAY)
                .putExtra(EXTRA_ID, voiceId)
                .putExtra(EXTRA_URL, url)
                .putExtra(EXTRA_FROM, from)

        /** Starts playback. Throws if Android refuses a foreground service here. */
        fun start(context: Context, voiceId: String, url: String, from: String) {
            val intent = playIntent(context, voiceId, url, from)
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent)
            else context.startService(intent)
        }

        private fun notificationIdFor(voiceId: String) = 7400 + (voiceId.hashCode() and 0x3ff)

        private fun builder(context: Context, channel: String): Notification.Builder =
            if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, channel)
            else @Suppress("DEPRECATION") Notification.Builder(context)

        private fun immutable() =
            if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0

        private fun openAppIntent(context: Context): PendingIntent? {
            val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            return PendingIntent.getActivity(
                context, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or immutable()
            )
        }

        private fun playAction(context: Context, voiceId: String, url: String, from: String, label: String): Notification.Action {
            val intent = playIntent(context, voiceId, url, from)
            val pending = if (Build.VERSION.SDK_INT >= 26) {
                PendingIntent.getForegroundService(
                    context, notificationIdFor(voiceId), intent, PendingIntent.FLAG_UPDATE_CURRENT or immutable()
                )
            } else {
                PendingIntent.getService(
                    context, notificationIdFor(voiceId), intent, PendingIntent.FLAG_UPDATE_CURRENT or immutable()
                )
            }
            @Suppress("DEPRECATION")
            return Notification.Action.Builder(android.R.drawable.ic_media_play, label, pending).build()
        }

        /**
         * The note, waiting. Posted whenever it could not play by itself — the
         * phone was on silent, auto-play is off, the download failed — so a
         * voice note is never simply lost.
         */
        fun notifyWaiting(context: Context, voiceId: String, url: String, from: String, why: String?) {
            ensureChannels(context)
            val text = if (why.isNullOrBlank()) "Sent you a voice message" else "Sent you a voice message · $why"
            val notification = builder(context, CHANNEL_ARRIVED)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle(from)
                .setContentText(text)
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_MESSAGE)
                .setContentIntent(openAppIntent(context))
                .addAction(playAction(context, voiceId, url, from, "Play"))
                .build()
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.notify(notificationIdFor(voiceId), notification)
        }

        /**
         * The note's words, once the server has them. Replaces whatever
         * notification the note has, quietly, keeping its Play button — for
         * the moments a note could not be played out loud, reading it is the
         * whole point. While the note is still playing, the ongoing
         * notification stays as it is and the words land when it finishes.
         */
        fun showText(context: Context, voiceId: String, url: String, from: String, text: String) {
            texts[voiceId] = text
            if (playingId == voiceId) return
            postText(context, voiceId, url, from, text)
        }

        private fun postText(context: Context, voiceId: String, url: String, from: String, text: String) {
            ensureChannels(context)
            val notification = builder(context, CHANNEL_PLAYING)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle(from)
                .setContentText(text)
                .setStyle(Notification.BigTextStyle().bigText(text))
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setCategory(Notification.CATEGORY_MESSAGE)
                .setContentIntent(openAppIntent(context))
                .addAction(playAction(context, voiceId, url, from, "Play"))
                .build()
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.notify(notificationIdFor(voiceId), notification)
        }

        // Transcripts that arrived while their note was playing, and which
        // note that is. The service is a single instance in one process, so a
        // companion map is enough; losing it to a process death only loses
        // the words in a notification, never the note.
        private val texts = java.util.concurrent.ConcurrentHashMap<String, String>()
        @Volatile private var playingId: String? = null

        /** After it played: still there to hear again, without a sound of its own. */
        private fun notifyPlayed(context: Context, voiceId: String, url: String, from: String) {
            texts.remove(voiceId)?.let { text ->
                postText(context, voiceId, url, from, text)
                return
            }
            val notification = builder(context, CHANNEL_PLAYING)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle(from)
                .setContentText("Voice message · played")
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_MESSAGE)
                .setContentIntent(openAppIntent(context))
                .addAction(playAction(context, voiceId, url, from, "Play again"))
                .build()
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.notify(notificationIdFor(voiceId), notification)
        }
    }

    private val main = Handler(Looper.getMainLooper())
    private var player: MediaPlayer? = null
    private var focusRequest: AudioFocusRequest? = null
    private var current: Triple<String, String, String>? = null
    // Bumped per note, so a download that finishes after the next note has
    // started (or after Stop) knows it is stale and quietly drops out.
    private var generation = 0

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_PLAY -> {
                val id = intent.getStringExtra(EXTRA_ID)
                val url = intent.getStringExtra(EXTRA_URL)
                val from = intent.getStringExtra(EXTRA_FROM) ?: "Your partner"
                // First, always: a service started with startForegroundService
                // has five seconds to become one or the app is killed.
                goForeground(from)
                if (id == null || url == null) {
                    finish()
                } else {
                    play(id, url, from)
                }
            }
            ACTION_STOP -> {
                val playing = current
                finish()
                if (playing != null) notifyPlayed(this, playing.first, playing.second, playing.third)
            }
            else -> finish()
        }
        return START_NOT_STICKY
    }

    private fun goForeground(from: String) {
        ensureChannels(this)
        val stop = PendingIntent.getService(
            this, 1, Intent(this, VoicePlaybackService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or immutable()
        )
        @Suppress("DEPRECATION")
        val notification = builder(this, CHANNEL_PLAYING)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle(from)
            .setContentText("Playing a voice message")
            .setOngoing(true)
            .setContentIntent(openAppIntent(this))
            .addAction(Notification.Action.Builder(android.R.drawable.ic_media_pause, "Stop", stop).build())
            .build()
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(PLAYING_NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        } else {
            startForeground(PLAYING_NOTIFICATION_ID, notification)
        }
    }

    private fun play(voiceId: String, url: String, from: String) {
        releasePlayer()
        current = Triple(voiceId, url, from)
        playingId = voiceId
        val mine = ++generation

        Thread {
            val file = try {
                download(voiceId, url)
            } catch (e: Exception) {
                null
            }
            main.post {
                if (mine != generation) return@post
                if (file == null) {
                    finish()
                    notifyWaiting(this, voiceId, url, from, "it could not download — tap Play to try again")
                } else {
                    start(file, voiceId, url, from)
                }
            }
        }.start()
    }

    private fun download(voiceId: String, url: String): File {
        val dir = File(cacheDir, "voice").apply { mkdirs() }
        val file = File(dir, "$voiceId.audio")
        if (file.length() > 0) return file

        val partial = File(dir, "$voiceId.part")
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 10_000
            connection.readTimeout = 30_000
            if (connection.responseCode !in 200..299) {
                throw IllegalStateException("HTTP ${connection.responseCode}")
            }
            connection.inputStream.use { input ->
                partial.outputStream().use { output -> input.copyTo(output) }
            }
        } finally {
            connection.disconnect()
        }
        if (!partial.renameTo(file)) throw IllegalStateException("Could not save the voice note")
        return file
    }

    private fun start(file: File, voiceId: String, url: String, from: String) {
        val audio = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val attributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()

        // Transient focus: music pauses for the note and picks up after it,
        // rather than the two playing over each other.
        val granted = if (Build.VERSION.SDK_INT >= 26) {
            val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(attributes)
                .setOnAudioFocusChangeListener { change ->
                    if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
                        val playing = current
                        finish()
                        if (playing != null) notifyWaiting(this, playing.first, playing.second, playing.third, "it was interrupted")
                    }
                }
                .build()
            focusRequest = request
            audio.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        } else {
            @Suppress("DEPRECATION")
            audio.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT) ==
                AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        }
        if (!granted) {
            finish()
            notifyWaiting(this, voiceId, url, from, "something else was using the speaker")
            return
        }

        try {
            player = MediaPlayer().apply {
                setAudioAttributes(attributes)
                setWakeMode(this@VoicePlaybackService, PowerManager.PARTIAL_WAKE_LOCK)
                setDataSource(file.path)
                setOnCompletionListener {
                    finish()
                    notifyPlayed(this@VoicePlaybackService, voiceId, url, from)
                }
                setOnErrorListener { _, _, _ ->
                    file.delete()
                    finish()
                    notifyWaiting(this@VoicePlaybackService, voiceId, url, from, "it could not play")
                    true
                }
                prepare()
                start()
            }
        } catch (e: Exception) {
            file.delete()
            finish()
            notifyWaiting(this, voiceId, url, from, "it could not play")
        }
    }

    private fun releasePlayer() {
        player?.let {
            try {
                it.stop()
            } catch (e: Exception) {
                // Stopping a player that never started throws; it is going anyway.
            }
            it.release()
        }
        player = null
        val audio = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        if (Build.VERSION.SDK_INT >= 26) {
            focusRequest?.let { audio.abandonAudioFocusRequest(it) }
        } else {
            @Suppress("DEPRECATION")
            audio.abandonAudioFocus(null)
        }
        focusRequest = null
    }

    private fun finish() {
        generation++
        releasePlayer()
        current = null
        playingId = null
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE)
        else @Suppress("DEPRECATION") stopForeground(true)
        stopSelf()
    }

    override fun onDestroy() {
        releasePlayer()
        super.onDestroy()
    }
}
