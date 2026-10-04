package com.loversrock.app.voice

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * The Decline button on the ringing notification (CallRinger), which works
 * without opening the app, the way a phone call's does.
 *
 * It stops the ringing at once, then tells the server, which tells the
 * caller. The push that rang carried a token good for declining that one call
 * only (backend/src/routes/calls.js, declineToken), since there is no signed
 * in app here to send a session.
 */
class CallActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_DECLINE) return
        val callId = intent.getStringExtra(EXTRA_CALL_ID) ?: return
        val token = intent.getStringExtra(EXTRA_TOKEN)
        CallRinger.stop(context, callId)

        val api = VoicePrefs.apiUrl(context)
        if (api.isNullOrEmpty() || token.isNullOrEmpty()) return

        val pending = goAsync()
        Thread {
            try {
                val connection = URL("$api/calls/$callId/decline-from-notification").openConnection() as HttpURLConnection
                connection.requestMethod = "POST"
                connection.doOutput = true
                connection.connectTimeout = 8000
                connection.readTimeout = 8000
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(JSONObject().put("token", token).toString().toByteArray()) }
                connection.responseCode
                connection.disconnect()
            } catch (e: Exception) {
                // Offline: the caller's phone gives up on its own after a while.
            } finally {
                pending.finish()
            }
        }.start()
    }

    companion object {
        const val ACTION_DECLINE = "com.loversrock.app.voice.DECLINE_CALL"
        const val EXTRA_CALL_ID = "callId"
        const val EXTRA_TOKEN = "token"
    }
}
