package com.loversrock.app.widgets

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * org.json has three different ways of saying "absent" — the key is missing,
 * the value is JSON null, or optString hands back an empty string — and every
 * one of them has to become a Kotlin null or the widget prints the word
 * "null" on somebody's home screen.
 */
private fun JSONObject.optStringOrNull(key: String): String? =
    if (isNull(key)) null else optString(key).takeIf { it.isNotEmpty() }

/** A JSON array of strings, or empty — a missing or malformed field is "none". */
private fun JSONObject.optStringList(key: String): List<String> {
    val array = optJSONArray(key) ?: return emptyList()
    return (0 until array.length()).mapNotNull { i ->
        if (array.isNull(i)) null else array.optString(i).takeIf { it.isNotEmpty() }
    }
}

/**
 * Talks to GET /widget/summary using the long-lived widget token the app
 * wrote into SharedPreferences (see WidgetBridgeModule).
 *
 * Every read is cache-first: a widget gets very little foreground time and may
 * be drawn with no network at all, so we always render the last good payload
 * immediately and only then try to refresh.
 */
object WidgetRepository {
    const val PREFS = "loversrock_widget"
    private const val KEY_API_URL = "apiUrl"
    private const val KEY_TOKEN = "widgetToken"
    private const val KEY_CACHE = "cachedSummary"
    private const val KEY_CACHED_AT = "cachedAt"
    private const val KEY_DRAWING = "cachedDrawing"

    private const val CONNECT_TIMEOUT_MS = 8000
    private const val READ_TIMEOUT_MS = 8000

    data class Summary(
        val paired: Boolean,
        val streakCount: Int,
        val promptAnsweredToday: Boolean,
        val countdownLabel: String?,
        val countdownDays: Int?,
        val distanceKm: Double?,
        // Why there is no number: "ok", "sharing_off" or "no_location".
        val distanceStatus: String?,
        // The letter in the partner's bubble on the distance widget.
        val partnerInitial: String?,
        // The distance widget's two full-body pictures: which bundled picture
        // ("a" or "b") is you and which is them. Decided by the server so
        // both phones agree on who is who.
        val myArt: String?,
        val partnerArt: String?,
        // Each of you as emoji: a mood, and up to three of today's symptoms.
        // The server has already dropped anything that must never appear on
        // a home screen, and the partner's symptoms unless they share them.
        val myMoodEmoji: String?,
        val partnerMoodEmoji: String?,
        val mySymptomEmoji: List<String>,
        val partnerSymptomEmoji: List<String>,
        val hasPhoto: Boolean,
        val partnerCyclePhase: String?,
        val partnerNextPeriodDate: String?,
        // Ambient presence, for the widgets that exist so nothing has to be
        // opened at all.
        val daysTogether: Int?,
        val togetherSince: String?,
        val partnerMood: String?,
        val partnerMoodNote: String?,
        val todaysQuestion: String?,
        val nextDateTitle: String?,
        val nextDateDays: Int?,
        // A sealed note is ANNOUNCED on the home screen, never printed there.
        val sealedNoteWaiting: Boolean,
        val latestNote: String?,
        val unseenKisses: Int,
        val lastKissFromPartnerAt: String?,
        val lastKissSentAt: String?,
        val latestDrawingAt: String?,
        val latestDrawingTitle: String?,
        val stale: Boolean
    )

    /** One stroke of a drawing, as the canvas widget needs to paint it. */
    data class Stroke(
        val points: FloatArray,   // x0, y0, x1, y1, ... — flat, to avoid boxing
        val color: Int,
        val width: Float,
        val tool: String
    )

    data class Drawing(val title: String?, val canvasColor: Int, val strokes: List<Stroke>)

    fun credentials(context: Context): Pair<String, String>? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val url = prefs.getString(KEY_API_URL, null) ?: return null
        val token = prefs.getString(KEY_TOKEN, null) ?: return null
        if (url.isBlank() || token.isBlank()) return null
        return url.trimEnd('/') to token
    }

    /** Last payload we successfully fetched, or null if the widget has never loaded. */
    fun cached(context: Context): Summary? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY_CACHE, null) ?: return null
        val cachedAt = prefs.getLong(KEY_CACHED_AT, 0L)
        // Older than ~2 hours means the phone has been offline or the token was
        // revoked; still worth showing, but flagged so the UI can dim it.
        val stale = System.currentTimeMillis() - cachedAt > 2 * 60 * 60 * 1000
        return parse(raw, stale)
    }

    /** Blocking network call — callers must already be off the main thread. */
    fun fetch(context: Context): Summary? {
        val (apiUrl, token) = credentials(context) ?: return null
        var connection: HttpURLConnection? = null
        return try {
            connection = (URL("$apiUrl/widget/summary").openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                setRequestProperty("X-Widget-Token", token)
                setRequestProperty("Accept", "application/json")
                connectTimeout = CONNECT_TIMEOUT_MS
                readTimeout = READ_TIMEOUT_MS
            }
            if (connection.responseCode != 200) return null
            val body = connection.inputStream.bufferedReader().use { it.readText() }

            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString(KEY_CACHE, body)
                .putLong(KEY_CACHED_AT, System.currentTimeMillis())
                .apply()

            parse(body, stale = false)?.also {
                // Every fresh summary keeps the lock-screen glance current,
                // including the widgets' own background refreshes.
                LockScreenNotifier.onSummary(context, it)
            }
        } catch (e: Exception) {
            null
        } finally {
            connection?.disconnect()
        }
    }

    fun fetchPhoto(context: Context): Bitmap? {
        val (apiUrl, token) = credentials(context) ?: return null
        var connection: HttpURLConnection? = null
        return try {
            connection = (URL("$apiUrl/widget/photo?token=$token").openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = CONNECT_TIMEOUT_MS
                readTimeout = READ_TIMEOUT_MS
            }
            if (connection.responseCode != 200) return null
            // Downsampled: RemoteViews bitmaps cross a Binder transaction with a
            // hard ~1MB limit, and a full-resolution photo will blow past it.
            val bytes = connection.inputStream.use { it.readBytes() }
            val options = BitmapFactory.Options().apply { inSampleSize = 2 }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
        } catch (e: Exception) {
            null
        } finally {
            connection?.disconnect()
        }
    }

    // ------------------------------------------------------------ mascots

    /**
     * Longest side of a mascot as the widget keeps it. Two of them share the
     * distance widget's ~1MB RemoteViews budget with everything else on it,
     * so they are held small: 220px is still sharp at the size they show.
     */
    private const val MASCOT_MAX_PX = 220

    private fun mascotFile(context: Context, who: String) = java.io.File(context.filesDir, "mascot_$who.png")

    /**
     * Brings one mascot ("me" or "partner") up to date on disk.
     *
     * Sends the ETag of the copy it already has, so an unchanged picture is a
     * 304 and costs nothing on the half-hourly refresh. A 404 means they have
     * no mascot (or removed it), so the copy is deleted and the placeholder
     * shows. Anything else — offline, a server error — keeps what is there.
     * Blocking: callers are already off the main thread.
     */
    fun fetchMascot(context: Context, who: String) {
        val (apiUrl, token) = credentials(context) ?: return
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val etagKey = "mascotEtag_$who"
        val file = mascotFile(context, who)
        var connection: HttpURLConnection? = null
        try {
            connection = (URL("$apiUrl/widget/mascot/$who").openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                setRequestProperty("X-Widget-Token", token)
                if (file.exists()) prefs.getString(etagKey, null)?.let { setRequestProperty("If-None-Match", it) }
                connectTimeout = CONNECT_TIMEOUT_MS
                readTimeout = READ_TIMEOUT_MS
            }
            when (connection.responseCode) {
                304 -> return
                404 -> {
                    file.delete()
                    prefs.edit().remove(etagKey).apply()
                }
                200 -> {
                    val bytes = connection.inputStream.use { it.readBytes() }
                    val bitmap = decodeBounded(bytes, MASCOT_MAX_PX) ?: return
                    file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
                    prefs.edit().putString(etagKey, connection.getHeaderField("ETag")).apply()
                }
            }
        } catch (e: Exception) {
            // Keep whatever is cached.
        } finally {
            connection?.disconnect()
        }
    }

    /** The cached mascot for "me" or "partner", or null for the placeholder. */
    fun mascot(context: Context, who: String): Bitmap? {
        val file = mascotFile(context, who)
        return if (file.exists()) BitmapFactory.decodeFile(file.path) else null
    }

    /** Decodes no bigger than needed, then scales so the longest side is maxPx. */
    private fun decodeBounded(bytes: ByteArray, maxPx: Int): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxPx) sample *= 2
        val decoded = BitmapFactory.decodeByteArray(
            bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample }
        ) ?: return null
        val longest = maxOf(decoded.width, decoded.height)
        if (longest <= maxPx) return decoded
        val scale = maxPx.toFloat() / longest
        return Bitmap.createScaledBitmap(
            decoded, (decoded.width * scale).toInt().coerceAtLeast(1),
            (decoded.height * scale).toInt().coerceAtLeast(1), true
        )
    }

    /**
     * Sends a kiss. The one write a widget can perform.
     *
     * Returns true only when the server actually recorded one; a throttled
     * press (the pocket case) comes back false so the widget can say nothing
     * rather than claim it sent something it did not.
     */
    fun sendKiss(context: Context): Boolean {
        val (apiUrl, token) = credentials(context) ?: return false
        var connection: HttpURLConnection? = null
        return try {
            connection = (URL("$apiUrl/widget/kiss").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                setRequestProperty("X-Widget-Token", token)
                setRequestProperty("Content-Type", "application/json")
                doOutput = true
                connectTimeout = CONNECT_TIMEOUT_MS
                readTimeout = READ_TIMEOUT_MS
            }
            connection.outputStream.use { it.write("{\"kind\":\"kiss\"}".toByteArray()) }
            if (connection.responseCode !in 200..201) return false
            val body = connection.inputStream.bufferedReader().use { it.readText() }
            JSONObject(body).optBoolean("sent", false)
        } catch (e: Exception) {
            false
        } finally {
            connection?.disconnect()
        }
    }

    /** The newest drawing, already thinned by the server to a tile's worth. */
    fun fetchDrawing(context: Context): Drawing? {
        val (apiUrl, token) = credentials(context) ?: return null
        var connection: HttpURLConnection? = null
        return try {
            connection = (URL("$apiUrl/widget/drawing").openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                setRequestProperty("X-Widget-Token", token)
                setRequestProperty("Accept", "application/json")
                connectTimeout = CONNECT_TIMEOUT_MS
                readTimeout = READ_TIMEOUT_MS
            }
            if (connection.responseCode != 200) return null
            val body = connection.inputStream.bufferedReader().use { it.readText() }
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString(KEY_DRAWING, body).apply()
            parseDrawing(body)
        } catch (e: Exception) {
            null
        } finally {
            connection?.disconnect()
        }
    }

    fun cachedDrawing(context: Context): Drawing? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_DRAWING, null)?.let { parseDrawing(it) }

    private fun parseColor(hex: String?, fallback: Int): Int = try {
        if (hex.isNullOrBlank()) fallback else Color.parseColor(hex)
    } catch (e: Exception) {
        fallback
    }

    private fun parseDrawing(raw: String): Drawing? = try {
        val root = JSONObject(raw).optJSONObject("drawing")
        if (root == null) null else {
            val strokesJson: JSONArray = root.optJSONArray("strokes") ?: JSONArray()
            val strokes = ArrayList<Stroke>(strokesJson.length())
            for (i in 0 until strokesJson.length()) {
                val st = strokesJson.optJSONObject(i) ?: continue
                val pts = st.optJSONArray("points") ?: continue
                val flat = FloatArray(pts.length() * 2)
                for (j in 0 until pts.length()) {
                    val p = pts.optJSONObject(j) ?: continue
                    flat[j * 2] = p.optDouble("x", 0.0).toFloat()
                    flat[j * 2 + 1] = p.optDouble("y", 0.0).toFloat()
                }
                strokes.add(
                    Stroke(
                        points = flat,
                        color = parseColor(st.optStringOrNull("color"), Color.BLACK),
                        width = st.optDouble("width", 6.0).toFloat(),
                        tool = st.optStringOrNull("tool") ?: "pen"
                    )
                )
            }
            Drawing(
                title = root.optStringOrNull("title"),
                canvasColor = parseColor(root.optStringOrNull("canvasColor"), Color.WHITE),
                strokes = strokes
            )
        }
    } catch (e: Exception) {
        null
    }

    /**
     * Paints a drawing into a bitmap the widget can show.
     *
     * RemoteViews has no vector anything, so the strokes have to become
     * pixels somewhere, and doing it here rather than server-side means no
     * image storage and a drawing that re-renders crisply at whatever size
     * the person resizes the widget to.
     *
     * The drawing is scaled to fit rather than cropped: a widget tile is the
     * one place where showing the middle of somebody's drawing and cutting
     * off the rest would be worse than empty margins.
     */
    fun renderDrawing(drawing: Drawing, widthPx: Int, heightPx: Int): Bitmap? {
        if (widthPx <= 0 || heightPx <= 0) return null

        var minX = Float.MAX_VALUE; var minY = Float.MAX_VALUE
        var maxX = -Float.MAX_VALUE; var maxY = -Float.MAX_VALUE
        var widest = 1f
        for (stroke in drawing.strokes) {
            widest = maxOf(widest, stroke.width)
            var i = 0
            while (i < stroke.points.size) {
                val x = stroke.points[i]; val y = stroke.points[i + 1]
                if (x < minX) minX = x
                if (y < minY) minY = y
                if (x > maxX) maxX = x
                if (y > maxY) maxY = y
                i += 2
            }
        }
        val bitmap = Bitmap.createBitmap(widthPx, heightPx, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(drawing.canvasColor)
        if (minX > maxX) return bitmap   // nothing drawable, but the paper is right

        // A path's coordinates are its centre line, so the box has to grow by
        // the widest brush or a stroke on the edge is sliced lengthways.
        val pad = widest
        val boxW = maxOf(maxX - minX, 1f) + pad * 2
        val boxH = maxOf(maxY - minY, 1f) + pad * 2
        val scale = minOf(widthPx / boxW, heightPx / boxH)

        canvas.save()
        canvas.translate(
            (widthPx - boxW * scale) / 2f - (minX - pad) * scale,
            (heightPx - boxH * scale) / 2f - (minY - pad) * scale
        )
        canvas.scale(scale, scale)

        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        }
        for (stroke in drawing.strokes) {
            if (stroke.points.size < 2) continue
            // An eraser paints IN the canvas colour rather than removing
            // pixels — same as the app, and the only way that works when the
            // strokes are replayed in order onto opaque paper.
            paint.color = if (stroke.tool == "eraser") drawing.canvasColor else stroke.color
            paint.alpha = if (stroke.tool == "highlighter") 110 else 255
            paint.strokeWidth = stroke.width
            val path = Path()
            path.moveTo(stroke.points[0], stroke.points[1])
            var i = 2
            while (i < stroke.points.size) {
                path.lineTo(stroke.points[i], stroke.points[i + 1])
                i += 2
            }
            // A one-point stroke is a dot, and a Path with no line in it
            // draws nothing at all.
            if (stroke.points.size == 2) {
                canvas.drawPoint(stroke.points[0], stroke.points[1], Paint(paint).apply {
                    strokeCap = Paint.Cap.ROUND
                })
            } else {
                canvas.drawPath(path, paint)
            }
        }
        canvas.restore()
        return bitmap
    }

    private fun parse(raw: String, stale: Boolean): Summary? = try {
        val json = JSONObject(raw)
        val countdown = json.optJSONObject("nextCountdown")
        val nextDate = json.optJSONObject("nextDate")
        Summary(
            paired = json.optBoolean("paired", false),
            streakCount = json.optInt("streakCount", 0),
            promptAnsweredToday = json.optBoolean("promptAnsweredToday", false),
            countdownLabel = countdown?.optString("label"),
            countdownDays = countdown?.optInt("daysRemaining"),
            distanceKm = if (json.isNull("distanceKm")) null else json.optDouble("distanceKm"),
            distanceStatus = json.optStringOrNull("distanceStatus"),
            partnerInitial = json.optStringOrNull("partnerInitial"),
            myArt = json.optStringOrNull("myArt"),
            partnerArt = json.optStringOrNull("partnerArt"),
            myMoodEmoji = json.optStringOrNull("myMoodEmoji"),
            partnerMoodEmoji = json.optStringOrNull("partnerMoodEmoji"),
            mySymptomEmoji = json.optStringList("mySymptomEmoji"),
            partnerSymptomEmoji = json.optStringList("partnerSymptomEmoji"),
            hasPhoto = !json.isNull("latestPhotoUrl"),
            partnerCyclePhase = if (json.isNull("partnerCyclePhase")) null else json.optString("partnerCyclePhase"),
            partnerNextPeriodDate = if (json.isNull("partnerNextPeriodDate")) null else json.optString("partnerNextPeriodDate"),
            daysTogether = if (json.isNull("daysTogether")) null else json.optInt("daysTogether"),
            togetherSince = json.optStringOrNull("togetherSince"),
            partnerMood = json.optStringOrNull("partnerMood"),
            partnerMoodNote = json.optStringOrNull("partnerMoodNote"),
            todaysQuestion = json.optStringOrNull("todaysQuestion"),
            nextDateTitle = nextDate?.optStringOrNull("title"),
            nextDateDays = if (nextDate == null || nextDate.isNull("daysUntil")) null else nextDate.optInt("daysUntil"),
            sealedNoteWaiting = json.optBoolean("sealedNoteWaiting", false),
            latestNote = json.optStringOrNull("latestNote"),
            unseenKisses = json.optInt("unseenKisses", 0),
            lastKissFromPartnerAt = json.optStringOrNull("lastKissFromPartnerAt"),
            lastKissSentAt = json.optStringOrNull("lastKissSentAt"),
            latestDrawingAt = json.optStringOrNull("latestDrawingAt"),
            latestDrawingTitle = json.optStringOrNull("latestDrawingTitle"),
            stale = stale
        )
    } catch (e: Exception) {
        null
    }
}
