package com.loversrock.app.widgets

import android.content.Context
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * The widget runs in its own process and cannot read expo-secure-store, so the
 * JS side hands it credentials through SharedPreferences. Only the API URL and
 * the scoped read-only widget token are shared — never the account's access or
 * refresh token.
 */
class WidgetBridgeModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "WidgetBridge"

    private fun prefs() =
        reactContext.getSharedPreferences(WidgetRepository.PREFS, Context.MODE_PRIVATE)

    @ReactMethod
    fun setCredentials(apiUrl: String, widgetToken: String, promise: Promise) {
        try {
            prefs().edit()
                .putString("apiUrl", apiUrl)
                .putString("widgetToken", widgetToken)
                .apply()
            refreshWidgets()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("WIDGET_BRIDGE_WRITE_FAILED", e)
        }
    }

    /** Called on logout/unlink so the widget stops showing a stale couple's data. */
    @ReactMethod
    fun clearCredentials(promise: Promise) {
        try {
            prefs().edit().clear().apply()
            refreshWidgets()
            LockScreenNotifier.cancel(reactContext)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("WIDGET_BRIDGE_CLEAR_FAILED", e)
        }
    }

    @ReactMethod
    fun refresh(promise: Promise) {
        refreshWidgets()
        Thread {
            val summary = WidgetRepository.fetch(reactContext)
            if (summary != null) LockScreenNotifier.show(reactContext, summary)
        }.start()
        promise.resolve(true)
    }

    /** The translucency slider in Settings: percent opaque, 20–100. */
    @ReactMethod
    fun setWidgetOpacity(percent: Int, promise: Promise) {
        try {
            GlassStyle.setOpacity(reactContext, percent)
            refreshWidgets()
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("WIDGET_OPACITY_FAILED", e)
        }
    }

    @ReactMethod
    fun setLockScreenEnabled(enabled: Boolean, promise: Promise) {
        prefs().edit().putBoolean("lockScreenEnabled", enabled).apply()
        if (!enabled) {
            LockScreenNotifier.cancel(reactContext)
            promise.resolve(true)
            return
        }
        Thread {
            val summary = WidgetRepository.fetch(reactContext) ?: WidgetRepository.cached(reactContext)
            if (summary != null) LockScreenNotifier.show(reactContext, summary)
        }.start()
        promise.resolve(true)
    }

    private fun refreshWidgets() {
        SummaryWidgetProvider.refreshAll(reactContext)
        PhotoWidgetProvider.refreshAll(reactContext)
        // The glance widgets had a refreshAll that nothing called, so they
        // only ever updated on the 30-minute timer or a tap. A distance widget
        // that ignores the location the app just sent is showing the wrong
        // number with confidence.
        GlanceWidgetProvider.refreshAll(
            reactContext,
            listOf(
                AnniversaryWidgetProvider::class.java,
                DailyQuestionWidgetProvider::class.java,
                NextDateWidgetProvider::class.java,
                SecretMessageWidgetProvider::class.java,
                KissWidgetProvider::class.java,
                CanvasWidgetProvider::class.java,
                DistanceWidgetProvider::class.java
            )
        )
    }
}
