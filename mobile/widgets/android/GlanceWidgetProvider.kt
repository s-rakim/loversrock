package com.loversrock.app.widgets

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import com.loversrock.app.R

/**
 * The shared machinery behind every one-fact widget.
 *
 * Six widgets that each show a single thing — days together, today's
 * question, the next date, a sealed note, a kiss, the latest drawing — would
 * otherwise be six copies of the same twenty lines: paint from cache so the
 * tile is never blank, refresh on a background thread because onUpdate runs
 * on the main one, wire the tap intents, handle the refresh broadcast. Only
 * the last step differs, so only the last step is abstract.
 *
 * Each subclass is still its own class because the manifest registers
 * receivers by name; there is no way to have one receiver serve several
 * widget types with different layouts.
 */
abstract class GlanceWidgetProvider : AppWidgetProvider() {

    /** Layout to inflate. */
    abstract val layoutId: Int

    /** The action string for this widget's own refresh broadcast. */
    abstract val refreshAction: String

    /**
     * Fill in the views. Called twice per update — once with whatever was
     * cached, once with fresh data if the network came back — so it must be
     * safe to run against a null summary and must not accumulate state.
     */
    abstract fun paint(context: Context, views: RemoteViews, data: WidgetRepository.Summary?)

    /** Widgets that need more than /widget/summary override this. */
    open fun fetchExtra(context: Context) {}

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val cached = WidgetRepository.cached(context)
        ids.forEach { render(context, manager, it, cached) }

        Thread {
            fetchExtra(context)
            val fresh = WidgetRepository.fetch(context)
            // Repaint even when the fetch failed: fetchExtra may have brought
            // something back on its own, and a widget that only ever repaints
            // on a successful summary would show a stale drawing forever.
            val data = fresh ?: WidgetRepository.cached(context)
            ids.forEach { render(context, manager, it, data) }
        }.start()
    }

    /** Resized on the home screen: repaint, so a painted look fits the new shape. */
    override fun onAppWidgetOptionsChanged(
        context: Context, manager: AppWidgetManager, widgetId: Int, newOptions: android.os.Bundle
    ) {
        render(context, manager, widgetId, WidgetRepository.cached(context))
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == refreshAction) {
            val manager = AppWidgetManager.getInstance(context)
            onUpdate(context, manager, manager.getAppWidgetIds(ComponentName(context, javaClass)))
        }
    }

    protected fun refreshIntent(context: Context): PendingIntent =
        PendingIntent.getBroadcast(
            context,
            refreshAction.hashCode(),
            Intent(context, javaClass).setAction(refreshAction),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

    protected fun openApp(context: Context): PendingIntent? {
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
            ?: return null
        return PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_IMMUTABLE)
    }

    private fun render(
        context: Context,
        manager: AppWidgetManager,
        widgetId: Int,
        data: WidgetRepository.Summary?
    ) {
        val views = RemoteViews(context.packageName, layoutId)
        GlassStyle.apply(context, views, layoutId, manager, widgetId)

        // Three states before the widget has anything to say, and each needs
        // to tell the person what to DO about it rather than showing a dash.
        when {
            WidgetRepository.credentials(context) == null -> {
                views.setTextViewText(R.id.glance_value, "—")
                views.setTextViewText(R.id.glance_caption, "Open loversrock to set this up")
            }
            data == null -> {
                views.setTextViewText(R.id.glance_value, "—")
                views.setTextViewText(R.id.glance_caption, "Tap to refresh")
            }
            !data.paired -> {
                views.setTextViewText(R.id.glance_value, "—")
                views.setTextViewText(R.id.glance_caption, "Pair with your partner first")
            }
            else -> paint(context, views, data)
        }

        openApp(context)?.let { views.setOnClickPendingIntent(R.id.widget_root, it) }
        onClickExtras(context, views, widgetId)
        manager.updateAppWidget(widgetId, views)
    }

    /** Wire anything beyond "tapping the body opens the app". */
    open fun onClickExtras(context: Context, views: RemoteViews, widgetId: Int) {}

    companion object {
        /** Nudges every glance widget the person has placed. */
        fun refreshAll(context: Context, classes: List<Class<*>>) {
            val manager = AppWidgetManager.getInstance(context)
            for (cls in classes) {
                val ids = manager.getAppWidgetIds(ComponentName(context, cls))
                if (ids.isEmpty()) continue
                context.sendBroadcast(
                    Intent(context, cls).apply {
                        action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
                        putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
                    }
                )
            }
        }
    }
}
