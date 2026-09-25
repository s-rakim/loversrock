import WidgetKit
import SwiftUI

// Candle-style glance widgets. They share the cached GET /widget/summary
// payload that WidgetDataLoader already fetches, decoded here into the extra
// fields (partner mood, days together, anniversary, next date, love note,
// secret flag, today's question). Each opens the app at the matching screen
// through a loversrock:// deep link.

private extension Color {
    static let mAccent = Color(red: 0.91, green: 0.38, blue: 0.48)
    static let mText = Color(red: 0.17, green: 0.14, blue: 0.13)
    static let mMuted = Color(red: 0.55, green: 0.50, blue: 0.47)
}

struct MomentSummary: Decodable {
    struct Mood: Decodable { let emoji: String; let text: String? }
    struct Anniversary: Decodable { let date: String; let daysRemaining: Int; let years: Int }
    struct NextDate: Decodable { let title: String; let daysRemaining: Int }
    struct Note: Decodable { let title: String?; let body: String }
    struct Countdown: Decodable { let label: String; let daysRemaining: Int }

    let paired: Bool
    let streakCount: Int
    let promptAnsweredToday: Bool
    let streakFreezes: Int?
    let partnerName: String?
    let partnerMood: Mood?
    let daysTogether: Int?
    let anniversary: Anniversary?
    let nextDate: NextDate?
    let latestNote: Note?
    let secretMessageWaiting: Bool?
    let todayQuestion: String?
    let nextCountdown: Countdown?
    let distanceKm: Double?

    static let preview = MomentSummary(
        paired: true, streakCount: 42, promptAnsweredToday: false, streakFreezes: 1, partnerName: "Amara",
        partnerMood: Mood(emoji: "🥰", text: "Thinking of you"), daysTogether: 1234,
        anniversary: Anniversary(date: "2026-02-14", daysRemaining: 142, years: 4),
        nextDate: NextDate(title: "Sunset picnic", daysRemaining: 3),
        latestNote: Note(title: nil, body: "Don't forget: dinner at 8, wear the blue shirt ❤️"),
        secretMessageWaiting: true, todayQuestion: "What's a small thing I do that makes your day?",
        nextCountdown: Countdown(label: "Trip to Lisbon", daysRemaining: 12), distanceKm: 8.4
    )
}

enum MomentLoader {
    static var cached: MomentSummary? {
        guard let data = UserDefaults(suiteName: WidgetDataLoader.appGroup)?.data(forKey: "cachedSummary") else { return nil }
        return try? JSONDecoder().decode(MomentSummary.self, from: data)
    }

    static func load() async -> MomentSummary? {
        _ = await WidgetDataLoader.fetch() // refreshes the shared cache
        return cached
    }
}

enum MomentKind: String, CaseIterable {
    case daysTogether, anniversary, streak, countdown, distance, partnerMood, nextDate, loveNote, secretMessage, dailyQuestion, quickKiss

    var displayName: String {
        switch self {
        case .daysTogether: return "Days together"
        case .anniversary: return "Anniversary"
        case .streak: return "Streak"
        case .countdown: return "Countdown"
        case .distance: return "Distance"
        case .partnerMood: return "Partner mood"
        case .nextDate: return "Next date"
        case .loveNote: return "Love note"
        case .secretMessage: return "Secret message"
        case .dailyQuestion: return "Daily question"
        case .quickKiss: return "Quick kiss"
        }
    }

    var deepLink: URL {
        let path: String
        switch self {
        case .daysTogether, .anniversary: path = "home"
        case .streak: path = "streak"
        case .countdown: path = "countdowns"
        case .distance: path = "distance"
        case .partnerMood: path = "mood"
        case .nextDate: path = "dates"
        case .loveNote: path = "notes"
        case .secretMessage: path = "secret"
        case .dailyQuestion: path = "question"
        case .quickKiss: path = "thumbkiss"
        }
        return URL(string: "loversrock://\(path)")!
    }

    /// Lock screen families for the ones that read well in a tiny space.
    var families: [WidgetFamily] {
        switch self {
        case .daysTogether, .anniversary, .streak, .partnerMood, .secretMessage, .countdown:
            return [.systemSmall, .accessoryCircular, .accessoryRectangular, .accessoryInline]
        case .loveNote, .dailyQuestion:
            return [.systemSmall, .systemMedium, .accessoryRectangular]
        case .quickKiss:
            return [.systemSmall, .accessoryCircular]
        default:
            return [.systemSmall, .accessoryRectangular]
        }
    }
}

struct MomentContent {
    let icon: String
    let value: String
    let label: String
    var sub: String = ""
    var long: Bool = false
}

func momentContent(_ kind: MomentKind, _ s: MomentSummary?, signedIn: Bool) -> MomentContent {
    if kind == .quickKiss { return MomentContent(icon: "💋", value: "Thumb Kiss", label: "Tap to connect") }
    guard signedIn else { return MomentContent(icon: "🕯️", value: "loversrock.", label: "Sign in to set up") }
    guard let s else { return MomentContent(icon: "🕯️", value: "loversrock.", label: "Open the app") }
    guard s.paired else { return MomentContent(icon: "💞", value: "Not paired", label: "Pair in the app") }
    let partner = s.partnerName ?? "Your partner"

    switch kind {
    case .daysTogether:
        return MomentContent(icon: "❤️", value: "\(s.daysTogether ?? 0)", label: "days together", sub: "with \(partner)")
    case .anniversary:
        guard let a = s.anniversary else { return MomentContent(icon: "💍", value: "—", label: "Set your anniversary") }
        return MomentContent(icon: "💍", value: a.daysRemaining == 0 ? "Today!" : "\(a.daysRemaining)d", label: "until our anniversary", sub: a.years > 0 ? "\(a.years) years" : "")
    case .streak:
        let sub = !s.promptAnsweredToday ? "Question waiting" : ((s.streakFreezes ?? 0) > 0 ? "❄️ \(s.streakFreezes ?? 0) banked" : "All caught up")
        return MomentContent(icon: "🔥", value: "\(s.streakCount)", label: "day streak", sub: sub)
    case .countdown:
        guard let c = s.nextCountdown else { return MomentContent(icon: "⏳", value: "—", label: "No countdown yet") }
        return MomentContent(icon: "⏳", value: "\(c.daysRemaining)d", label: c.label)
    case .distance:
        guard let km = s.distanceKm else { return MomentContent(icon: "📍", value: "—", label: "Sharing off") }
        return MomentContent(icon: "📍", value: km < 1 ? "<1 km" : "\(Int(km)) km", label: "apart", sub: "from \(partner)")
    case .partnerMood:
        guard let m = s.partnerMood else { return MomentContent(icon: "💭", value: partner, label: "hasn't set a mood") }
        return MomentContent(icon: m.emoji, value: partner, label: "is feeling", sub: m.text ?? "")
    case .nextDate:
        guard let d = s.nextDate else { return MomentContent(icon: "📅", value: "No date planned", label: "Swipe for ideas", long: true) }
        return MomentContent(icon: "📅", value: d.title, label: d.daysRemaining == 0 ? "today" : "in \(d.daysRemaining) days", long: true)
    case .loveNote:
        guard let n = s.latestNote else { return MomentContent(icon: "💌", value: "No notes yet", label: "from \(partner)", long: true) }
        return MomentContent(icon: "💌", value: n.body, label: "from \(partner)", sub: n.title ?? "", long: true)
    case .secretMessage:
        // Only ever that a secret exists — never its words.
        return (s.secretMessageWaiting ?? false)
            ? MomentContent(icon: "💌", value: "You have a message ❤️", label: "Tap to open", long: true)
            : MomentContent(icon: "🔒", value: "No new secrets", label: "Leave one for \(partner)", long: true)
    case .dailyQuestion:
        return MomentContent(icon: "💬", value: s.todayQuestion ?? "No question today", label: "Today's question", sub: s.promptAnsweredToday ? "Answered ✓" : "Tap to answer", long: true)
    case .quickKiss:
        return MomentContent(icon: "💋", value: "Thumb Kiss", label: "Tap to connect")
    }
}

struct MomentEntry: TimelineEntry {
    let date: Date
    let summary: MomentSummary?
    let signedIn: Bool
}

struct MomentProvider: TimelineProvider {
    func placeholder(in context: Context) -> MomentEntry { MomentEntry(date: Date(), summary: .preview, signedIn: true) }

    func getSnapshot(in context: Context, completion: @escaping (MomentEntry) -> Void) {
        if context.isPreview { completion(placeholder(in: context)); return }
        completion(MomentEntry(date: Date(), summary: MomentLoader.cached, signedIn: WidgetDataLoader.credentials != nil))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<MomentEntry>) -> Void) {
        Task {
            let summary = await MomentLoader.load()
            let entry = MomentEntry(date: Date(), summary: summary, signedIn: WidgetDataLoader.credentials != nil)
            let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date().addingTimeInterval(1800)
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }
}

struct MomentView: View {
    @Environment(\.widgetFamily) var family
    let kind: MomentKind
    let entry: MomentEntry

    var body: some View {
        let c = momentContent(kind, entry.summary, signedIn: entry.signedIn)
        Group {
            switch family {
            case .accessoryInline:
                Text("\(c.icon) \(c.value) \(c.long ? "" : c.label)")
            case .accessoryCircular:
                ZStack {
                    AccessoryWidgetBackground()
                    VStack(spacing: 0) {
                        Text(c.icon).font(.caption2)
                        Text(c.long ? "•" : c.value).font(.system(size: 14, weight: .bold)).minimumScaleFactor(0.5).lineLimit(1)
                    }
                }
            case .accessoryRectangular:
                VStack(alignment: .leading, spacing: 1) {
                    Text("\(c.icon) \(c.long ? c.label : c.value)").font(.headline).lineLimit(1)
                    Text(c.long ? c.value : c.label).font(.caption2).lineLimit(2)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            default:
                VStack(spacing: 4) {
                    Text(c.icon).font(.system(size: 28))
                    Text(c.value)
                        .font(c.long ? .system(size: 14, weight: .semibold) : .system(size: 28, weight: .bold))
                        .foregroundColor(c.long ? .mText : .mAccent)
                        .multilineTextAlignment(.center)
                        .lineLimit(c.long ? 4 : 1)
                        .minimumScaleFactor(0.6)
                    Text(c.label).font(.caption).foregroundColor(.mText).lineLimit(2).multilineTextAlignment(.center)
                    if !c.sub.isEmpty { Text(c.sub).font(.caption2).foregroundColor(.mMuted).lineLimit(1) }
                }
                .padding(10)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .widgetURL(kind.deepLink)
    }
}

private func momentConfiguration(_ kind: MomentKind) -> some WidgetConfiguration {
    StaticConfiguration(kind: "LoversRockMoment.\(kind.rawValue)", provider: MomentProvider()) { entry in
        if #available(iOS 17.0, *) {
            MomentView(kind: kind, entry: entry).containerBackground(.background, for: .widget)
        } else {
            MomentView(kind: kind, entry: entry)
        }
    }
    .configurationDisplayName(kind.displayName)
    .description("loversrock — \(kind.displayName.lowercased())")
    .supportedFamilies(kind.families)
}

struct DaysTogetherWidget: Widget { var body: some WidgetConfiguration { momentConfiguration(.daysTogether) } }
struct AnniversaryWidget: Widget { var body: some WidgetConfiguration { momentConfiguration(.anniversary) } }
struct StreakWidget: Widget { var body: some WidgetConfiguration { momentConfiguration(.streak) } }
struct CountdownWidget: Widget { var body: some WidgetConfiguration { momentConfiguration(.countdown) } }
struct DistanceWidget: Widget { var body: some WidgetConfiguration { momentConfiguration(.distance) } }
struct PartnerMoodWidget: Widget { var body: some WidgetConfiguration { momentConfiguration(.partnerMood) } }
struct NextDateWidget: Widget { var body: some WidgetConfiguration { momentConfiguration(.nextDate) } }
struct LoveNoteWidget: Widget { var body: some WidgetConfiguration { momentConfiguration(.loveNote) } }
struct SecretMessageWidget: Widget { var body: some WidgetConfiguration { momentConfiguration(.secretMessage) } }
struct DailyQuestionWidget: Widget { var body: some WidgetConfiguration { momentConfiguration(.dailyQuestion) } }
struct QuickKissWidget: Widget { var body: some WidgetConfiguration { momentConfiguration(.quickKiss) } }

// MARK: - Canvas widget: the shared drawing, rendered from vector strokes.

struct CanvasStroke: Decodable {
    struct Point: Decodable { let x: Double; let y: Double }
    let color: String?
    let width: Double?
    let tool: String?
    let points: [Point]
}

struct CanvasPayload: Decodable {
    let strokes: [CanvasStroke]
    let background: String
}

private func hexColor(_ hex: String?) -> Color {
    guard let hex, hex.hasPrefix("#"), hex.count >= 7, let v = Int(hex.dropFirst().prefix(6), radix: 16) else { return .mAccent }
    return Color(red: Double((v >> 16) & 255) / 255, green: Double((v >> 8) & 255) / 255, blue: Double(v & 255) / 255)
}

struct CanvasEntry: TimelineEntry {
    let date: Date
    let canvas: CanvasPayload?
}

struct CanvasProvider: TimelineProvider {
    func placeholder(in context: Context) -> CanvasEntry { CanvasEntry(date: Date(), canvas: nil) }
    func getSnapshot(in context: Context, completion: @escaping (CanvasEntry) -> Void) { completion(placeholder(in: context)) }

    func getTimeline(in context: Context, completion: @escaping (Timeline<CanvasEntry>) -> Void) {
        Task {
            var payload: CanvasPayload?
            if let creds = WidgetDataLoader.credentials, let url = URL(string: "\(creds.apiUrl)/widget/canvas") {
                var request = URLRequest(url: url)
                request.setValue(creds.token, forHTTPHeaderField: "X-Widget-Token")
                request.timeoutInterval = 10
                if let (data, response) = try? await URLSession.shared.data(for: request),
                   (response as? HTTPURLResponse)?.statusCode == 200 {
                    payload = try? JSONDecoder().decode(CanvasPayload.self, from: data)
                }
            }
            let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date().addingTimeInterval(1800)
            completion(Timeline(entries: [CanvasEntry(date: Date(), canvas: payload)], policy: .after(next)))
        }
    }
}

struct CanvasWidgetView: View {
    let entry: CanvasEntry
    var body: some View {
        Group {
            if let canvas = entry.canvas, !canvas.strokes.isEmpty {
                GeometryReader { geo in
                    // Keep the 3:4 page, centred.
                    let h = min(geo.size.height, geo.size.width * 4 / 3)
                    let w = h * 3 / 4
                    Canvas { ctx, _ in
                        ctx.fill(Path(CGRect(x: 0, y: 0, width: w, height: h)), with: .color(hexColor(canvas.background)))
                        for s in canvas.strokes {
                            var path = Path()
                            for (i, p) in s.points.enumerated() {
                                let pt = CGPoint(x: p.x * w, y: p.y * h)
                                if i == 0 { path.move(to: pt) } else { path.addLine(to: pt) }
                            }
                            let color = s.tool == "eraser" ? hexColor(canvas.background) : hexColor(s.color)
                            ctx.stroke(path, with: .color(color), style: StrokeStyle(lineWidth: max(1, (s.width ?? 0.008) * w), lineCap: .round, lineJoin: .round))
                        }
                    }
                    .frame(width: w, height: h)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            } else {
                Text("Draw something together 🎨").font(.caption).foregroundColor(.mMuted).multilineTextAlignment(.center).padding()
            }
        }
        .widgetURL(URL(string: "loversrock://canvas"))
    }
}

struct CanvasWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "LoversRockCanvas", provider: CanvasProvider()) { entry in
            if #available(iOS 17.0, *) {
                CanvasWidgetView(entry: entry).containerBackground(.background, for: .widget)
            } else {
                CanvasWidgetView(entry: entry)
            }
        }
        .configurationDisplayName("Canvas")
        .description("Your shared drawing.")
        .supportedFamilies([.systemSmall, .systemLarge])
    }
}

/// Grouped so the main bundle stays under WidgetKit's per-builder limit.
struct MomentWidgetsA: WidgetBundle {
    var body: some Widget {
        DaysTogetherWidget()
        AnniversaryWidget()
        StreakWidget()
        CountdownWidget()
        DistanceWidget()
        PartnerMoodWidget()
    }
}

struct MomentWidgetsB: WidgetBundle {
    var body: some Widget {
        NextDateWidget()
        LoveNoteWidget()
        SecretMessageWidget()
        DailyQuestionWidget()
        QuickKissWidget()
        CanvasWidget()
    }
}
