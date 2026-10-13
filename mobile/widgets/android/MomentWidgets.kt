package com.loversrock.app.widgets

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.TypedValue
import android.view.View
import android.widget.RemoteViews
import com.loversrock.app.R
import org.json.JSONObject

/**
 * The Candle-style glance widgets. Each is a tiny subclass of
 * MomentWidgetProvider naming its Kind; they share one layout
 * (widget_moment.xml), one data source (MomentRepository) and open the app
 * at the matching screen via a loversrock:// deep link.
 */
enum class MomentKind(val deepLink: String) {
    DAYS_TOGETHER("home"),
    ANNIVERSARY("home"),
    STREAK("streak"),
    COUNTDOWN("countdowns"),
    DISTANCE("distance"),
    PARTNER_MOOD("mood"),
    NEXT_DATE("dates"),
    LOVE_NOTE("notes"),
    SECRET_MESSAGE("secret"),
    DAILY_QUESTION("question"),
    QUICK_KISS("thumbkiss"),
}

data class MomentContent(val icon: String, val value: String, val label: String, val sub: String = "", val longValue: Boolean = false)

object MomentFormatter {
    fun content(kind: MomentKind, json: JSONObject?, signedIn: Boolean): MomentContent {
        if (kind == MomentKind.QUICK_KISS) return MomentContent("💋", "Thumb Kiss", "Tap to connect")
        if (!signedIn) return MomentContent("🕯️", "loversrock.", "Sign in to set up")
        if (json == null) return MomentContent("🕯️", "loversrock.", "Tap to refresh")
        if (!json.optBoolean("paired")) return MomentContent("💞", "Not paired", "Pair in the app")
        val partner = json.optString("partnerName").ifBlank { "Your partner" }

        return when (kind) {
            MomentKind.DAYS_TOGETHER -> MomentContent("❤️", "${json.optInt("daysTogether")}", "days together", "with $partner")
            MomentKind.ANNIVERSARY -> json.optJSONObject("anniversary")?.let {
                val days = it.optInt("daysRemaining")
                MomentContent("💍", if (days == 0) "Today!" else "${days}d", "until our anniversary", if (it.optInt("years") > 0) "${it.optInt("years")} years" else "")
            } ?: MomentContent("💍", "—", "Set your anniversary", "in Settings")
            MomentKind.STREAK -> MomentContent(
                "🔥", "${json.optInt("streakCount")}", "day streak",
                when {
                    !json.optBoolean("promptAnsweredToday") -> "Today's question is waiting"
                    json.optInt("streakFreezes") > 0 -> "❄️ ${json.optInt("streakFreezes")} freeze(s) banked"
                    else -> "All caught up"
                }
            )
            MomentKind.COUNTDOWN -> json.optJSONObject("nextCountdown")?.let {
                MomentContent("⏳", "${it.optInt("daysRemaining")}d", it.optString("label"), "")
            } ?: MomentContent("⏳", "—", "No countdown yet")
            MomentKind.DISTANCE -> if (json.isNull("distanceKm")) MomentContent("📍", "—", "Location sharing off")
                else json.optDouble("distanceKm").let { km ->
                    MomentContent("📍", if (km < 1) "<1 km" else "${km.toInt()} km", "apart", "from $partner")
                }
            MomentKind.PARTNER_MOOD -> json.optJSONObject("partnerMood")?.let {
                MomentContent(it.optString("emoji", "🙂"), partner, "is feeling", it.optString("text"))
            } ?: MomentContent("💭", partner, "hasn't set a mood")
            MomentKind.NEXT_DATE -> json.optJSONObject("nextDate")?.let {
                val d = it.optInt("daysRemaining")
                MomentContent("📅", it.optString("title"), if (d == 0) "today" else "in $d days", "", longValue = true)
            } ?: MomentContent("📅", "No date planned", "Swipe for ideas", "", longValue = true)
            MomentKind.LOVE_NOTE -> json.optJSONObject("latestNote")?.let {
                MomentContent("💌", it.optString("body"), "from $partner", it.optString("title"), longValue = true)
            } ?: MomentContent("💌", "No notes yet", "from $partner", "", longValue = true)
            // Only ever the fact that a secret exists — never its words.
            MomentKind.SECRET_MESSAGE -> if (json.optBoolean("secretMessageWaiting"))
                MomentContent("💌", "You have a message ❤️", "Tap to open", "", longValue = true)
                else MomentContent("🔒", "No new secrets", "Leave one for $partner", "", longValue = true)
            MomentKind.DAILY_QUESTION -> MomentContent(
                "💬", json.optString("todayQuestion").ifBlank { "No question today" }, "Today's question",
                if (json.optBoolean("promptAnsweredToday")) "You answered ✓" else "Tap to answer", longValue = true
            )
            MomentKind.QUICK_KISS -> MomentContent("💋", "Thumb Kiss", "Tap to connect")
        }
    }
}

abstract class MomentWidgetProvider : AppWidgetProvider() {
    abstract val kind: MomentKind

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val signedIn = WidgetRepository.credentials(context) != null
        ids.forEach { render(context, manager, it, MomentRepository.cached(context), signedIn) }
        if (kind == MomentKind.QUICK_KISS) return // static, no data needed
        Thread {
            val fresh = MomentRepository.fetch(context)
            if (fresh != null) ids.forEach { render(context, manager, it, fresh, signedIn) }
        }.start()
    }

    private fun render(context: Context, manager: AppWidgetManager, widgetId: Int, json: JSONObject?, signedIn: Boolean) {
        val c = MomentFormatter.content(kind, json, signedIn)
        val views = RemoteViews(context.packageName, R.layout.widget_moment)
        views.setTextViewText(R.id.moment_icon, c.icon)
        views.setTextViewText(R.id.moment_value, c.value)
        views.setTextViewTextSize(R.id.moment_value, TypedValue.COMPLEX_UNIT_SP, if (c.longValue) 14f else 26f)
        views.setInt(R.id.moment_value, "setMaxLines", if (c.longValue) 4 else 1)
        views.setTextViewText(R.id.moment_label, c.label)
        views.setTextViewText(R.id.moment_sub, c.sub)
        views.setViewVisibility(R.id.moment_sub, if (c.sub.isBlank()) View.GONE else View.VISIBLE)

        val open = Intent(Intent.ACTION_VIEW, Uri.parse("loversrock://${kind.deepLink}")).setPackage(context.packageName)
        views.setOnClickPendingIntent(
            R.id.moment_root,
            PendingIntent.getActivity(context, kind.ordinal + 100, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        )
        manager.updateAppWidget(widgetId, views)
    }
}

class DaysTogetherWidget : MomentWidgetProvider() { override val kind = MomentKind.DAYS_TOGETHER }
class AnniversaryWidget : MomentWidgetProvider() { override val kind = MomentKind.ANNIVERSARY }
class StreakWidget : MomentWidgetProvider() { override val kind = MomentKind.STREAK }
class CountdownWidget : MomentWidgetProvider() { override val kind = MomentKind.COUNTDOWN }
class DistanceWidget : MomentWidgetProvider() { override val kind = MomentKind.DISTANCE }
class PartnerMoodWidget : MomentWidgetProvider() { override val kind = MomentKind.PARTNER_MOOD }
class NextDateWidget : MomentWidgetProvider() { override val kind = MomentKind.NEXT_DATE }
class LoveNoteWidget : MomentWidgetProvider() { override val kind = MomentKind.LOVE_NOTE }
class SecretMessageWidget : MomentWidgetProvider() { override val kind = MomentKind.SECRET_MESSAGE }
class DailyQuestionWidget : MomentWidgetProvider() { override val kind = MomentKind.DAILY_QUESTION }
class QuickKissWidget : MomentWidgetProvider() { override val kind = MomentKind.QUICK_KISS }

/** The shared Canvas, drawn from vector strokes. Tapping opens the Canvas. */
class CanvasWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        Thread {
            val bitmap = MomentRepository.fetchCanvasBitmap(context)
            ids.forEach { id ->
                val views = RemoteViews(context.packageName, R.layout.widget_canvas)
                if (bitmap != null) {
                    views.setImageViewBitmap(R.id.canvas_image, bitmap)
                    views.setViewVisibility(R.id.canvas_image, View.VISIBLE)
                    views.setViewVisibility(R.id.canvas_empty, View.GONE)
                } else {
                    views.setViewVisibility(R.id.canvas_image, View.GONE)
                    views.setViewVisibility(R.id.canvas_empty, View.VISIBLE)
                }
                val open = Intent(Intent.ACTION_VIEW, Uri.parse("loversrock://canvas")).setPackage(context.packageName)
                views.setOnClickPendingIntent(R.id.canvas_root, PendingIntent.getActivity(context, 99, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
                manager.updateAppWidget(id, views)
            }
        }.start()
    }
}

object MomentWidgets {
    val providers = listOf(
        DaysTogetherWidget::class.java, AnniversaryWidget::class.java, StreakWidget::class.java,
        CountdownWidget::class.java, DistanceWidget::class.java, PartnerMoodWidget::class.java,
        NextDateWidget::class.java, LoveNoteWidget::class.java, SecretMessageWidget::class.java,
        DailyQuestionWidget::class.java, QuickKissWidget::class.java, CanvasWidget::class.java,
    )

    fun refreshAll(context: Context) {
        val manager = AppWidgetManager.getInstance(context)
        for (cls in providers) {
            val ids = manager.getAppWidgetIds(ComponentName(context, cls))
            if (ids.isEmpty()) continue
            context.sendBroadcast(Intent(context, cls).apply {
                action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
            })
        }
    }
}
