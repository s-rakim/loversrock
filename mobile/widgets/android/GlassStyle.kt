package com.loversrock.app.widgets

import android.content.Context
import android.widget.RemoteViews
import kotlin.math.abs

/**
 * How see-through the widgets' grey glass is, as set by the slider in the
 * app's Settings.
 *
 * Kept in its own preferences file, not beside the widget credentials:
 * logging out wipes those, and a look you chose is not something a logout
 * should take away.
 */
object GlassStyle {
    private const val PREFS = "loversrock_widget_style"
    private const val KEY_OPACITY = "glassOpacity"

    /** Percent opaque, 20–100. */
    fun opacity(context: Context): Int =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt(KEY_OPACITY, GLASS_DEFAULT)

    fun setOpacity(context: Context, percent: Int) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putInt(KEY_OPACITY, percent.coerceIn(0, 100)).apply()
    }

    /** The generated glass drawable nearest a level — there is one per 5%. */
    fun drawableFor(percent: Int): Int =
        GLASS_LEVELS.minByOrNull { abs(it.first - percent) }!!.second

    /**
     * Swaps the glass behind a widget's root for the chosen level. A drawable
     * swap because that is all RemoteViews allows: there is no remote call
     * that sets a background's alpha.
     */
    fun apply(context: Context, views: RemoteViews, rootId: Int) {
        views.setInt(rootId, "setBackgroundResource", drawableFor(opacity(context)))
    }
}
