package com.loversrock.app.widgets

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Data for the Candle-style "moment" widgets (days together, anniversary,
 * partner mood, love note, secret message, …). It reads the same cached
 * GET /widget/summary payload WidgetRepository already fetches and stores, so
 * every widget shares one network call and one cache.
 */
object MomentRepository {
    // Same prefs file + key WidgetRepository writes its cache to.
    private const val KEY_CACHE = "cachedSummary"

    /** Refreshes the shared cache (blocking) and returns the raw JSON. */
    fun fetch(context: Context): JSONObject? {
        WidgetRepository.fetch(context)
        return cached(context)
    }

    fun cached(context: Context): JSONObject? {
        val raw = context.getSharedPreferences(WidgetRepository.PREFS, Context.MODE_PRIVATE)
            .getString(KEY_CACHE, null) ?: return null
        return try { JSONObject(raw) } catch (e: Exception) { null }
    }

    /**
     * Draws the shared Canvas from GET /widget/canvas (vector strokes with
     * coordinates normalised to a 3:4 page) onto a small bitmap.
     */
    fun fetchCanvasBitmap(context: Context, width: Int = 360): Bitmap? {
        val (apiUrl, token) = WidgetRepository.credentials(context) ?: return null
        var connection: HttpURLConnection? = null
        return try {
            connection = (URL("$apiUrl/widget/canvas").openConnection() as HttpURLConnection).apply {
                setRequestProperty("X-Widget-Token", token)
                connectTimeout = 8000
                readTimeout = 8000
            }
            if (connection.responseCode != 200) return null
            val json = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
            val height = (width * 4) / 3
            val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bitmap)
            val background = safeColor(json.optString("background", "#FFFFFF"), Color.WHITE)
            canvas.drawColor(background)
            val strokes = json.optJSONArray("strokes") ?: return bitmap
            for (i in 0 until strokes.length()) {
                val s = strokes.getJSONObject(i)
                val points = s.optJSONArray("points") ?: continue
                val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                    style = Paint.Style.STROKE
                    strokeCap = Paint.Cap.ROUND
                    strokeJoin = Paint.Join.ROUND
                    strokeWidth = (s.optDouble("width", 0.008) * width).toFloat().coerceAtLeast(1f)
                    color = if (s.optString("tool") == "eraser") background else safeColor(s.optString("color"), Color.parseColor("#E8607A"))
                }
                val path = Path()
                for (p in 0 until points.length()) {
                    val pt = points.getJSONObject(p)
                    val x = (pt.optDouble("x") * width).toFloat()
                    val y = (pt.optDouble("y") * height).toFloat()
                    if (p == 0) path.moveTo(x, y) else path.lineTo(x, y)
                }
                if (points.length() == 1) {
                    val pt = points.getJSONObject(0)
                    paint.style = Paint.Style.FILL
                    canvas.drawCircle((pt.optDouble("x") * width).toFloat(), (pt.optDouble("y") * height).toFloat(), paint.strokeWidth / 2, paint)
                } else {
                    canvas.drawPath(path, paint)
                }
            }
            bitmap
        } catch (e: Exception) {
            null
        } finally {
            connection?.disconnect()
        }
    }

    private fun safeColor(hex: String?, fallback: Int): Int =
        try { if (hex.isNullOrBlank()) fallback else Color.parseColor(hex.take(7)) } catch (e: Exception) { fallback }
}
