package com.loversrock.app.voice

import android.app.NotificationManager
import android.content.Context
import android.media.AudioManager

/**
 * What the voice-note service needs to know before the app has started.
 *
 * The push that wakes the service can arrive with the app long closed, so
 * nothing here can come from JS at that moment. The app writes these ahead of
 * time through VoiceNotesModule, and the service reads them cold.
 */
object VoicePrefs {
    private const val PREFS = "loversrock_voice"
    private const val KEY_AUTO_PLAY = "autoPlay"
    private const val KEY_WHEN_SILENT = "whenSilent"
    private const val KEY_API_URL = "apiUrl"
    private const val KEY_RECENT = "recentIds"
    private const val RECENT_LIMIT = 30

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun autoPlay(context: Context) = prefs(context).getBoolean(KEY_AUTO_PLAY, true)

    fun whenSilent(context: Context) = prefs(context).getBoolean(KEY_WHEN_SILENT, false)

    fun setSettings(context: Context, autoPlay: Boolean, whenSilent: Boolean) {
        prefs(context).edit()
            .putBoolean(KEY_AUTO_PLAY, autoPlay)
            .putBoolean(KEY_WHEN_SILENT, whenSilent)
            .apply()
    }

    fun apiUrl(context: Context): String? = prefs(context).getString(KEY_API_URL, null)

    fun setApiUrl(context: Context, url: String) {
        prefs(context).edit().putString(KEY_API_URL, url.trimEnd('/')).apply()
    }

    /**
     * Claims a note, once.
     *
     * The same note can arrive twice with the app open: over the socket and
     * as the push. Whichever lands first plays it; the second finds it
     * claimed and does nothing, so a note never plays over itself.
     */
    @Synchronized
    fun claim(context: Context, voiceId: String): Boolean {
        val recent = prefs(context).getString(KEY_RECENT, "")!!
            .split(',').filter { it.isNotEmpty() }
        if (voiceId in recent) return false
        val next = (recent + voiceId).takeLast(RECENT_LIMIT)
        prefs(context).edit().putString(KEY_RECENT, next.joinToString(",")).commit()
        return true
    }

    /**
     * Why a note should NOT play out loud right now, or null if it can.
     *
     * A voice going off in a meeting is the failure people remember, so the
     * phone's own "be quiet" settings win unless the person said otherwise:
     * silent and vibrate, Do Not Disturb, and a call in progress (which would
     * put the note in the caller's ear). In every one of these cases the note
     * still arrives, as a notification with a Play button.
     */
    fun reasonNotToPlay(context: Context): String? {
        if (!autoPlay(context)) return "Auto-play is off"

        val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        if (audio.mode == AudioManager.MODE_IN_CALL || audio.mode == AudioManager.MODE_IN_COMMUNICATION) {
            return "You were on a call"
        }
        if (whenSilent(context)) return null

        if (audio.ringerMode != AudioManager.RINGER_MODE_NORMAL) return "Your phone is on silent"
        val notifications = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val filter = notifications.currentInterruptionFilter
        if (filter != NotificationManager.INTERRUPTION_FILTER_ALL &&
            filter != NotificationManager.INTERRUPTION_FILTER_UNKNOWN
        ) {
            return "Do Not Disturb is on"
        }
        return null
    }
}
