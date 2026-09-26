package com.loversrock.app.widgets

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.os.Build
import android.os.Bundle
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject

/**
 * The loversrock glance on the lock screen — and, on phones that support it,
 * a Live Update.
 *
 * Plain Android has no lock screen widgets for phones, and the vendors that
 * add them (Samsung's One UI, OPPO's ColorOS) only list their own apps in
 * their lock-screen widget pickers. What they DO both take from any app is
 * Android 16's Live Updates: an ongoing notification the app asks to have
 * "promoted", which the system lifts into a chip in the status bar and onto
 * the lock screen — on Samsung (One UI 8) into the Now Bar, on OPPO
 * (ColorOS 16.1) into the lock-screen Live Space capsule, on a Pixel into the
 * status bar chip and the top of the shade. This notification asks for that.
 *
 * On older phones the request is simply ignored and it stays what it always
 * was: a quiet ongoing notification that shows on the lock screen.
 *
 * The project compiles against Android 14's SDK, so the Android 16 pieces are
 * set by their raw keys rather than by name. Values read from the Android 16
 * framework itself:
 *
 *   Notification.EXTRA_REQUEST_PROMOTED_ONGOING  "android.requestPromotedOngoing"
 *   Notification.EXTRA_SHORT_CRITICAL_TEXT       "android.shortCriticalText"
 *   Manifest.permission.POST_PROMOTED_NOTIFICATIONS  (declared by the plugin)
 *
 * What Android requires before it will promote one, all true here: ongoing,
 * a content title, a standard or BigText style, not colourised, no custom
 * RemoteViews, not a group summary, and a channel above IMPORTANCE_MIN.
 */
object LockScreenNotifier {
    private const val CHANNEL_ID = "loversrock_glance"
    private const val NOTIFICATION_ID = 4242
    private const val KEY_ENABLED = "lockScreenEnabled"

    private const val EXTRA_REQUEST_PROMOTED_ONGOING = "android.requestPromotedOngoing"
    private const val EXTRA_SHORT_CRITICAL_TEXT = "android.shortCriticalText"
    const val ACTION_PROMOTION_SETTINGS = "android.settings.APP_NOTIFICATION_PROMOTION_SETTINGS"
    /** Build.VERSION_CODES.BAKLAVA, which the Android 14 SDK does not name. */
    const val ANDROID_16 = 36

    fun isEnabled(context: Context): Boolean =
        context.getSharedPreferences(WidgetRepository.PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ENABLED, false)

    /**
     * Called with every fresh summary, from the widgets' own background
     * refresh as well as from the app, so the lock screen keeps up without
     * the app being opened. Does nothing unless the glance is switched on.
     */
    fun onSummary(context: Context, data: WidgetRepository.Summary) {
        if (isEnabled(context)) show(context, data)
    }

    fun show(context: Context, data: WidgetRepository.Summary) {
        if (!data.paired) return
        ensureChannel(context)

        val km = data.distanceKm
        // The headline is the thing the widgets exist for: how far apart.
        val title = when {
            km != null -> "${formatDistance(km)} apart"
            data.streakCount > 0 -> "${data.streakCount} day streak"
            else -> "loversrock."
        }

        val parts = mutableListOf<String>()
        data.partnerMoodEmoji?.let { parts.add("They feel $it") }
        if (km != null && data.streakCount > 0) parts.add("${data.streakCount} day streak")
        data.countdownDays?.let { days ->
            parts.add("${data.countdownLabel ?: "Countdown"} in ${days}d")
        }
        if (data.unseenKisses > 0) parts.add("A kiss is waiting")
        if (!data.promptAnsweredToday) parts.add("Today's prompt is waiting")

        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
        val pendingIntent = launch?.let {
            PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_IMMUTABLE)
        }

        val live = Bundle().apply {
            putBoolean(EXTRA_REQUEST_PROMOTED_ONGOING, true)
            // The few characters the status bar chip / Now Bar pill has room for.
            putString(EXTRA_SHORT_CRITICAL_TEXT, chipText(data))
        }

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_myplaces)
            .setContentTitle(title)
            .setContentText(if (parts.isEmpty()) "You're all caught up" else parts.joinToString(" · "))
            .setStyle(NotificationCompat.BigTextStyle().bigText(
                if (parts.isEmpty()) "You're all caught up" else parts.joinToString("\n")
            ))
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(Notification.CATEGORY_STATUS)
            .setOnlyAlertOnce(true)
            .addExtras(live)
            .apply { pendingIntent?.let { setContentIntent(it) } }
            .build()

        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
        } catch (e: SecurityException) {
            // POST_NOTIFICATIONS not granted on Android 13+; the app asks for it,
            // and the glance simply stays hidden until the user allows it.
        }
    }

    /** At most about seven characters: "343km", "1.3k km", "12 🔥", "♥". */
    internal fun chipText(data: WidgetRepository.Summary): String {
        val km = data.distanceKm
        return when {
            km != null && km < 1 -> "<1km"
            km != null && km < 1000 -> "${km.toInt()}km"
            km != null -> String.format(java.util.Locale.US, "%.1fk km", km / 1000)
            data.streakCount > 0 -> "${data.streakCount} \uD83D\uDD25"
            else -> "\u2665"
        }
    }

    /**
     * Whether this phone will show the glance live, for the Settings screen:
     * {"sdk", "liveUpdates": supported by the OS, "liveAllowed": the user's
     * per-app switch (null where it does not exist), "notifications"}.
     * canPostPromotedNotifications is Android 16 API, called by reflection
     * because this compiles against Android 14.
     */
    fun status(context: Context): String {
        val sdk = Build.VERSION.SDK_INT
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val liveAllowed: Boolean? = if (sdk >= ANDROID_16) {
            try {
                manager.javaClass.getMethod("canPostPromotedNotifications").invoke(manager) as? Boolean
            } catch (e: Exception) {
                null
            }
        } else null
        return JSONObject()
            .put("sdk", sdk)
            .put("liveUpdates", sdk >= ANDROID_16)
            .put("liveAllowed", liveAllowed ?: JSONObject.NULL)
            .put("notifications", NotificationManagerCompat.from(context).areNotificationsEnabled())
            .put("enabled", isEnabled(context))
            .toString()
    }

    fun cancel(context: Context) {
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
    }

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return

        // IMPORTANCE_LOW: silent, no banner — and, importantly, above
        // IMPORTANCE_MIN, which would disqualify it from being a Live Update.
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Lock screen glance",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Distance apart, moods, streak and countdown on your lock screen"
            setShowBadge(false)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }
        manager.createNotificationChannel(channel)
    }
}
