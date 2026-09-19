// Minimal stand-ins for the React Native bridge classes. The real artifact
// resolves through repo.reactnative.dev, which is unreachable here.
package com.facebook.react.bridge

import android.content.Context

interface NativeModule { fun getName(): String }

open class ReactApplicationContext(base: Context?) : android.content.ContextWrapper(base)

abstract class ReactContextBaseJavaModule(reactContext: ReactApplicationContext?) : NativeModule {
    abstract override fun getName(): String
}

interface Promise {
    fun resolve(value: Any?)
    fun reject(code: String, message: String?)
    fun reject(code: String, throwable: Throwable?)
    fun reject(throwable: Throwable)
}

@Target(AnnotationTarget.FUNCTION)
@Retention(AnnotationRetention.RUNTIME)
annotation class ReactMethod(val isBlockingSynchronousMethod: Boolean = false)
