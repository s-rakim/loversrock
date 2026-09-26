package com.loversrock.app.widgets

import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ComposeShader
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import org.json.JSONObject
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.min
import kotlin.math.sin

/**
 * A widget look (Settings > Widget look), as the app saved it.
 *
 * The rules for drawing each one are written down in the app, in
 * components/widgetLook.js; the in-app preview (WidgetBackdrop.js) and this
 * painter both follow them, so what you see in Settings is what the widget
 * draws.
 */
internal class WidgetLook(
    val kind: String,
    val gradient: String,
    val pattern: String,
    val colors: IntArray,
    val angle: Float,
    val scale: Int,
    val lightInk: Boolean
) {
    companion object {
        private val KINDS = setOf("glass", "solid", "gradient", "pattern")

        /** Null for anything unreadable, which the caller treats as grey glass. */
        fun parse(json: String?): WidgetLook? = try {
            if (json.isNullOrBlank()) null else {
                val o = JSONObject(json)
                val list = o.optJSONArray("colors")
                val colors = (0 until (list?.length() ?: 0)).mapNotNull { i ->
                    try { Color.parseColor(list!!.getString(i)) } catch (e: Exception) { null }
                }.take(4).toIntArray()
                val kind = o.optString("kind", "glass")
                if (kind !in KINDS || colors.isEmpty()) null else WidgetLook(
                    kind = kind,
                    gradient = o.optString("gradient", "linear"),
                    pattern = o.optString("pattern", "stripes"),
                    colors = colors,
                    angle = o.optDouble("angle", 0.0).toFloat(),
                    scale = o.optInt("scale", 4).coerceIn(1, 10),
                    lightInk = o.optString("ink", "dark") == "light"
                )
            }
        } catch (e: Exception) {
            null
        }
    }
}

internal object WidgetPainter {
    private const val SHEEN_ALPHA = 0x73          // widget_glass_sheen
    private const val RIM_ALPHA = 0xB3            // widget_glass_rim
    private const val AURORA_AT = 0.45f
    private const val AURORA_HALF = 0.12f
    private const val AURORA_ALPHA = 0.5f

    /** A colour 35% of the way to white — a one-colour pattern's second colour. */
    fun tint(c: Int): Int = mix(c, Color.WHITE, 0.35f)

    fun mix(a: Int, b: Int, t: Float): Int = Color.rgb(
        (Color.red(a) + (Color.red(b) - Color.red(a)) * t).toInt(),
        (Color.green(a) + (Color.green(b) - Color.green(a)) * t).toInt(),
        (Color.blue(a) + (Color.blue(b) - Color.blue(a)) * t).toInt()
    )

    private fun floorMod(a: Int, n: Int) = ((a % n) + n) % n

    private fun stops(n: Int): FloatArray =
        if (n == 1) floatArrayOf(0f) else FloatArray(n) { it / (n - 1).toFloat() }

    /** At least two colours for a gradient: a single colour runs into its tint. */
    private fun atLeastTwo(colors: IntArray): IntArray =
        if (colors.size == 1) intArrayOf(colors[0], tint(colors[0])) else colors

    /**
     * The whole background: the look, at `opacity` percent, clipped to rounded
     * corners, with the glass sheen and rim over it.
     *
     * @param w, h        bitmap size in pixels — kept small (see GlassStyle),
     *                    and stretched by the ImageView to the widget
     * @param radius      corner radius in the same pixels
     * @param rimWidth    rim stroke in the same pixels
     */
    fun paint(look: WidgetLook, opacity: Int, w: Int, h: Int, radius: Float, rimWidth: Float): Bitmap {
        val content = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        drawLook(Canvas(content), look, w.toFloat(), h.toFloat())

        val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(out)
        val rect = RectF(0f, 0f, w.toFloat(), h.toFloat())

        // The look, through the rounded shape, at the chosen opacity.
        val body = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = BitmapShader(content, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
            alpha = (255 * opacity.coerceIn(0, 100) / 100f).toInt()
        }
        canvas.drawRoundRect(rect, radius, radius, body)
        content.recycle()

        // Sheen across the upper half, as on the grey glass.
        val sheen = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = LinearGradient(
                0f, 0f, 0f, h * 0.45f,
                Color.argb(SHEEN_ALPHA, 255, 255, 255), Color.argb(0, 255, 255, 255),
                Shader.TileMode.CLAMP
            )
        }
        canvas.drawRoundRect(rect, radius, radius, sheen)

        // The bright hairline rim.
        val rim = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = rimWidth
            color = Color.argb(RIM_ALPHA, 255, 255, 255)
        }
        val inset = rimWidth / 2
        canvas.drawRoundRect(RectF(inset, inset, w - inset, h - inset), radius, radius, rim)
        return out
    }

    private fun drawLook(canvas: Canvas, look: WidgetLook, w: Float, h: Float) {
        val colors = look.colors
        val cx = w / 2
        val cy = h / 2
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)

        when (look.kind) {
            "solid" -> canvas.drawColor(colors[0])
            "gradient" -> when (look.gradient) {
                "radial" -> {
                    val list = atLeastTwo(colors)
                    paint.shader = RadialGradient(cx, cy, hypot(w, h) / 2, list, stops(list.size), Shader.TileMode.CLAMP)
                    canvas.drawRect(0f, 0f, w, h, paint)
                }
                "blend" -> {
                    // Bottom edge's left-to-right gradient everywhere, then the
                    // top edge's over it, fading out downwards: the four
                    // corners, mixed between.
                    val c = IntArray(4) { colors[it % colors.size] }
                    paint.shader = LinearGradient(0f, 0f, w, 0f, c[2], c[3], Shader.TileMode.CLAMP)
                    canvas.drawRect(0f, 0f, w, h, paint)
                    val top = LinearGradient(0f, 0f, w, 0f, c[0], c[1], Shader.TileMode.CLAMP)
                    val fade = LinearGradient(0f, 0f, 0f, h, Color.BLACK, Color.TRANSPARENT, Shader.TileMode.CLAMP)
                    paint.shader = ComposeShader(top, fade, PorterDuff.Mode.DST_IN)
                    canvas.drawRect(0f, 0f, w, h, paint)
                }
                else -> {
                    // linear, and aurora on top of it.
                    val a = Math.toRadians(look.angle.toDouble())
                    val dx = cos(a).toFloat()
                    val dy = sin(a).toFloat()
                    val len = abs(w / 2 * dx) + abs(h / 2 * dy)
                    val x1 = cx - dx * len; val y1 = cy - dy * len
                    val x2 = cx + dx * len; val y2 = cy + dy * len
                    val list = atLeastTwo(colors)
                    paint.shader = LinearGradient(x1, y1, x2, y2, list, stops(list.size), Shader.TileMode.CLAMP)
                    canvas.drawRect(0f, 0f, w, h, paint)
                    if (look.gradient == "aurora") {
                        val clear = Color.argb(0, 255, 255, 255)
                        val bright = Color.argb((255 * AURORA_ALPHA).toInt(), 255, 255, 255)
                        paint.shader = LinearGradient(
                            x1, y1, x2, y2,
                            intArrayOf(clear, clear, bright, clear, clear),
                            floatArrayOf(0f, AURORA_AT - AURORA_HALF, AURORA_AT, AURORA_AT + AURORA_HALF, 1f),
                            Shader.TileMode.CLAMP
                        )
                        canvas.drawRect(0f, 0f, w, h, paint)
                    }
                }
            }
            "pattern" -> drawPattern(canvas, look, w, h, paint)
        }
    }

    private fun drawPattern(canvas: Canvas, look: WidgetLook, w: Float, h: Float, paint: Paint) {
        val colors = look.colors
        val cx = w / 2
        val cy = h / 2
        val s = min(w, h) * (0.02f + 0.04f * look.scale)
        val reach = hypot(w, h) / 2
        val n = ceil(reach / s).toInt() + 1
        val list = atLeastTwo(colors)
        paint.shader = null
        paint.style = Paint.Style.FILL

        canvas.save()
        canvas.translate(cx, cy)
        canvas.rotate(look.angle)

        when (look.pattern) {
            "stripes" -> for (i in -n until n) {
                paint.color = list[floorMod(i, list.size)]
                canvas.drawRect(i * s, -reach - s, (i + 1) * s + 0.5f, reach + s, paint)
            }
            "checks" -> for (i in -n until n) for (j in -n until n) {
                paint.color = list[floorMod(i + j, list.size)]
                canvas.drawRect(i * s, j * s, (i + 1) * s + 0.5f, (j + 1) * s + 0.5f, paint)
            }
            "dots" -> {
                canvas.drawColor(colors[0])
                val dots = if (colors.size == 1) intArrayOf(tint(colors[0])) else colors.copyOfRange(1, colors.size)
                for (i in -n until n) for (j in -n until n) {
                    paint.color = dots[floorMod(i + j, dots.size)]
                    canvas.drawCircle((i + 0.5f) * s, (j + 0.5f) * s, 0.32f * s, paint)
                }
            }
            "waves" -> {
                val amp = 0.35f * s
                val wave = 3 * s
                val step = wave / 16
                canvas.drawColor(list[floorMod(-n - 1, list.size)])
                for (k in -n..n) {
                    val path = Path()
                    var x = -reach - wave
                    path.moveTo(x, k * s + amp * sin(2 * PI.toFloat() * x / wave))
                    while (x <= reach + wave) {
                        x += step
                        path.lineTo(x, k * s + amp * sin(2 * PI.toFloat() * x / wave))
                    }
                    path.lineTo(reach + wave, reach + s)
                    path.lineTo(-reach - wave, reach + s)
                    path.close()
                    paint.color = list[floorMod(k, list.size)]
                    canvas.drawPath(path, paint)
                }
            }
        }
        canvas.restore()
    }
}
