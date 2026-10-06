package com.loversrock.app.voice

import android.app.Activity
import android.app.PictureInPictureParams
import android.content.pm.PackageManager
import android.os.Build
import android.util.Rational

/**
 * Picture in picture for calls: the call shrinks to a small window over
 * whatever you open next, the way WhatsApp's does, instead of disappearing.
 *
 * Two ways in: the minimise button on the call screen (enter), and leaving
 * the app mid video call (auto). Android 12+ does the second itself once
 * auto-enter is set on the activity; Android 8-11 needs MainActivity's
 * onUserLeaveHint, which the withPictureInPicture plugin adds and which
 * calls onUserLeaveHint here.
 *
 * The app sees the small window as the screen getting small, and the call
 * screen draws just the picture (CallScreen.js).
 */
object PictureInPicture {
    @Volatile
    var auto = false

    fun supported(activity: Activity?): Boolean =
        activity != null && Build.VERSION.SDK_INT >= 26 &&
            activity.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)

    private fun params(autoEnter: Boolean): PictureInPictureParams? {
        if (Build.VERSION.SDK_INT < 26) return null
        val builder = PictureInPictureParams.Builder().setAspectRatio(Rational(9, 16))
        if (Build.VERSION.SDK_INT >= 31) {
            builder.setAutoEnterEnabled(autoEnter)
            builder.setSeamlessResizeEnabled(true)
        }
        return builder.build()
    }

    /** Shrink into the small window now. False where the phone cannot. */
    fun enter(activity: Activity?): Boolean {
        if (!supported(activity) || Build.VERSION.SDK_INT < 26) return false
        return try {
            activity!!.enterPictureInPictureMode(params(auto)!!)
        } catch (e: Exception) {
            false
        }
    }

    /** Whether leaving the app mid-call shrinks it rather than hiding it. */
    fun setAuto(activity: Activity?, enabled: Boolean) {
        auto = enabled
        if (!supported(activity) || Build.VERSION.SDK_INT < 26) return
        try {
            activity!!.setPictureInPictureParams(params(enabled)!!)
        } catch (e: Exception) {
            // Not allowed on this phone: the call simply hides as before.
        }
    }

    /** From MainActivity.onUserLeaveHint: Android 8-11's auto-enter. */
    @JvmStatic
    fun onUserLeaveHint(activity: Activity) {
        if (auto && Build.VERSION.SDK_INT in 26..30) enter(activity)
    }
}
