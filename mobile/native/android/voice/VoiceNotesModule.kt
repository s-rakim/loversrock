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
import org.json.JSONObject

/**
 * The JS side's handle on the voice-note service: it tells the service where
 * the server is and how loud to be, ahead of any push, and hands it notes
 * that arrive over the socket while the app is open.
 */
class VoiceNotesModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "VoiceNotes"

    /** A call arrived over the socket with the app open: ring like a phone. */
    @ReactMethod
    fun ringIncoming(callId: String, from: String, kind: String, promise: Promise) {
        CallRinger.ring(reactContext, callId, from, kind)
        promise.resolve(true)
    }

    /** Answered, declined or hung up: stop ringing. */
    @ReactMethod
    fun stopRinging(callId: String?, promise: Promise) {
        CallRinger.stop(reactContext, callId)
        promise.resolve(true)
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
