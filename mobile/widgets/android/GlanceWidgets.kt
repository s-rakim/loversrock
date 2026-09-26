package com.loversrock.app.widgets

import android.appwidget.AppWidgetManager
import android.content.Context
import android.util.TypedValue
import android.view.View
import android.widget.RemoteViews
import com.loversrock.app.R

/**
 * The six one-fact widgets.
 *
 * They live in one file because each is a layout id, a label and a dozen
 * lines deciding what to say — splitting that across six files would hide how
 * little they differ, and the shared behaviour is all in
 * GlanceWidgetProvider. Each is still its own class because the manifest
 * registers receivers by name.
 */

/** How long ago, in the fewest characters that are still honest. */
internal fun ago(iso: String?): String? {
    if (iso.isNullOrBlank()) return null
    return try {
        // Timestamps come back as ISO-8601 with a zone; the framework parser
        // is not available below API 26 on every path, so this is deliberate
        // and small rather than clever.
        val at = java.time.Instant.parse(
            if (iso.endsWith("Z")) iso else iso.replace(Regex("\\+00:00$"), "Z")
        ).toEpochMilli()
        val mins = (System.currentTimeMillis() - at) / 60000
        when {
            mins < 1L -> "just now"
            mins < 60L -> "${mins}m ago"
            mins < 48L * 60 -> "${mins / 60}h ago"
            else -> "${mins / 1440}d ago"
        }
    } catch (e: Exception) {
        null
    }
}

/* ------------------------------------------------------------ anniversary */

class AnniversaryWidgetProvider : GlanceWidgetProvider() {
    override val layoutId = R.layout.widget_glance
    override val refreshAction = "com.loversrock.app.widgets.REFRESH_ANNIVERSARY"

    override fun paint(context: Context, views: RemoteViews, data: WidgetRepository.Summary?) {
        views.setTextViewText(R.id.glance_label, "Together")
        val days = data?.daysTogether
        if (days == null) {
            views.setTextViewText(R.id.glance_value, "—")
            views.setTextViewText(R.id.glance_caption, "Set your date in the app")
            return
        }
        views.setTextViewText(R.id.glance_value, "$days days")
        // The next round number is the thing people actually want to know,
        // and "1000 days" being three weeks away is worth surfacing without
        // anyone having to do the arithmetic.
        val nextMilestone = listOf(100, 365, 500, 730, 1000, 1095, 1500, 1825, 2000, 3000, 3650)
            .firstOrNull { it > days }
        views.setTextViewText(
            R.id.glance_caption,
            if (nextMilestone != null) "$nextMilestone in ${nextMilestone - days} days"
            else data.togetherSince?.let { "since $it" } ?: ""
        )
    }

    override fun onClickExtras(context: Context, views: RemoteViews, widgetId: Int) {
        views.setOnClickPendingIntent(R.id.widget_refresh, refreshIntent(context))
    }
}

/* --------------------------------------------------------- daily question */

class DailyQuestionWidgetProvider : GlanceWidgetProvider() {
    override val layoutId = R.layout.widget_glance
    override val refreshAction = "com.loversrock.app.widgets.REFRESH_QUESTION"

    override fun paint(context: Context, views: RemoteViews, data: WidgetRepository.Summary?) {
        views.setTextViewText(R.id.glance_label, "Today's question")
        val question = data?.todaysQuestion
        if (question.isNullOrBlank()) {
            views.setTextViewText(R.id.glance_value, "—")
            views.setTextViewText(R.id.glance_caption, "No question today")
            return
        }
        // The question itself, at a smaller size than the rest of the glance
        // widgets use: a sentence set at 22sp is two words and an ellipsis.
        views.setTextViewText(R.id.glance_value, question)
        views.setTextViewTextSize(R.id.glance_value, TypedValue.COMPLEX_UNIT_SP, 14f)
        views.setTextViewText(
            R.id.glance_caption,
            if (data.promptAnsweredToday) "You have answered — tap to see theirs"
            else "Tap to answer"
        )
    }

    override fun onClickExtras(context: Context, views: RemoteViews, widgetId: Int) {
        views.setOnClickPendingIntent(R.id.widget_refresh, refreshIntent(context))
    }
}

/* ----------------------------------------------------------- the next date */

class NextDateWidgetProvider : GlanceWidgetProvider() {
    override val layoutId = R.layout.widget_glance
    override val refreshAction = "com.loversrock.app.widgets.REFRESH_NEXT_DATE"

    override fun paint(context: Context, views: RemoteViews, data: WidgetRepository.Summary?) {
        views.setTextViewText(R.id.glance_label, "Next date")
        val title = data?.nextDateTitle
        if (title.isNullOrBlank()) {
            views.setTextViewText(R.id.glance_value, "Nothing planned")
            views.setTextViewText(R.id.glance_caption, "Tap to pick something")
            views.setTextViewTextSize(R.id.glance_value, TypedValue.COMPLEX_UNIT_SP, 16f)
            return
        }
        views.setTextViewText(R.id.glance_value, title)
        views.setTextViewTextSize(R.id.glance_value, TypedValue.COMPLEX_UNIT_SP, 16f)
        views.setTextViewText(
            R.id.glance_caption,
            when (data.nextDateDays) {
                null -> ""
                0 -> "Today"
                1 -> "Tomorrow"
                else -> "in ${data.nextDateDays} days"
            }
        )
    }

    override fun onClickExtras(context: Context, views: RemoteViews, widgetId: Int) {
        views.setOnClickPendingIntent(R.id.widget_refresh, refreshIntent(context))
    }
}

/* -------------------------------------------------------- a sealed message */

class SecretMessageWidgetProvider : GlanceWidgetProvider() {
    override val layoutId = R.layout.widget_glance
    override val refreshAction = "com.loversrock.app.widgets.REFRESH_SECRET"

    override fun paint(context: Context, views: RemoteViews, data: WidgetRepository.Summary?) {
        views.setTextViewText(R.id.glance_label, "From them")
        views.setTextViewTextSize(R.id.glance_value, TypedValue.COMPLEX_UNIT_SP, 14f)

        when {
            // The one rule this widget exists to keep: a sealed note is
            // ANNOUNCED on a home screen, never printed on one. The server
            // does not send the body, so there is nothing here to leak even
            // if this code were wrong — but it is stated twice on purpose.
            data?.sealedNoteWaiting == true -> {
                views.setTextViewText(R.id.glance_value, "A sealed note is waiting")
                views.setTextViewText(R.id.glance_caption, "Open the app to read it")
            }
            !data?.latestNote.isNullOrBlank() -> {
                views.setTextViewText(R.id.glance_value, "“${data?.latestNote}”")
                views.setTextViewText(R.id.glance_caption, "")
            }
            else -> {
                views.setTextViewText(R.id.glance_value, "Nothing new")
                views.setTextViewText(R.id.glance_caption, "Leave them one instead")
            }
        }
    }

    override fun onClickExtras(context: Context, views: RemoteViews, widgetId: Int) {
        views.setOnClickPendingIntent(R.id.widget_refresh, refreshIntent(context))
    }
}

/* ---------------------------------------------------------------- the kiss */

class KissWidgetProvider : GlanceWidgetProvider() {
    override val layoutId = R.layout.widget_kiss
    override val refreshAction = "com.loversrock.app.widgets.REFRESH_KISS"

    companion object {
        const val ACTION_SEND = "com.loversrock.app.widgets.SEND_KISS"
    }

    override fun paint(context: Context, views: RemoteViews, data: WidgetRepository.Summary?) {
        val waiting = data?.unseenKisses ?: 0
        when {
            waiting > 0 -> {
                views.setTextViewText(R.id.glance_value, if (waiting == 1) "A kiss for you" else "$waiting kisses for you")
                views.setTextViewText(R.id.glance_caption, ago(data?.lastKissFromPartnerAt) ?: "")
            }
            else -> {
                views.setTextViewText(R.id.glance_value, "Send a kiss")
                views.setTextViewText(
                    R.id.glance_caption,
                    ago(data?.lastKissSentAt)?.let { "sent $it" } ?: "tap the heart"
                )
            }
        }
    }

    override fun onClickExtras(context: Context, views: RemoteViews, widgetId: Int) {
        // The heart sends; the rest of the tile opens the app. A widget whose
        // only action is "open the app" is a shortcut, not a widget.
        views.setOnClickPendingIntent(
            R.id.kiss_button,
            android.app.PendingIntent.getBroadcast(
                context,
                ACTION_SEND.hashCode(),
                android.content.Intent(context, KissWidgetProvider::class.java).setAction(ACTION_SEND),
                android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT
            )
        )
    }

    override fun onReceive(context: Context, intent: android.content.Intent) {
        if (intent.action == ACTION_SEND) {
            // Network on a broadcast receiver's thread would be an ANR, and
            // goAsync keeps the process alive long enough to finish — without
            // it the send is killed the moment onReceive returns.
            val pending = goAsync()
            Thread {
                try {
                    WidgetRepository.sendKiss(context)
                    val manager = AppWidgetManager.getInstance(context)
                    val ids = manager.getAppWidgetIds(
                        android.content.ComponentName(context, KissWidgetProvider::class.java)
                    )
                    val data = WidgetRepository.fetch(context) ?: WidgetRepository.cached(context)
                    ids.forEach { id ->
                        val views = RemoteViews(context.packageName, layoutId)
                        paint(context, views, data)
                        onClickExtras(context, views, id)
                        openApp(context)?.let { views.setOnClickPendingIntent(R.id.widget_root, it) }
                        manager.updateAppWidget(id, views)
                    }
                } finally {
                    pending.finish()
                }
            }.start()
            return
        }
        super.onReceive(context, intent)
    }
}

/* -------------------------------------------------------------- the canvas */

class CanvasWidgetProvider : GlanceWidgetProvider() {
    override val layoutId = R.layout.widget_canvas
    override val refreshAction = "com.loversrock.app.widgets.REFRESH_CANVAS"

    // RemoteViews bitmaps cross a Binder transaction with a hard ~1MB
    // ceiling, so the drawing is painted at a fixed modest size rather than
    // at whatever the person has resized the tile to.
    private val renderWidth = 320
    private val renderHeight = 320

    override fun fetchExtra(context: Context) {
        WidgetRepository.fetchDrawing(context)
    }

    override fun paint(context: Context, views: RemoteViews, data: WidgetRepository.Summary?) {
        val drawing = WidgetRepository.cachedDrawing(context)
        if (drawing == null || drawing.strokes.isEmpty()) {
            views.setViewVisibility(R.id.canvas_image, View.GONE)
            views.setTextViewText(R.id.glance_value, "Nothing drawn yet")
            views.setTextViewText(R.id.glance_caption, "")
            return
        }
        views.setViewVisibility(R.id.canvas_image, View.VISIBLE)
        WidgetRepository.renderDrawing(drawing, renderWidth, renderHeight)?.let {
            views.setImageViewBitmap(R.id.canvas_image, it)
        }
        views.setTextViewText(R.id.glance_value, drawing.title ?: "Untitled")
        views.setTextViewText(R.id.glance_caption, ago(data?.latestDrawingAt) ?: "")
    }
}


/**
 * How far apart you are, drawn the way people already draw it: the two of you
 * head to toe, her on the left and him on the right, a wiggly dotted line
 * with a heart on it between — and each of you as a mood and today's
 * symptoms.
 *
 * The number is the whole point, so it gets the label's line rather than a
 * caption. When there is no number the caption says why in words somebody
 * can act on — "turn on location sharing" is a thing to do, a dash is not.
 *
 * The pictures keep their places on both phones, fixed in the layout, so
 * no bitmap crosses the ~1MB RemoteViews transaction. What moves is the
 * data: the server says which picture is you (myArt), and each mood and
 * symptom row goes under whoever is standing in that slot.
 */
class DistanceWidgetProvider : GlanceWidgetProvider() {
    override val layoutId = R.layout.widget_distance
    override val refreshAction = "com.loversrock.app.widgets.REFRESH_DISTANCE"

    override fun paint(context: Context, views: RemoteViews, data: WidgetRepository.Summary?) {
        // Whoever holds the left side stands there, with their row under them.
        val meOnLeft = (data?.myArt ?: "a") == LEFT_ART
        val myMood = data?.myMoodEmoji
        val theirMood = data?.partnerMoodEmoji
        val mine = data?.mySymptomEmoji?.joinToString("")
        val theirs = data?.partnerSymptomEmoji?.joinToString("")

        emoji(views, R.id.distance_left_mood, if (meOnLeft) myMood else theirMood)
        emoji(views, R.id.distance_right_mood, if (meOnLeft) theirMood else myMood)
        emoji(views, R.id.distance_left_symptoms, if (meOnLeft) mine else theirs)
        emoji(views, R.id.distance_right_symptoms, if (meOnLeft) theirs else mine)
        views.setContentDescription(R.id.distance_left_art, if (meOnLeft) "You" else "Your partner")
        views.setContentDescription(R.id.distance_right_art, if (meOnLeft) "Your partner" else "You")

        // The mascots each of you uploaded, as fetchExtra cached them; the
        // placeholder figure where there is none.
        picture(views, R.id.distance_left_art, WidgetRepository.mascot(context, if (meOnLeft) "me" else "partner"))
        picture(views, R.id.distance_right_art, WidgetRepository.mascot(context, if (meOnLeft) "partner" else "me"))

        val km = data?.distanceKm
        if (km == null) {
            views.setTextViewText(R.id.glance_value, "\u2014")
            views.setTextViewText(
                R.id.glance_caption,
                when (data?.distanceStatus) {
                    "sharing_off" -> "Turn on location sharing, both of you"
                    "no_location" -> "Waiting for a location"
                    else -> "Tap to refresh"
                }
            )
            return
        }

        views.setTextViewText(R.id.glance_value, formatDistance(km))
        views.setTextViewText(
            R.id.glance_caption,
            if (data.stale) "Last known distance" else ""
        )
    }

    /** Brings both mascot pictures up to date before paint() runs. */
    override fun fetchExtra(context: Context) {
        WidgetRepository.fetchMascot(context, "me")
        WidgetRepository.fetchMascot(context, "partner")
    }

    private fun picture(views: RemoteViews, id: Int, bitmap: android.graphics.Bitmap?) {
        if (bitmap != null) views.setImageViewBitmap(id, bitmap)
        else views.setImageViewResource(id, R.drawable.widget_mascot_placeholder)
    }

    /** Shown when there is something to show, gone otherwise — never an empty badge. */
    private fun emoji(views: RemoteViews, id: Int, text: String?) {
        if (text.isNullOrEmpty()) {
            views.setViewVisibility(id, View.GONE)
        } else {
            views.setTextViewText(id, text)
            views.setViewVisibility(id, View.VISIBLE)
        }
    }

    override fun onClickExtras(context: Context, views: RemoteViews, widgetId: Int) {
        views.setOnClickPendingIntent(R.id.widget_refresh, refreshIntent(context))
    }
}

/**
 * The side token that stands on the left of the distance widget; "a" stands
 * on the right. Which of you holds which is a setting (Settings → Your
 * mascot), the same on both phones, so you stand the same way round on both
 * home screens.
 */
internal const val LEFT_ART = "b"

/**
 * Kilometres the way you would say them: "1,305 km" rather than "1305.0 km",
 * one decimal only while it is small enough for the decimal to mean
 * something, and metres when you are practically in the same room.
 */
internal fun formatDistance(km: Double): String = when {
    km < 1.0 -> "${(km * 1000).toInt()} m"
    km < 10.0 -> String.format(java.util.Locale.getDefault(), "%.1f km", km)
    else -> String.format(java.util.Locale.getDefault(), "%,d km", Math.round(km))
}
