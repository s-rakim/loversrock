package com.facebook.react

import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ReactShadowNode
import com.facebook.react.uimanager.ViewManager

interface ReactPackage {
    fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule>
    fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>>
}
