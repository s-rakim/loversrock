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
 * Shows the most recent photo your partner dropped from the app. Mirrors the
 * in-app "widget photo" feature, which the backend already stores and also
 * copies into Memories.
 */
class PhotoWidgetProvider : AppWidgetProvider() {

    companion object {
        const val ACTION_REFRESH = "com.loversrock.app.widgets.ACTION_REFRESH_PHOTO"

        fun refreshAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, PhotoWidgetProvider::class.java))
            if (ids.isNotEmpty()) {
                context.sendBroadcast(
                    Intent(context, PhotoWidgetProvider::class.java).apply {
                        action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
                        putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
                    }
                )
            }
        }
    }

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        ids.forEach { renderPlaceholder(context, manager, it) }

        Thread {
            val summary = WidgetRepository.fetch(context) ?: WidgetRepository.cached(context)
            val bitmap = if (summary?.hasPhoto == true) WidgetRepository.fetchPhoto(context) else null

            ids.forEach { widgetId ->
                val views = RemoteViews(context.packageName, R.layout.widget_photo)
                if (bitmap != null) {
                    views.setImageViewBitmap(R.id.photo_image, bitmap)
                    views.setViewVisibility(R.id.photo_image, View.VISIBLE)
                    views.setViewVisibility(R.id.photo_empty, View.GONE)
                } else {
                    views.setViewVisibility(R.id.photo_image, View.GONE)
                    views.setViewVisibility(R.id.photo_empty, View.VISIBLE)
                    views.setTextViewText(
                        R.id.photo_empty,
                        if (WidgetRepository.credentials(context) == null) "Sign in to loversrock"
                        else "No photo yet"
                    )
                }
                attachIntents(context, views)
                manager.updateAppWidget(widgetId, views)
            }
        }.start()
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == ACTION_REFRESH) {
            val manager = AppWidgetManager.getInstance(context)
            onUpdate(context, manager, manager.getAppWidgetIds(ComponentName(context, PhotoWidgetProvider::class.java)))
        }
    }

    private fun renderPlaceholder(context: Context, manager: AppWidgetManager, widgetId: Int) {
        val views = RemoteViews(context.packageName, R.layout.widget_photo)
        views.setViewVisibility(R.id.photo_empty, View.VISIBLE)
        views.setTextViewText(R.id.photo_empty, "Loading…")
        attachIntents(context, views)
        manager.updateAppWidget(widgetId, views)
    }

    private fun attachIntents(context: Context, views: RemoteViews) {
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
        if (launch != null) {
            views.setOnClickPendingIntent(
                R.id.photo_root,
                PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_IMMUTABLE)
            )
        }
    }
}
