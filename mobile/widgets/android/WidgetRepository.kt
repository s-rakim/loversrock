package com.loversrock.app.widgets

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

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

    private const val CONNECT_TIMEOUT_MS = 8000
    private const val READ_TIMEOUT_MS = 8000

    data class Summary(
        val paired: Boolean,
        val streakCount: Int,
        val promptAnsweredToday: Boolean,
        val countdownLabel: String?,
        val countdownDays: Int?,
        val distanceKm: Double?,
        val hasPhoto: Boolean,
        val partnerCyclePhase: String?,
        val partnerNextPeriodDate: String?,
        val stale: Boolean
    )

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

            parse(body, stale = false)
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

    private fun parse(raw: String, stale: Boolean): Summary? = try {
        val json = JSONObject(raw)
        val countdown = json.optJSONObject("nextCountdown")
        Summary(
            paired = json.optBoolean("paired", false),
            streakCount = json.optInt("streakCount", 0),
            promptAnsweredToday = json.optBoolean("promptAnsweredToday", false),
            countdownLabel = countdown?.optString("label"),
            countdownDays = countdown?.optInt("daysRemaining"),
            distanceKm = if (json.isNull("distanceKm")) null else json.optDouble("distanceKm"),
            hasPhoto = !json.isNull("latestPhotoUrl"),
            partnerCyclePhase = if (json.isNull("partnerCyclePhase")) null else json.optString("partnerCyclePhase"),
            partnerNextPeriodDate = if (json.isNull("partnerNextPeriodDate")) null else json.optString("partnerNextPeriodDate"),
            stale = stale
        )
    } catch (e: Exception) {
        null
    }
}
