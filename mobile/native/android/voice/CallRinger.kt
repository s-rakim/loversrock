package com.loversrock.app.voice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.provider.Settings

/**
 * Makes the phone RING when your partner calls, the way a phone call does:
 * your own ringtone, over and over, until you answer, decline, or they hang
 * up.
 *
 * It used to be an ordinary notification on the "calls" channel: one short
 * notification sound, played once — and on ColorOS often not at all. That is
 * not a phone ringing. This posts the incoming call on a channel whose sound
 * IS the phone's ringtone (played as a ringtone, so it follows the ringer
 * switch: silent stays silent, vibrate vibrates) and marks it insistent, which
 * makes Android repeat that sound until the notification goes away.
 *
 * Started from two places: the push (VoiceMessagingService), which is how a
 * phone in a pocket rings, and the app itself (VoiceNotesModule.ringIncoming)
 * when the call arrives over the socket with the app open. Either way it is
 * one notification with one id, so a push and a socket arriving together ring
 * once. Stopped by answering or declining in the app, by the caller hanging up
 * (the server pushes "call_end"), or after a minute on its own.
 */
object CallRinger {
    // A new id, not "calls": a channel's sound can only be chosen when it is
    // created, and "calls" already exists on every phone without one.
    const val CHANNEL = "incoming_call_ring"
    private const val NOTIFICATION_ID = 7300
    private const val MISSED_ID = 7301
    private const val RING_FOR_MS = 60_000L
    private const val PREFS = "loversrock_call_ringer"

    private fun ringtone(): Uri =
        RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE) ?: Settings.System.DEFAULT_RINGTONE_URI

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL) != null) return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, "Incoming calls (ringing)", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Rings with your ringtone when your partner calls"
                setSound(
                    ringtone(),
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 800, 600, 800, 600)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
        )
    }

    /** Ring for this call. Ringing for it already: nothing changes. */
    fun ring(context: Context, callId: String, from: String, kind: String) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        // A call that has already been answered, declined or hung up must not
        // start ringing again because its push arrived late.
        if (prefs.getString("ended", null) == callId) return
        if (prefs.getString("ringing", null) == callId) return
        prefs.edit().putString("ringing", callId).apply()

        ensureChannel(context)
        val open = openApp(context)
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, CHANNEL)
        else @Suppress("DEPRECATION") Notification.Builder(context).apply {
            setSound(ringtone())
            setPriority(Notification.PRIORITY_MAX)
            setVibrate(longArrayOf(0, 800, 600, 800, 600))
        }
        builder
            .setSmallIcon(context.applicationInfo.icon)
            .setContentTitle(if (kind == "video") "$from · video call" else "$from is calling")
            .setContentText("Tap to answer")
            .setCategory(Notification.CATEGORY_CALL)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(true)
            .setShowWhen(true)
        if (open != null) {
            builder.setContentIntent(open)
            // Straight onto the screen when the phone is locked, like a call.
            builder.setFullScreenIntent(open, true)
        }
        if (Build.VERSION.SDK_INT >= 26) builder.setTimeoutAfter(RING_FOR_MS)

        val notification = builder.build()
        // Repeat the ringtone until the notification is gone.
        notification.flags = notification.flags or Notification.FLAG_INSISTENT
        manager(context).notify(NOTIFICATION_ID, notification)
    }

    /**
     * Stop ringing. `callId` null stops whatever is ringing (answered or
     * declined in the app); a specific id stops only that call, so an old
     * call's hang-up cannot silence a new one.
     */
    fun stop(context: Context, callId: String?) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val ringing = prefs.getString("ringing", null)
        if (callId != null && ringing != null && ringing != callId) return
        prefs.edit().remove("ringing").putString("ended", callId ?: ringing).apply()
        manager(context).cancel(NOTIFICATION_ID)
    }

    /** They gave up before you answered: stop, and leave a missed call. */
    fun missed(context: Context, callId: String, from: String) {
        val wasRinging = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("ringing", null) == callId
        stop(context, callId)
        if (!wasRinging) return
        // The app's own "calls" channel (services/notifications.js), which
        // exists once the app has been opened.
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, "calls")
        else @Suppress("DEPRECATION") Notification.Builder(context)
        builder
            .setSmallIcon(context.applicationInfo.icon)
            .setContentTitle("Missed call")
            .setContentText("$from called")
            .setCategory(Notification.CATEGORY_MISSED_CALL)
            .setAutoCancel(true)
        openApp(context)?.let { builder.setContentIntent(it) }
        manager(context).notify(MISSED_ID, builder.build())
    }

    private fun manager(context: Context) =
        context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    private fun openApp(context: Context): PendingIntent? {
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val immutable = if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0
        return PendingIntent.getActivity(context, NOTIFICATION_ID, launch, PendingIntent.FLAG_UPDATE_CURRENT or immutable)
    }
}
