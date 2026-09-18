package com.loversrock.app.widgets

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import com.loversrock.app.R

/**
 * The "at a glance" home screen widget: streak, next countdown, distance
 * apart, and whether today's prompt is still waiting.
 *
 * onUpdate runs on the main thread, so it paints cached data first and only
 * then refreshes on a background thread. The OS-driven cadence is set by
 * updatePeriodMillis in widget_summary_info.xml (30 minutes is the framework
 * floor); tapping the widget forces an immediate refresh.
 */
class SummaryWidgetProvider : AppWidgetProvider() {

    companion object {
        const val ACTION_REFRESH = "com.loversrock.app.widgets.ACTION_REFRESH_SUMMARY"

        fun refreshAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, SummaryWidgetProvider::class.java))
            if (ids.isNotEmpty()) {
                context.sendBroadcast(
                    Intent(context, SummaryWidgetProvider::class.java).apply {
                        action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
                        putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
                    }
                )
            }
        }
    }

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        // Paint immediately from cache so the widget never shows blank.
        val cached = WidgetRepository.cached(context)
        ids.forEach { render(context, manager, it, cached) }

        Thread {
            val fresh = WidgetRepository.fetch(context)
            if (fresh != null) ids.forEach { render(context, manager, it, fresh) }
        }.start()
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == ACTION_REFRESH) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, SummaryWidgetProvider::class.java))
            onUpdate(context, manager, ids)
        }
    }

    private fun render(context: Context, manager: AppWidgetManager, widgetId: Int, data: WidgetRepository.Summary?) {
        val views = RemoteViews(context.packageName, R.layout.widget_summary)

        if (WidgetRepository.credentials(context) == null) {
            views.setTextViewText(R.id.widget_headline, "Open loversrock")
            views.setTextViewText(R.id.widget_subline, "Sign in to set up your widget")
            views.setViewVisibility(R.id.widget_stat_row, View.GONE)
        } else if (data == null) {
            views.setTextViewText(R.id.widget_headline, "loversrock.")
            views.setTextViewText(R.id.widget_subline, "Tap to refresh")
            views.setViewVisibility(R.id.widget_stat_row, View.GONE)
        } else if (!data.paired) {
            views.setTextViewText(R.id.widget_headline, "Not paired yet")
            views.setTextViewText(R.id.widget_subline, "Pair with your partner in the app")
            views.setViewVisibility(R.id.widget_stat_row, View.GONE)
        } else {
            views.setViewVisibility(R.id.widget_stat_row, View.VISIBLE)

            views.setTextViewText(
                R.id.widget_headline,
                if (data.streakCount > 0) "${data.streakCount} day streak" else "loversrock."
            )

            views.setTextViewText(
                R.id.widget_subline,
                when {
                    !data.promptAnsweredToday -> "Today's prompt is waiting"
                    data.stale -> "Offline — last known"
                    else -> "You're all caught up"
                }
            )

            views.setTextViewText(R.id.widget_countdown_value, data.countdownDays?.let { "${it}d" } ?: "—")
            views.setTextViewText(R.id.widget_countdown_label, data.countdownLabel ?: "No countdown")

            views.setTextViewText(
                R.id.widget_distance_value,
                data.distanceKm?.let { if (it < 1) "<1 km" else "${it.toInt()} km" } ?: "—"
            )
            views.setTextViewText(
                R.id.widget_distance_label,
                if (data.distanceKm != null) "apart" else "Sharing off"
            )
        }

        // Tapping the body opens the app; tapping refresh re-fetches in place.
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
        if (launch != null) {
            views.setOnClickPendingIntent(
                R.id.widget_root,
                PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_IMMUTABLE)
            )
        }
        views.setOnClickPendingIntent(
            R.id.widget_refresh,
            PendingIntent.getBroadcast(
                context,
                1,
                Intent(context, SummaryWidgetProvider::class.java).setAction(ACTION_REFRESH),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            )
        )

        manager.updateAppWidget(widgetId, views)
    }
}
