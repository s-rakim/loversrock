package com.loversrock.app.widgets

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Android's lock screen substitute.
 *
 * Android removed lock screen widgets in 5.0 (2014) and never brought them
 * back for phones — Android 15/16 reintroduced them for tablets only. So the
 * only way to put live couple data on an Android lock screen is an ongoing,
 * low-priority notification, which is what this does. iOS gets real lock
 * screen widgets instead (see widgets/ios).
 *
 * Deliberately silent and non-dismissible-but-unobtrusive: IMPORTANCE_LOW
 * means no sound and no heads-up banner, and VISIBILITY_PUBLIC lets the text
 * render on the lock screen itself.
 */
object LockScreenNotifier {
    private const val CHANNEL_ID = "loversrock_glance"
    private const val NOTIFICATION_ID = 4242

    fun show(context: Context, data: WidgetRepository.Summary) {
        if (!data.paired) return
        ensureChannel(context)

        val title = if (data.streakCount > 0) "${data.streakCount} day streak" else "loversrock."

        val parts = mutableListOf<String>()
        data.countdownDays?.let { days ->
            parts.add("${data.countdownLabel ?: "Countdown"} in ${days}d")
        }
        data.distanceKm?.let { km ->
            parts.add(if (km < 1) "<1 km apart" else "${km.toInt()} km apart")
        }
        if (!data.promptAnsweredToday) parts.add("Today's prompt is waiting")

        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
        val pendingIntent = launch?.let {
            PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_IMMUTABLE)
        }

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_myplaces)
            .setContentTitle(title)
            .setContentText(if (parts.isEmpty()) "You're all caught up" else parts.joinToString(" · "))
            .setStyle(NotificationCompat.BigTextStyle().bigText(parts.joinToString("\n")))
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(Notification.CATEGORY_STATUS)
            .setOnlyAlertOnce(true)
            .apply { pendingIntent?.let { setContentIntent(it) } }
            .build()

        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
        } catch (e: SecurityException) {
            // POST_NOTIFICATIONS not granted on Android 13+; the app asks for it,
            // and the glance simply stays hidden until the user allows it.
        }
    }

    fun cancel(context: Context) {
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
    }

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return

        val channel = NotificationChannel(
            CHANNEL_ID,
            "Lock screen glance",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Streak, countdown and distance apart on your lock screen"
            setShowBadge(false)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }
        manager.createNotificationChannel(channel)
    }
}
