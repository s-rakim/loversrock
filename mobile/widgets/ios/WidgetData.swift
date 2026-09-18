import Foundation

/// Mirrors GET /widget/summary. Every field is optional because a widget must
/// render something sensible even when unpaired, offline, or newly installed.
struct WidgetSummary: Codable {
    let paired: Bool
    let streakCount: Int
    let promptAnsweredToday: Bool
    let nextCountdown: Countdown?
    let distanceKm: Double?
    let latestPhotoUrl: String?
    let partnerCyclePhase: String?
    let partnerNextPeriodDate: String?

    struct Countdown: Codable {
        let label: String
        let daysRemaining: Int
    }

    static let placeholder = WidgetSummary(
        paired: true,
        streakCount: 12,
        promptAnsweredToday: false,
        nextCountdown: Countdown(label: "Anniversary", daysRemaining: 24),
        distanceKm: 8.2,
        latestPhotoUrl: nil,
        partnerCyclePhase: "luteal",
        partnerNextPeriodDate: nil
    )

    static let signedOut = WidgetSummary(
        paired: false, streakCount: 0, promptAnsweredToday: false, nextCountdown: nil,
        distanceKm: nil, latestPhotoUrl: nil, partnerCyclePhase: nil, partnerNextPeriodDate: nil
    )
}

enum WidgetDataLoader {
    /// Must match the App Group configured on both the app and the extension.
    static let appGroup = "group.com.loversrock.app"

    private static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }

    static var credentials: (apiUrl: String, token: String)? {
        guard let defaults,
              let url = defaults.string(forKey: "apiUrl"),
              let token = defaults.string(forKey: "widgetToken"),
              !url.isEmpty, !token.isEmpty
        else { return nil }
        return (url.hasSuffix("/") ? String(url.dropLast()) : url, token)
    }

    /// Last good payload, so the widget paints instantly before the network returns.
    static var cached: WidgetSummary? {
        guard let data = defaults?.data(forKey: "cachedSummary") else { return nil }
        return try? JSONDecoder().decode(WidgetSummary.self, from: data)
    }

    static func fetch() async -> WidgetSummary? {
        guard let creds = credentials,
              let url = URL(string: "\(creds.apiUrl)/widget/summary")
        else { return nil }

        var request = URLRequest(url: url)
        request.setValue(creds.token, forHTTPHeaderField: "X-Widget-Token")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 10

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
            let summary = try JSONDecoder().decode(WidgetSummary.self, from: data)
            defaults?.set(data, forKey: "cachedSummary")
            return summary
        } catch {
            return nil
        }
    }

    static func fetchPhoto() async -> Data? {
        guard let creds = credentials,
              let url = URL(string: "\(creds.apiUrl)/widget/photo?token=\(creds.token)")
        else { return nil }
        var request = URLRequest(url: url)
        request.timeoutInterval = 10
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200
        else { return nil }
        return data
    }
}
