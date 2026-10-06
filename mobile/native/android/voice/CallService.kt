package com.loversrock.app.voice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Person
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder

/**
 * Keeps a call alive with the app off screen.
 *
 * Learned from Nextcloud Talk's CallForegroundService. Since Android 11 an
 * app may only use the microphone (and camera) while it is on screen, unless
 * a foreground service of type "microphone" ("camera") is running. Without
 * one, switching to another app or locking the phone mid-call cuts the
 * microphone: the call stays "connected" and the other phone hears silence.
 *
 * Started by the app when a call starts connecting (CallContext.js) and
 * stopped when it ends. While it runs, the call sits in the notification
 * shade as an ongoing call, with Hang up, which opens
 * loversrock://call?hangup=<id> for the app to end it.
 */
class CallService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            finish()
            return START_NOT_STICKY
        }
        val callId = intent?.getStringExtra(EXTRA_CALL_ID) ?: ""
        val from = intent?.getStringExtra(EXTRA_FROM) ?: "Your partner"
        val video = intent?.getStringExtra(EXTRA_KIND) == "video"
        try {
            goForeground(callId, from, video)
        } catch (e: Exception) {
            // Android refused (no microphone permission yet, or the app was
            // not on screen): the call goes on, only without this.
            stopSelf()
        }
        return START_NOT_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // Swiping the app away ends the call's hold on the microphone too.
        finish()
        super.onTaskRemoved(rootIntent)
    }

    private fun finish() {
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE)
        else @Suppress("DEPRECATION") stopForeground(true)
        stopSelf()
    }

    private fun goForeground(callId: String, from: String, video: Boolean) {
        ensureChannel(this)
        val open = packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            PendingIntent.getActivity(this, NOTIFICATION_ID, launch, PendingIntent.FLAG_UPDATE_CURRENT or immutable())
        }
        val hangUp = PendingIntent.getActivity(
            this, NOTIFICATION_ID + 1,
            Intent(Intent.ACTION_VIEW, Uri.parse("loversrock://call?hangup=$callId"))
                .setPackage(packageName)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or immutable()
        )

        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL)
        else @Suppress("DEPRECATION") Notification.Builder(this)
        builder
            .setSmallIcon(applicationInfo.icon)
            .setContentTitle(from)
            .setContentText(if (video) "Video call" else "Voice call")
            .setCategory(Notification.CATEGORY_CALL)
            .setOngoing(true)
            .setUsesChronometer(true)
            .setWhen(System.currentTimeMillis())
            .setShowWhen(true)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
        if (open != null) builder.setContentIntent(open)

        var styled = false
        if (Build.VERSION.SDK_INT >= 31) {
            try {
                val caller = Person.Builder().setName(from).setImportant(true).build()
                builder.setStyle(Notification.CallStyle.forOngoingCall(caller, hangUp))
                styled = true
            } catch (e: Exception) {
                styled = false
            }
        }
        if (!styled) builder.addAction(Notification.Action.Builder(0, "Hang up", hangUp).build())
        val notification = builder.build()

        if (Build.VERSION.SDK_INT >= 30) {
            var types = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            if (video) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
            try {
                startForeground(NOTIFICATION_ID, notification, types)
            } catch (e: Exception) {
                // No camera permission for the camera type: the microphone
                // alone still keeps the call audible.
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
            }
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    companion object {
        const val CHANNEL = "ongoing_call"
        private const val NOTIFICATION_ID = 7310
        private const val ACTION_STOP = "com.loversrock.app.voice.STOP_CALL_SERVICE"
        private const val EXTRA_CALL_ID = "callId"
        private const val EXTRA_FROM = "from"
        private const val EXTRA_KIND = "kind"

        private fun immutable() = if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0

        fun ensureChannel(context: Context) {
            if (Build.VERSION.SDK_INT < 26) return
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (manager.getNotificationChannel(CHANNEL) != null) return
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL, "Ongoing call", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Shows while you are in a call, and keeps it going with the app closed"
                    setSound(null, null)
                    enableVibration(false)
                }
            )
        }

        fun start(context: Context, callId: String, from: String, kind: String) {
            val intent = Intent(context, CallService::class.java)
                .putExtra(EXTRA_CALL_ID, callId)
                .putExtra(EXTRA_FROM, from)
                .putExtra(EXTRA_KIND, kind)
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
        }

        fun stop(context: Context) {
            // A plain stopService: no need to start the service just to stop it.
            context.stopService(Intent(context, CallService::class.java))
        }
    }
}
