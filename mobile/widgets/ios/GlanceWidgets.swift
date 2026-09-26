import WidgetKit
import SwiftUI
import UIKit
import AppIntents

// The six one-fact widgets: anniversary, today's question, the next date, a
// note from them, a kiss, and the latest drawing.
//
// They share one timeline provider because they read one payload. A person
// with four of these on a home screen should cause four cheap reads of the
// same cached summary, not four independent refresh schedules fighting over
// the same budget — iOS throttles per extension, not per widget.

private extension Color {
    static let glAccent = Color(red: 0.91, green: 0.38, blue: 0.48)   // #E8607A
    static let glText = Color(red: 0.17, green: 0.14, blue: 0.13)     // #2B2320
    static let glMuted = Color(red: 0.55, green: 0.50, blue: 0.47)    // #8C7F79
}

/// Grey liquid glass: the background of every loversrock widget, matching the
/// Android widgets' drawable/widget_background.xml. A translucent grey body a
/// shade lighter at the top, a sheen over the upper half, and a bright rim
/// following the widget's own corner shape.
struct LRGlass: View {
    /// Percent opaque from the Settings slider (WidgetBridge.setWidgetOpacity),
    /// 70 until it is moved — the same default as Android.
    private var opacity: Double {
        let stored = UserDefaults(suiteName: WidgetDataLoader.appGroup)?.object(forKey: "glassOpacity") as? Int
        return Double(max(0, min(100, stored ?? 70))) / 100
    }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Color(red: 0.894, green: 0.902, blue: 0.918).opacity(min(1, opacity + 0.03)),
                         Color(red: 0.682, green: 0.698, blue: 0.729).opacity(max(0, opacity - 0.03))],
                startPoint: .top, endPoint: .bottom)
            LinearGradient(
                colors: [Color.white.opacity(0.45), Color.white.opacity(0)],
                startPoint: .top, endPoint: UnitPoint(x: 0.5, y: 0.45))
            ContainerRelativeShape()
                .strokeBorder(Color.white.opacity(0.7), lineWidth: 1)
        }
    }
}

/// The glass behind a widget: as the container background on iOS 17+, where
/// WidgetKit requires one (and drops it itself on the lock screen), and as a
/// plain background before that — except on the lock screen, where a grey box
/// behind a tinted accessory widget would just look broken.
private struct LRGlassBackground: ViewModifier {
    @Environment(\.widgetFamily) private var family

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 17.0, *) {
            content.containerBackground(for: .widget) { LRGlass() }
        } else if family == .accessoryRectangular || family == .accessoryCircular
                    || family == .accessoryInline {
            content
        } else {
            content.background(LRGlass())
        }
    }
}

extension View {
    func lrGlassBackground() -> some View { modifier(LRGlassBackground()) }
}

/// "4m ago", in the fewest characters that are still honest.
func lrAgo(_ iso: String?) -> String? {
    guard let iso, !iso.isEmpty else { return nil }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let date = formatter.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
    guard let date else { return nil }
    let mins = Int(Date().timeIntervalSince(date) / 60)
    switch mins {
    case ..<1: return "just now"
    case ..<60: return "\(mins)m ago"
    case ..<(48 * 60): return "\(mins / 60)h ago"
    default: return "\(mins / 1440)d ago"
    }
}

/// The next round number worth knowing about, so nobody has to do the sum.
func lrNextMilestone(after days: Int) -> Int? {
    [100, 365, 500, 730, 1000, 1095, 1500, 1825, 2000, 3000, 3650].first { $0 > days }
}

// MARK: - One provider, six widgets

struct GlanceEntry: TimelineEntry {
    let date: Date
    let summary: WidgetSummary
    let signedIn: Bool
    let drawing: WidgetDrawing?
}

struct GlanceProvider: TimelineProvider {
    /// Only the canvas widget needs strokes; everything else skips the call.
    let wantsDrawing: Bool

    init(wantsDrawing: Bool = false) { self.wantsDrawing = wantsDrawing }

    func placeholder(in context: Context) -> GlanceEntry {
        GlanceEntry(date: Date(), summary: .placeholder, signedIn: true, drawing: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (GlanceEntry) -> Void) {
        // The gallery preview must never look empty, or nobody picks it.
        if context.isPreview {
            completion(GlanceEntry(date: Date(), summary: .placeholder, signedIn: true, drawing: nil))
            return
        }
        completion(GlanceEntry(
            date: Date(),
            summary: WidgetDataLoader.cached ?? .signedOut,
            signedIn: WidgetDataLoader.credentials != nil,
            drawing: wantsDrawing ? WidgetDataLoader.cachedDrawing : nil
        ))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<GlanceEntry>) -> Void) {
        Task {
            let signedIn = WidgetDataLoader.credentials != nil
            let summary = await WidgetDataLoader.fetch() ?? WidgetDataLoader.cached ?? .signedOut
            let drawing = wantsDrawing ? await WidgetDataLoader.fetchDrawing() : nil
            let entry = GlanceEntry(date: Date(), summary: summary, signedIn: signedIn, drawing: drawing)
            let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date())
                ?? Date().addingTimeInterval(1800)
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }
}

/// Label, one big fact, one line of context. The shape all four text widgets
/// share, so a padding fix happens once.
struct GlanceCard: View {
    let label: String
    let value: String
    let caption: String
    var valueSize: CGFloat = 22

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased())
                .font(.system(size: 10, weight: .bold))
                .tracking(0.6)
                .foregroundColor(.glMuted)
            Text(value)
                .font(.system(size: valueSize, weight: .bold))
                .foregroundColor(.glText)
                .minimumScaleFactor(0.6)
                .lineLimit(4)
            Spacer(minLength: 0)
            Text(caption)
                .font(.system(size: 11))
                .foregroundColor(.glMuted)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .padding(14)
    }
}

/// The three states before a widget has anything to say. Each tells the
/// person what to DO about it rather than showing a dash and nothing else.
private func notReady(_ entry: GlanceEntry, _ label: String) -> GlanceCard? {
    if !entry.signedIn { return GlanceCard(label: label, value: "—", caption: "Open loversrock to set this up") }
    if !entry.summary.paired { return GlanceCard(label: label, value: "—", caption: "Pair with your partner first") }
    return nil
}

// MARK: - Anniversary

struct AnniversaryView: View {
    let entry: GlanceEntry
    var body: some View {
        if let blocked = notReady(entry, "Together") { blocked } else if let days = entry.summary.daysTogether {
            GlanceCard(
                label: "Together",
                value: "\(days) days",
                caption: lrNextMilestone(after: days).map { "\($0) in \($0 - days) days" }
                    ?? entry.summary.togetherSince.map { "since \($0)" } ?? ""
            )
        } else {
            GlanceCard(label: "Together", value: "—", caption: "Set your date in the app")
        }
    }
}

struct AnniversaryWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "LoversRockAnniversary", provider: GlanceProvider()) { entry in
            AnniversaryView(entry: entry).lrGlassBackground()
        }
        .configurationDisplayName("Together")
        .description("Days together, and the next milestone.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
    }
}

// MARK: - Today's question

struct QuestionView: View {
    let entry: GlanceEntry
    var body: some View {
        if let blocked = notReady(entry, "Today's question") { blocked }
        else if let question = entry.summary.todaysQuestion, !question.isEmpty {
            // Smaller than the other glance widgets: a whole sentence set at
            // 22pt is two words and an ellipsis.
            GlanceCard(
                label: "Today's question",
                value: question,
                caption: entry.summary.promptAnsweredToday ? "You have answered — tap to see theirs" : "Tap to answer",
                valueSize: 14
            )
        } else {
            GlanceCard(label: "Today's question", value: "—", caption: "No question today")
        }
    }
}

struct QuestionWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "LoversRockQuestion", provider: GlanceProvider()) { entry in
            QuestionView(entry: entry).lrGlassBackground()
        }
        .configurationDisplayName("Today's question")
        .description("So you think about it during the day, not at 11pm.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
    }
}

// MARK: - The next date

struct NextDateView: View {
    let entry: GlanceEntry
    var body: some View {
        if let blocked = notReady(entry, "Next date") { blocked }
        else if let next = entry.summary.nextDate {
            GlanceCard(
                label: "Next date",
                value: next.title,
                caption: next.daysUntil == 0 ? "Today" : next.daysUntil == 1 ? "Tomorrow" : "in \(next.daysUntil) days",
                valueSize: 16
            )
        } else {
            GlanceCard(label: "Next date", value: "Nothing planned", caption: "Tap to pick something", valueSize: 16)
        }
    }
}

struct NextDateWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "LoversRockNextDate", provider: GlanceProvider()) { entry in
            NextDateView(entry: entry).lrGlassBackground()
        }
        .configurationDisplayName("Next date")
        .description("What you have planned, and how soon.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
    }
}

// MARK: - A note from them

struct SecretMessageView: View {
    let entry: GlanceEntry
    var body: some View {
        if let blocked = notReady(entry, "From them") { blocked }
        // The rule this widget exists to keep: a sealed note is ANNOUNCED on
        // a home screen, never printed on one. The server does not send the
        // body at all, so there is nothing here to leak even if this were
        // wrong — but it is stated in both places on purpose.
        else if entry.summary.sealedNoteWaiting == true {
            GlanceCard(label: "From them", value: "A sealed note is waiting", caption: "Open the app to read it", valueSize: 14)
        } else if let note = entry.summary.latestNote, !note.isEmpty {
            GlanceCard(label: "From them", value: "“\(note)”", caption: "", valueSize: 14)
        } else {
            GlanceCard(label: "From them", value: "Nothing new", caption: "Leave them one instead", valueSize: 14)
        }
    }
}

struct SecretMessageWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "LoversRockSecret", provider: GlanceProvider()) { entry in
            SecretMessageView(entry: entry).lrGlassBackground()
        }
        .configurationDisplayName("From them")
        .description("Their latest note. Sealed ones stay sealed.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
    }
}

// MARK: - The kiss

/// Tapping sends without leaving the home screen.
///
/// AppIntent is what makes this a widget rather than a shortcut: before iOS
/// 17 the only thing a tap could do was open the app, which for a one-tap
/// gesture is the entire feature gone.
@available(iOS 17.0, *)
struct SendKissIntent: AppIntent {
    static var title: LocalizedStringResource = "Send a kiss"
    static var description = IntentDescription("Tells them you are thinking of them.")

    func perform() async throws -> some IntentResult {
        await WidgetDataLoader.sendKiss()
        WidgetCenter.shared.reloadTimelines(ofKind: "LoversRockKiss")
        return .result()
    }
}

struct KissView: View {
    let entry: GlanceEntry

    private var waiting: Int { entry.summary.unseenKisses ?? 0 }

    private var heart: some View {
        Image(systemName: waiting > 0 ? "heart.fill" : "heart")
            .font(.system(size: 30, weight: .semibold))
            .foregroundColor(.glAccent)
    }

    var body: some View {
        VStack(spacing: 6) {
            if #available(iOS 17.0, *) {
                Button(intent: SendKissIntent()) { heart }.buttonStyle(.plain)
            } else {
                // Pre-17 the tap opens the app, which is the best available.
                heart
            }
            Text(waiting > 0 ? (waiting == 1 ? "A kiss for you" : "\(waiting) kisses for you") : "Send a kiss")
                .font(.system(size: 13, weight: .bold))
                .foregroundColor(.glText)
                .lineLimit(1)
            Text(waiting > 0
                 ? (lrAgo(entry.summary.lastKissFromPartnerAt) ?? "")
                 : (lrAgo(entry.summary.lastKissSentAt).map { "sent \($0)" } ?? "tap the heart"))
                .font(.system(size: 10))
                .foregroundColor(.glMuted)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(10)
    }
}

struct KissWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "LoversRockKiss", provider: GlanceProvider()) { entry in
            KissView(entry: entry).lrGlassBackground()
        }
        .configurationDisplayName("Quick kiss")
        .description("One tap to tell them you are thinking of them.")
        .supportedFamilies([.systemSmall])
    }
}

// MARK: - The canvas

/// Replays the strokes as a SwiftUI Path.
///
/// Vector rather than a rendered image, which is why the server sends strokes
/// at all: the drawing stays crisp at whatever size the widget is placed, and
/// no image ever has to be stored or transferred.
struct DrawingCanvas: View {
    let drawing: WidgetDrawing

    private func colour(_ hex: String?, fallback: Color) -> Color {
        guard let hex, hex.hasPrefix("#"), hex.count == 7,
              let value = Int(hex.dropFirst(), radix: 16) else { return fallback }
        return Color(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }

    /// The box the strokes occupy, grown by the widest brush — a path's
    /// coordinates are its centre line, so a fat stroke on the edge would be
    /// sliced in half lengthways without it.
    private var bounds: CGRect? {
        var minX = Double.greatestFiniteMagnitude, minY = Double.greatestFiniteMagnitude
        var maxX = -Double.greatestFiniteMagnitude, maxY = -Double.greatestFiniteMagnitude
        var widest = 1.0
        for stroke in drawing.strokes {
            widest = max(widest, stroke.width ?? 6)
            for p in stroke.points {
                minX = min(minX, p.x); minY = min(minY, p.y)
                maxX = max(maxX, p.x); maxY = max(maxY, p.y)
            }
        }
        guard minX <= maxX else { return nil }
        return CGRect(
            x: minX - widest, y: minY - widest,
            width: max(maxX - minX, 1) + widest * 2,
            height: max(maxY - minY, 1) + widest * 2
        )
    }

    var body: some View {
        GeometryReader { geo in
            let paper = colour(drawing.canvasColor, fallback: .white)
            ZStack {
                paper
                if let box = bounds {
                    // Fit rather than fill: a widget tile is the one place
                    // where cropping somebody's drawing is worse than margins.
                    let scale = min(geo.size.width / box.width, geo.size.height / box.height)
                    // The ForEach is wrapped in a ZStack before the transform
                    // is applied. A modifier hung directly off a ForEach is
                    // applied to each generated view INDIVIDUALLY, which for
                    // a scale means every stroke shrinking about its own
                    // origin — each one in the right shape and the wrong
                    // place, so the drawing comes apart.
                    ZStack {
                        ForEach(Array(drawing.strokes.enumerated()), id: \.offset) { _, stroke in
                            Path { path in
                                guard let first = stroke.points.first else { return }
                                path.move(to: CGPoint(x: first.x, y: first.y))
                                for p in stroke.points.dropFirst() {
                                    path.addLine(to: CGPoint(x: p.x, y: p.y))
                                }
                            }
                            .stroke(
                                // An eraser paints IN the paper colour rather
                                // than removing pixels — same as the app, and
                                // the only thing that works when strokes are
                                // replayed in order onto opaque paper.
                                stroke.tool == "eraser" ? paper : colour(stroke.color, fallback: .black),
                                style: StrokeStyle(lineWidth: stroke.width ?? 6, lineCap: .round, lineJoin: .round)
                            )
                            .opacity(stroke.tool == "highlighter" ? 0.45 : 1)
                        }
                    }
                    .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
                    .scaleEffect(scale, anchor: .topLeading)
                    .offset(
                        x: (geo.size.width - box.width * scale) / 2 - box.minX * scale,
                        y: (geo.size.height - box.height * scale) / 2 - box.minY * scale
                    )
                }
            }
        }
    }
}

struct CanvasView: View {
    let entry: GlanceEntry
    var body: some View {
        if let drawing = entry.drawing ?? WidgetDataLoader.cachedDrawing, !drawing.strokes.isEmpty {
            ZStack(alignment: .bottom) {
                DrawingCanvas(drawing: drawing)
                Text(drawing.title ?? "Untitled")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundColor(.white)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(8)
                    .background(LinearGradient(
                        colors: [.black.opacity(0.55), .clear],
                        startPoint: .bottom, endPoint: .top
                    ))
            }
        } else if let blocked = notReady(entry, "Drawings") {
            blocked
        } else {
            GlanceCard(label: "Drawings", value: "Nothing drawn yet", caption: "Tap to draw something", valueSize: 16)
        }
    }
}

struct CanvasWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "LoversRockCanvas", provider: GlanceProvider(wantsDrawing: true)) { entry in
            CanvasView(entry: entry).lrGlassBackground()
        }
        .configurationDisplayName("Latest drawing")
        .description("The newest drawing from the two of you.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}


// MARK: - Distance apart

/// "1,305 km", not "1305.0 km": a decimal only while it still means something,
/// and metres when you are practically in the same room.
func lrFormatDistance(_ km: Double) -> String {
    if km < 1 { return "\(Int(km * 1000)) m" }
    if km < 10 { return String(format: "%.1f km", km) }
    let formatter = NumberFormatter()
    formatter.numberStyle = .decimal
    formatter.maximumFractionDigits = 0
    let rounded = km.rounded()
    return "\(formatter.string(from: NSNumber(value: rounded)) ?? String(Int(rounded))) km"
}

private struct DistanceDash: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.midY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        return path
    }
}

private struct DistanceBubble: View {
    let text: String
    let size: CGFloat
    var body: some View {
        Text(text)
            .font(.system(size: size * 0.36, weight: .bold))
            .minimumScaleFactor(0.6)
            .lineLimit(1)
            .frame(width: size, height: size)
            .background(Circle().fill(Color.primary.opacity(0.14)))
            .overlay(Circle().stroke(Color.primary.opacity(0.35), lineWidth: 1))
    }
}

/// Me ····♥···· M — you, them, and the line between.
private struct DistanceLine: View {
    let initial: String
    let bubble: CGFloat
    var heart: Color = .primary

    var body: some View {
        HStack(spacing: 4) {
            DistanceBubble(text: "Me", size: bubble)
            dash
            Image(systemName: "heart.fill")
                .font(.system(size: bubble * 0.45))
                .foregroundColor(heart)
            dash
            DistanceBubble(text: initial, size: bubble)
        }
    }

    private var dash: some View {
        DistanceDash()
            .stroke(style: StrokeStyle(lineWidth: 1.5, dash: [3, 3]))
            .frame(height: 2)
            .opacity(0.6)
    }
}

/// The wiggly line between the two of you: a sine wave, stroked as round dots
/// (a zero-length dash with a round cap is a dot). It crosses the middle at the
/// centre, where the heart sits.
private struct DistanceWiggle: Shape {
    var amplitude: CGFloat = 6.5
    var wavelength: CGFloat = 56

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let mid = rect.midX
        let y = { (x: CGFloat) -> CGFloat in
            rect.midY + amplitude * sin(2 * .pi * (x - mid) / wavelength)
        }
        path.move(to: CGPoint(x: rect.minX, y: y(rect.minX)))
        var x = rect.minX
        while x < rect.maxX {
            x = min(x + 1, rect.maxX)
            path.addLine(to: CGPoint(x: x, y: y(x)))
        }
        return path
    }
}

/// One of you, head to toe: the full picture scaled to fit, never cropped,
/// with your mood tucked into a corner and today's symptoms underneath.
private struct DistanceMascot: View {
    let art: String
    let mood: String?
    let symptoms: [String]
    let moodOnTrailingEdge: Bool

    var body: some View {
        VStack(spacing: 2) {
            ZStack(alignment: moodOnTrailingEdge ? Alignment.bottomTrailing : Alignment.bottomLeading) {
                picture
                    .resizable()
                    .scaledToFit()
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .padding(moodOnTrailingEdge ? Edge.Set.trailing : Edge.Set.leading, 6)
                    .padding(.bottom, 6)
                if let mood = mood, !mood.isEmpty {
                    Text(mood)
                        .font(.system(size: 13))
                        .frame(width: 24, height: 24)
                        .background(Circle().fill(Color(UIColor.systemBackground)))
                        .overlay(Circle().stroke(Color.primary.opacity(0.12), lineWidth: 1))
                }
            }
            if !symptoms.isEmpty {
                Text(symptoms.joined())
                    .font(.system(size: 11))
                    .lineLimit(1)
            }
        }
        .frame(width: 60)
    }

    /// The copy of the app's own picture, bundled into the extension by
    /// plugins/withIosWidgets.js. A missing file draws nothing rather than
    /// crashing the widget.
    private var picture: Image {
        let name = art == "b" ? "widget_mascot_b.jpg" : "widget_mascot_a.jpg"
        if let image = UIImage(named: name) { return Image(uiImage: image) }
        return Image(systemName: "person.fill")
    }
}

struct DistanceView: View {
    let entry: GlanceEntry
    @Environment(\.widgetFamily) private var family

    /// The number, or words somebody can act on — never a bare dash.
    private var reading: (value: String, caption: String) {
        let s = entry.summary
        if let km = s.distanceKm { return (lrFormatDistance(km), "") }
        switch s.distanceStatus {
        case "sharing_off": return ("—", "Turn on location sharing, both of you")
        case "no_location": return ("—", "Waiting for a location")
        default: return ("—", "Open loversrock to refresh")
        }
    }

    var body: some View {
        let s = entry.summary
        let initial = s.partnerInitial ?? "♥"
        let meOnLeft = (s.myArt ?? "a") == "b"
        if family == .accessoryRectangular {
            // The lock-screen card this is modelled on. The system tints
            // accessory widgets itself — photographs come out as flat grey
            // shapes — so this keeps the bubbles and sticks to .primary.
            let ready = entry.signedIn && s.paired
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 3) {
                    Text("Our Distance:").font(.system(size: 11))
                    Text(ready ? reading.value : "—").font(.system(size: 12, weight: .bold))
                }
                DistanceLine(initial: initial, bubble: 22)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } else if let blocked = notReady(entry, "Our distance") {
            blocked
        } else {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 4) {
                    Text("Our distance:")
                        .font(.system(size: 12))
                        .foregroundColor(.glMuted)
                    Text(reading.value)
                        .font(.system(size: 17, weight: .bold))
                        .foregroundColor(.glText)
                }
                HStack(alignment: .center, spacing: 6) {
                    // Her (picture b) on the left, him (a) on the right, on
                    // both phones; each row follows whoever is in the slot.
                    DistanceMascot(art: "b", mood: meOnLeft ? s.myMoodEmoji : s.partnerMoodEmoji,
                                   symptoms: (meOnLeft ? s.mySymptomEmoji : s.partnerSymptomEmoji) ?? [],
                                   moodOnTrailingEdge: true)
                    VStack(spacing: 6) {
                        ZStack {
                            DistanceWiggle()
                                .stroke(Color.glAccent.opacity(0.75),
                                        style: StrokeStyle(lineWidth: 3.2, lineCap: .round, dash: [0, 6.5]))
                                .frame(height: 24)
                            Image(systemName: "heart.fill")
                                .font(.system(size: 12))
                                .foregroundColor(.glAccent)
                                .frame(width: 22, height: 22)
                                .background(Circle().fill(Color(UIColor.systemBackground)))
                        }
                        if !reading.caption.isEmpty {
                            Text(reading.caption)
                                .font(.system(size: 11))
                                .foregroundColor(.glMuted)
                                .multilineTextAlignment(.center)
                                .lineLimit(2)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    DistanceMascot(art: "a", mood: meOnLeft ? s.partnerMoodEmoji : s.myMoodEmoji,
                                   symptoms: (meOnLeft ? s.partnerSymptomEmoji : s.mySymptomEmoji) ?? [],
                                   moodOnTrailingEdge: false)
                }
                .frame(maxHeight: .infinity)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .padding(12)
        }
    }
}

struct DistanceWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "LoversRockDistance", provider: GlanceProvider()) { entry in
            DistanceView(entry: entry).lrGlassBackground()
        }
        .configurationDisplayName("Distance apart")
        .description("How far apart you are: the two of you, a wiggly line and a heart, and how you are both feeling.")
        .supportedFamilies([.systemMedium, .accessoryRectangular])
    }
}
