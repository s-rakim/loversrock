// Minimal stand-ins for androidx.core, which is published only to Google's
// Maven (unreachable here). Signatures mirror the real API so that misuse in
// our code is still a compile error.
package androidx.core.app

import android.app.Notification
import android.app.PendingIntent
import android.content.Context

class NotificationCompat {
    class Builder(context: Context, channelId: String) {
        fun setSmallIcon(icon: Int): Builder = this
        fun setContentTitle(title: CharSequence?): Builder = this
        fun setContentText(text: CharSequence?): Builder = this
        fun setStyle(style: Style?): Builder = this
        fun setOngoing(ongoing: Boolean): Builder = this
        fun setSilent(silent: Boolean): Builder = this
        fun setOnlyAlertOnce(only: Boolean): Builder = this
        fun setShowWhen(show: Boolean): Builder = this
        fun setPriority(pri: Int): Builder = this
        fun setVisibility(visibility: Int): Builder = this
        fun setCategory(category: String?): Builder = this
        fun setContentIntent(intent: PendingIntent?): Builder = this
        fun setAutoCancel(autoCancel: Boolean): Builder = this
        fun addExtras(extras: android.os.Bundle?): Builder = this
        fun build(): Notification = throw UnsupportedOperationException()
    }
    abstract class Style
    class BigTextStyle : Style() {
        fun bigText(text: CharSequence?): BigTextStyle = this
    }
    companion object {
        const val PRIORITY_LOW = -1
        const val PRIORITY_MIN = -2
        const val PRIORITY_DEFAULT = 0
        const val VISIBILITY_PUBLIC = 1
        const val VISIBILITY_PRIVATE = 0
        const val CATEGORY_STATUS = "status"
    }
}

class NotificationManagerCompat private constructor() {
    fun notify(id: Int, notification: Notification) {}
    fun cancel(id: Int) {}
    fun areNotificationsEnabled(): Boolean = true
    companion object {
        @JvmStatic fun from(context: Context): NotificationManagerCompat = NotificationManagerCompat()
    }
}
