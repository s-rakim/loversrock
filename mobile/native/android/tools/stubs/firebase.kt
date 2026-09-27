// Stand-ins for firebase-messaging and expo-notifications, which publish only
// to Maven repos this check cannot reach. Their shapes mirror the real ones:
// FirebaseMessagingService is a Service with open onMessageReceived/onNewToken,
// RemoteMessage exposes getData() as a Map<String, String>, and
// expo-notifications' ExpoFirebaseMessagingService is an OPEN subclass whose
// onMessageReceived is an overridable override (see its source in
// node_modules/expo-notifications/android/.../ExpoFirebaseMessagingService.kt).
package com.google.firebase.messaging

open class RemoteMessage {
    open fun getData(): Map<String, String> = emptyMap()
}

abstract class FirebaseMessagingService : android.app.Service() {
    open fun onMessageReceived(message: RemoteMessage) {}
    open fun onNewToken(token: String) {}
    override fun onBind(intent: android.content.Intent?): android.os.IBinder? = null
}
