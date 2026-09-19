import Foundation
import WidgetKit

/// Writes the scoped widget credentials into the shared App Group container so
/// the widget extension (a separate process) can read them. The account's
/// access/refresh tokens are never shared — only the read-only widget token.
@objc(WidgetBridge)
class WidgetBridge: NSObject {

    private var defaults: UserDefaults? { UserDefaults(suiteName: WidgetDataLoader.appGroup) }

    @objc static func requiresMainQueueSetup() -> Bool { false }

    @objc(setCredentials:widgetToken:resolver:rejecter:)
    func setCredentials(
        _ apiUrl: String,
        widgetToken: String,
        resolver resolve: RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        guard let defaults else {
            reject("WIDGET_BRIDGE_NO_APP_GROUP", "App Group \(WidgetDataLoader.appGroup) is not configured", nil)
            return
        }
        defaults.set(apiUrl, forKey: "apiUrl")
        defaults.set(widgetToken, forKey: "widgetToken")
        WidgetCenter.shared.reloadAllTimelines()
        resolve(true)
    }

    @objc(clearCredentials:rejecter:)
    func clearCredentials(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        defaults?.removeObject(forKey: "apiUrl")
        defaults?.removeObject(forKey: "widgetToken")
        defaults?.removeObject(forKey: "cachedSummary")
        WidgetCenter.shared.reloadAllTimelines()
        resolve(true)
    }

    @objc(refresh:rejecter:)
    func refresh(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        WidgetCenter.shared.reloadAllTimelines()
        resolve(true)
    }

    /// iOS has real lock screen widgets, so there is no notification fallback
    /// to toggle here — this exists only so the JS API is identical on both
    /// platforms.
    @objc(setLockScreenEnabled:resolver:rejecter:)
    func setLockScreenEnabled(
        _ enabled: Bool,
        resolver resolve: RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        WidgetCenter.shared.reloadAllTimelines()
        resolve(true)
    }
}
