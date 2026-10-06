package com.loversrock.app.voice

import android.view.View
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ReactShadowNode
import com.facebook.react.uimanager.ViewManager
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import org.json.JSONObject

/**
 * The JS side's handle on the voice-note service: it tells the service where
 * the server is and how loud to be, ahead of any push, and hands it notes
 * that arrive over the socket while the app is open.
 */
class VoiceNotesModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "VoiceNotes"

    companion object {
        // Where each phone maker keeps its "allowed to start in the
        // background" list. A phone that has none of these gets the app's
        // own settings page instead.
        val AUTOSTART = listOf(
            "com.coloros.safecenter" to "com.coloros.safecenter.permission.startup.StartupAppListActivity",
            "com.coloros.safecenter" to "com.coloros.safecenter.startupapp.StartupAppListActivity",
            "com.oplus.safecenter" to "com.oplus.safecenter.permission.startup.StartupAppListActivity",
            "com.oppo.safe" to "com.oppo.safe.permission.startup.StartupAppListActivity",
            "com.coloros.oppoguardelf" to "com.coloros.powermanager.fuelgaue.PowerUsageModelActivity",
            "com.miui.securitycenter" to "com.miui.permcenter.autostart.AutoStartManagementActivity",
            "com.vivo.permissionmanager" to "com.vivo.permissionmanager.activity.BgStartUpManagerActivity",
            "com.huawei.systemmanager" to "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity",
            "com.samsung.android.lool" to "com.samsung.android.sm.battery.ui.BatteryActivity",
        )
    }

    /** A call arrived over the socket with the app open: ring like a phone. */
    @ReactMethod
    fun ringIncoming(callId: String, from: String, kind: String, promise: Promise) {
        CallRinger.ring(reactContext, callId, from, kind)
        promise.resolve(true)
    }

    /**
     * A call is live: keep the microphone (and camera) working with the app
     * off screen, and show it as an ongoing call (CallService).
     */
    @ReactMethod
    fun startCallService(callId: String, from: String, kind: String, promise: Promise) {
        try {
            CallService.start(reactContext, callId, from, kind)
            promise.resolve(true)
        } catch (e: Exception) {
            // Refused while in the background (Android 12+): the call goes on.
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun stopCallService(promise: Promise) {
        CallService.stop(reactContext)
        promise.resolve(true)
    }

    /** Answered, declined or hung up: stop ringing. */
    @ReactMethod
    fun stopRinging(callId: String?, promise: Promise) {
        CallRinger.stop(reactContext, callId)
        promise.resolve(true)
    }

    /**
     * Whether a call can ring this phone with the app closed: the things a
     * phone can switch off that stop it (Settings → Calls when the app is
     * closed). Instagram and WhatsApp are on the phone makers' allow lists;
     * loversrock is not, so these are switched on by hand, once.
     */
    @ReactMethod
    fun callReadiness(promise: Promise) {
        try {
            val nm = reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val pm = reactContext.getSystemService(Context.POWER_SERVICE) as PowerManager
            CallRinger.ensureChannel(reactContext)
            val channelOn = if (Build.VERSION.SDK_INT >= 26) {
                (nm.getNotificationChannel(CallRinger.CHANNEL)?.importance ?: NotificationManager.IMPORTANCE_HIGH) != NotificationManager.IMPORTANCE_NONE
            } else true
            val json = JSONObject()
                .put("notifications", if (Build.VERSION.SDK_INT >= 24) nm.areNotificationsEnabled() else true)
                .put("ringChannel", channelOn)
                .put("battery", if (Build.VERSION.SDK_INT >= 23) pm.isIgnoringBatteryOptimizations(reactContext.packageName) else true)
                .put("fullScreen", if (Build.VERSION.SDK_INT >= 34) nm.canUseFullScreenIntent() else true)
                .put("manufacturer", Build.MANUFACTURER ?: "")
                .put("sdk", Build.VERSION.SDK_INT)
            promise.resolve(json.toString())
        } catch (e: Exception) {
            promise.reject("CALL_READINESS_FAILED", e)
        }
    }

    /**
     * Opens the screen that fixes one of them: "notifications", "battery",
     * "fullscreen", or "autostart" (the phone maker's own auto-launch list,
     * ColorOS, MIUI and the like, falling back to the app's settings page).
     */
    @ReactMethod
    fun openCallSetting(which: String, promise: Promise) {
        val pkg = reactContext.packageName
        val candidates = mutableListOf<Intent>()
        when (which) {
            "notifications" -> if (Build.VERSION.SDK_INT >= 26) {
                candidates.add(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg))
            }
            "battery" -> if (Build.VERSION.SDK_INT >= 23) {
                candidates.add(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$pkg")))
                candidates.add(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            }
            "fullscreen" -> if (Build.VERSION.SDK_INT >= 34) {
                candidates.add(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:$pkg")))
            }
            "autostart" -> AUTOSTART.forEach { (p, c) -> candidates.add(Intent().setComponent(ComponentName(p, c))) }
        }
        candidates.add(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$pkg")))
        for (intent in candidates) {
            try {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                reactContext.startActivity(intent)
                promise.resolve(which)
                return
            } catch (e: Exception) {
                // Not on this phone: try the next.
            }
        }
        promise.resolve("none")
    }

    @ReactMethod
    fun setApiUrl(url: String, promise: Promise) {
        VoicePrefs.setApiUrl(reactContext, url)
        promise.resolve(true)
    }

    @ReactMethod
    fun getSettings(promise: Promise) {
        val json = JSONObject()
            .put("autoPlay", VoicePrefs.autoPlay(reactContext))
            .put("whenSilent", VoicePrefs.whenSilent(reactContext))
        promise.resolve(json.toString())
    }

    @ReactMethod
    fun setSettings(autoPlay: Boolean, whenSilent: Boolean, promise: Promise) {
        VoicePrefs.setSettings(reactContext, autoPlay, whenSilent)
        promise.resolve(true)
    }

    /** A note the open app heard about first. Same rules as a push; plays once. */
    @ReactMethod
    fun receive(voiceId: String, url: String, from: String, promise: Promise) {
        try {
            VoiceIncoming.handle(reactContext, voiceId, url, from)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("VOICE_RECEIVE_FAILED", e)
        }
    }

    /** Stops whatever is playing — the app is about to play something itself. */
    @ReactMethod
    fun stop(promise: Promise) {
        try {
            val intent = android.content.Intent(reactContext, VoicePlaybackService::class.java)
                .setAction(VoicePlaybackService.ACTION_STOP)
            reactContext.startService(intent)
        } catch (e: Exception) {
            // Nothing was playing.
        }
        promise.resolve(true)
    }
}

class VoiceNotesPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(VoiceNotesModule(reactContext))

    override fun createViewManagers(
        reactContext: ReactApplicationContext
    ): List<ViewManager<View, ReactShadowNode<*>>> = emptyList()
}
