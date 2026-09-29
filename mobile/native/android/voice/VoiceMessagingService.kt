package com.loversrock.app.voice

import android.content.Context
import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService

/**
 * The first code that runs when a voice note arrives, app open or not.
 *
 * FCM delivers every push to ONE service in the app. expo-notifications
 * registers its own at priority -1 precisely so an app can put one in front of
 * it; this is that one (the plugin registers it at a higher priority). A voice
 * note is taken here, and so is a call (CallRinger); everything else —
 * messages, reminders — goes to
 * expo-notifications exactly as before, and token refreshes are inherited
 * untouched.
 */
class VoiceMessagingService : ExpoFirebaseMessagingService() {
    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        // getData(), not `.data`: the same call compiles against the real Java class
        // and against the stub the typecheck uses.
        val data = remoteMessage.getData()
        // A call: ring like a phone (CallRinger), rather than leaving it to
        // an ordinary one-beep notification.
        if (data["type"] == "call") {
            val callId = data["callId"] ?: return
            CallRinger.ring(applicationContext, callId, data["from"] ?: "Your partner", data["kind"] ?: "voice")
            return
        }
        if (data["type"] == "call_end") {
            val callId = data["callId"] ?: return
            if (data["missed"] == "true") CallRinger.missed(applicationContext, callId, data["from"] ?: "Your partner")
            else CallRinger.stop(applicationContext, callId)
            return
        }
        if (data["type"] == "voice_text") {
            // The words, a few seconds after the note: the server transcribes
            // after it has sent. Shown in the note's notification.
            val voiceId = data["voiceId"] ?: return
            val url = resolveUrl(applicationContext, data["path"], data["url"]) ?: return
            VoicePlaybackService.showText(
                applicationContext, voiceId, url, data["from"] ?: "Your partner", data["text"] ?: return
            )
            return
        }
        if (data["type"] != "voice") {
            super.onMessageReceived(remoteMessage)
            return
        }
        val voiceId = data["voiceId"] ?: return
        val url = resolveUrl(applicationContext, data["path"], data["url"]) ?: return
        VoiceIncoming.handle(applicationContext, voiceId, url, data["from"] ?: "Your partner")
    }
}

/** Decides what to do with a note that just arrived, by push or by socket. */
object VoiceIncoming {
    fun handle(context: Context, voiceId: String, url: String, from: String) {
        if (!VoicePrefs.claim(context, voiceId)) return

        val why = VoicePrefs.reasonNotToPlay(context)
        if (why != null) {
            VoicePlaybackService.notifyWaiting(context, voiceId, url, from, why)
            return
        }
        try {
            VoicePlaybackService.start(context, voiceId, url, from)
        } catch (e: Exception) {
            // Android refused a foreground service from here (it only allows
            // one from the background for a high-priority push). The note
            // still arrives; it just waits for a tap.
            VoicePlaybackService.notifyWaiting(context, voiceId, url, from, null)
        }
    }
}

/**
 * The address the app itself saved beats the one in the push: the server
 * could only guess at it from the sender's request, and the two phones might
 * reach the server by different addresses.
 */
fun resolveUrl(context: Context, path: String?, fallback: String?): String? {
    val base = VoicePrefs.apiUrl(context)
    if (!base.isNullOrBlank() && !path.isNullOrBlank()) return base + path
    return fallback
}
