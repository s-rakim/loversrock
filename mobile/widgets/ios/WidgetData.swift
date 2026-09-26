import Foundation

/// Mirrors GET /widget/summary. Every field is optional because a widget must
/// render something sensible even when unpaired, offline, or newly installed.
struct WidgetSummary: Codable {
    let paired: Bool
    let streakCount: Int
    let promptAnsweredToday: Bool
    let nextCountdown: Countdown?
    let distanceKm: Double?
    /// Why there is no number: "ok", "sharing_off" or "no_location".
    let distanceStatus: String?
    /// The letter in the partner's bubble on the distance widget.
    let partnerInitial: String?
    /// Which bundled full-body picture ("a" or "b") is you, and which is
    /// them. Decided by the server so both phones agree on who is who.
    let myArt: String?
    let partnerArt: String?
    /// Each of you as emoji: a mood, and up to three of today's symptoms.
    /// The server has already dropped anything that must never appear on a
    /// home screen, and the partner's symptoms unless they share them.
    let myMoodEmoji: String?
    let partnerMoodEmoji: String?
    let mySymptomEmoji: [String]?
    let partnerSymptomEmoji: [String]?
    let latestPhotoUrl: String?
    let partnerCyclePhase: String?
    let partnerNextPeriodDate: String?
    // Ambient presence: what the widgets exist to show without anything
    // being opened.
    let daysTogether: Int?
    let togetherSince: String?
    let partnerMood: String?
    let partnerMoodNote: String?
    let todaysQuestion: String?
    let nextDate: NextDate?
    // A sealed note is ANNOUNCED on a lock screen, never printed on one — so
    // there is a flag, and the body is simply not sent by the server.
    let sealedNoteWaiting: Bool?
    let latestNote: String?
    let unseenKisses: Int?
    let lastKissFromPartnerAt: String?
    let lastKissSentAt: String?
    let latestDrawingAt: String?
    let latestDrawingTitle: String?

    struct Countdown: Codable {
        let label: String
        let daysRemaining: Int
    }

    struct NextDate: Codable {
        let title: String
        let daysUntil: Int
    }

    static let placeholder = WidgetSummary(
        paired: true,
        streakCount: 12,
        promptAnsweredToday: false,
        nextCountdown: Countdown(label: "Anniversary", daysRemaining: 24),
        distanceKm: 8.2,
        distanceStatus: "ok",
        partnerInitial: "M",
        myArt: "a",
        partnerArt: "b",
        myMoodEmoji: "😴",
        partnerMoodEmoji: "🥰",
        mySymptomEmoji: ["🤕"],
        partnerSymptomEmoji: ["😖", "😪"],
        latestPhotoUrl: nil,
        partnerCyclePhase: "luteal",
        partnerNextPeriodDate: nil,
        daysTogether: 963,
        togetherSince: "2024-02-14",
        partnerMood: "loved",
        partnerMoodNote: "thinking of you",
        todaysQuestion: "What was the first thing you noticed about me?",
        nextDate: NextDate(title: "Rooftop dinner", daysUntil: 3),
        sealedNoteWaiting: true,
        latestNote: nil,
        unseenKisses: 1,
        lastKissFromPartnerAt: nil,
        lastKissSentAt: nil,
        latestDrawingAt: nil,
        latestDrawingTitle: "us at the beach"
    )

    static let signedOut = WidgetSummary(
        paired: false, streakCount: 0, promptAnsweredToday: false, nextCountdown: nil,
        distanceKm: nil, distanceStatus: nil, partnerInitial: nil,
        myArt: nil, partnerArt: nil, myMoodEmoji: nil, partnerMoodEmoji: nil,
        mySymptomEmoji: nil, partnerSymptomEmoji: nil,
        latestPhotoUrl: nil, partnerCyclePhase: nil, partnerNextPeriodDate: nil,
        daysTogether: nil, togetherSince: nil, partnerMood: nil, partnerMoodNote: nil,
        todaysQuestion: nil, nextDate: nil, sealedNoteWaiting: nil, latestNote: nil,
        unseenKisses: nil, lastKissFromPartnerAt: nil, lastKissSentAt: nil,
        latestDrawingAt: nil, latestDrawingTitle: nil
    )
}

/// One drawing, thinned by the server to something a tile can paint.
struct WidgetDrawing: Codable {
    let title: String?
    let canvasColor: String?
    let strokes: [Stroke]

    struct Stroke: Codable {
        let points: [Point]
        let color: String?
        let width: Double?
        let tool: String?
    }

    struct Point: Codable {
        let x: Double
        let y: Double
    }
}

private struct DrawingResponse: Codable {
    let drawing: WidgetDrawing?
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

    /// The newest drawing. A separate call from the summary on purpose — only
    /// one widget wants strokes, and the other six should not pay for them.
    static func fetchDrawing() async -> WidgetDrawing? {
        guard let creds = credentials,
              let url = URL(string: "\(creds.apiUrl)/widget/drawing")
        else { return nil }

        var request = URLRequest(url: url)
        request.setValue(creds.token, forHTTPHeaderField: "X-Widget-Token")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 10

        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let decoded = try? JSONDecoder().decode(DrawingResponse.self, from: data)
        else { return cachedDrawing }
        if let drawing = decoded.drawing { defaults?.set(data, forKey: "cachedDrawing") }
        return decoded.drawing
    }

    static var cachedDrawing: WidgetDrawing? {
        guard let data = defaults?.data(forKey: "cachedDrawing") else { return nil }
        return try? JSONDecoder().decode(DrawingResponse.self, from: data).drawing
    }

    /// Sends a kiss. The one write a widget can perform — see the note on
    /// POST /widget/kiss for why that is as far as it goes.
    @discardableResult
    static func sendKiss() async -> Bool {
        guard let creds = credentials,
              let url = URL(string: "\(creds.apiUrl)/widget/kiss")
        else { return false }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(creds.token, forHTTPHeaderField: "X-Widget-Token")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = "{\"kind\":\"kiss\"}".data(using: .utf8)
        request.timeoutInterval = 10

        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let code = (response as? HTTPURLResponse)?.statusCode, code == 200 || code == 201,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return false }
        // `sent: false` is a throttled press — the pocket case. Reporting it
        // as success would have the widget claim something it did not do.
        return json["sent"] as? Bool ?? false
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
