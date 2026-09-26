package com.loversrock.app.widgets

import android.appwidget.AppWidgetManager
import android.content.Context
import android.graphics.Color
import android.widget.RemoteViews
import com.loversrock.app.R
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * What every widget but the locket wears behind its content, as chosen in the
 * app under Settings > Widget look: the grey glass, or a colour, gradient or
 * pattern (WidgetPainter), at the chosen translucency.
 *
 * Kept in its own preferences file, not beside the widget credentials:
 * logging out wipes those, and a look you chose is not something a logout
 * should take away.
 */
object GlassStyle {
    private const val PREFS = "loversrock_widget_style"
    private const val KEY_OPACITY = "glassOpacity"
    private const val KEY_LOOK = "look"

    /**
     * Longest side of a painted background, in pixels. The ImageView
     * stretches it to the widget; a gradient loses nothing, and a full-size
     * bitmap would eat most of the ~1MB a widget's RemoteViews may carry,
     * which the distance widget's two mascots also need.
     */
    private const val MAX_PX = 320
    private const val CORNER_DP = 24f

    private val LIGHT_TEXT = Color.WHITE
    private val LIGHT_MUTED = Color.argb(0xCC, 255, 255, 255)

    /** Percent opaque, 20–100. */
    fun opacity(context: Context): Int =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt(KEY_OPACITY, GLASS_DEFAULT)

    fun setOpacity(context: Context, percent: Int) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putInt(KEY_OPACITY, percent.coerceIn(0, 100)).apply()
    }

    /** The look as JSON from the app (components/widgetLook.js). */
    fun setLook(context: Context, json: String?) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_LOOK, json).apply()
    }

    private fun look(context: Context): WidgetLook? =
        WidgetLook.parse(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_LOOK, null))

    /** The generated glass drawable nearest a level — there is one per 5%. */
    fun drawableFor(percent: Int): Int =
        GLASS_LEVELS.minByOrNull { abs(it.first - percent) }!!.second

    /**
     * Paints the background of one widget.
     *
     * Grey glass is a ready-made drawable per translucency level. Anything
     * else is drawn to fit this widget's own proportions — read from its
     * size options, so the corners stay round when the image is stretched —
     * and on a dark look the text turns light.
     */
    fun apply(context: Context, views: RemoteViews, layoutId: Int, manager: AppWidgetManager?, widgetId: Int) {
        val opacity = opacity(context)
        val look = look(context)
        if (look == null || look.kind == "glass") {
            views.setImageViewResource(R.id.widget_bg, drawableFor(opacity))
            return
        }

        val (wDp, hDp) = sizeDp(manager, widgetId)
        val scale = MAX_PX / maxOf(wDp, hDp)
        val w = (wDp * scale).roundToInt().coerceAtLeast(8)
        val h = (hDp * scale).roundToInt().coerceAtLeast(8)
        try {
            val bitmap = WidgetPainter.paint(look, opacity, w, h, CORNER_DP * scale, maxOf(1f, scale))
            views.setImageViewBitmap(R.id.widget_bg, bitmap)
        } catch (e: Throwable) {
            // Out of memory or a bad colour: the glass, rather than a blank tile.
            views.setImageViewResource(R.id.widget_bg, drawableFor(opacity))
            return
        }

        if (look.lightInk) {
            val ink = GLASS_INK[layoutId] ?: return
            ink.primary.forEach { views.setTextColor(it, LIGHT_TEXT) }
            ink.muted.forEach { views.setTextColor(it, LIGHT_MUTED) }
            ink.tinted.forEach { views.setInt(it, "setColorFilter", LIGHT_MUTED) }
        }
    }

    /**
     * The widget's size in dp, portrait: the launcher's reported minimum
     * width and maximum height. Some launchers report nothing until the
     * widget is first laid out, so a 2:1 tile is assumed until they do.
     */
    private fun sizeDp(manager: AppWidgetManager?, widgetId: Int): Pair<Float, Float> {
        val options = try { manager?.getAppWidgetOptions(widgetId) } catch (e: Exception) { null }
        val w = options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0) ?: 0
        val h = options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0) ?: 0
        return if (w > 0 && h > 0) w.toFloat() to h.toFloat() else 250f to 125f
    }
}
