import WidgetKit
import SwiftUI

// Palette mirrors mobile/theme.js.
private extension Color {
    static let lrAccent = Color(red: 0.91, green: 0.38, blue: 0.48)   // #E8607A
    static let lrText = Color(red: 0.17, green: 0.14, blue: 0.13)     // #2B2320
    static let lrMuted = Color(red: 0.55, green: 0.50, blue: 0.47)    // #8C7F79
}

struct SummaryEntry: TimelineEntry {
    let date: Date
    let summary: WidgetSummary
    let signedIn: Bool
}

struct SummaryProvider: TimelineProvider {
    func placeholder(in context: Context) -> SummaryEntry {
        SummaryEntry(date: Date(), summary: .placeholder, signedIn: true)
    }

    func getSnapshot(in context: Context, completion: @escaping (SummaryEntry) -> Void) {
        // The gallery preview must never look empty.
        if context.isPreview {
            completion(SummaryEntry(date: Date(), summary: .placeholder, signedIn: true))
            return
        }
        let cached = WidgetDataLoader.cached ?? .signedOut
        completion(SummaryEntry(date: Date(), summary: cached, signedIn: WidgetDataLoader.credentials != nil))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SummaryEntry>) -> Void) {
        Task {
            let signedIn = WidgetDataLoader.credentials != nil
            let summary = await WidgetDataLoader.fetch() ?? WidgetDataLoader.cached ?? .signedOut
            let entry = SummaryEntry(date: Date(), summary: summary, signedIn: signedIn)
            // iOS budgets widget refreshes; ~30 minutes is the practical floor
            // before the system starts throttling us anyway.
            let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date().addingTimeInterval(1800)
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }
}

// MARK: - Shared pieces

private func distanceText(_ km: Double?) -> String? {
    guard let km else { return nil }
    return km < 1 ? "<1 km" : "\(Int(km)) km"
}

private struct UnavailableView: View {
    let message: String
    var body: some View {
        VStack(spacing: 4) {
            Text("loversrock.").font(.system(size: 14, weight: .semibold, design: .serif)).foregroundColor(.lrText)
            Text(message).font(.caption2).foregroundColor(.lrMuted).multilineTextAlignment(.center)
        }
        .padding(8)
    }
}

// MARK: - Home screen

struct SummaryWidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: SummaryEntry

    var body: some View {
        if !entry.signedIn {
            UnavailableView(message: "Sign in to set up your widget")
        } else if !entry.summary.paired {
            UnavailableView(message: "Pair with your partner")
        } else {
            switch family {
            case .systemMedium: medium
            default: small
            }
        }
    }

    private var small: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 4) {
                Image(systemName: "flame.fill").foregroundColor(.lrAccent).font(.caption)
                Text("\(entry.summary.streakCount)").font(.title2.bold()).foregroundColor(.lrText)
                Text("days").font(.caption2).foregroundColor(.lrMuted)
            }
            if let countdown = entry.summary.nextCountdown {
                VStack(alignment: .leading, spacing: 0) {
                    Text("\(countdown.daysRemaining)d").font(.headline).foregroundColor(.lrAccent)
                    Text(countdown.label).font(.caption2).foregroundColor(.lrMuted).lineLimit(1)
                }
            }
            if let distance = distanceText(entry.summary.distanceKm) {
                Text("\(distance) apart").font(.caption2).foregroundColor(.lrMuted).lineLimit(1)
            }
            if !entry.summary.promptAnsweredToday {
                Text("Prompt waiting").font(.caption2.bold()).foregroundColor(.lrAccent).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(12)
    }

    private var medium: some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Image(systemName: "flame.fill").foregroundColor(.lrAccent)
                    Text("\(entry.summary.streakCount)").font(.title.bold()).foregroundColor(.lrText)
                }
                Text("day streak").font(.caption2).foregroundColor(.lrMuted)
                Text(entry.summary.promptAnsweredToday ? "All caught up" : "Prompt waiting")
                    .font(.caption2.bold())
                    .foregroundColor(entry.summary.promptAnsweredToday ? .lrMuted : .lrAccent)
                    .padding(.top, 4)
            }
            Divider()
            VStack(alignment: .leading, spacing: 8) {
                if let countdown = entry.summary.nextCountdown {
                    VStack(alignment: .leading, spacing: 0) {
                        Text("\(countdown.daysRemaining) days").font(.headline).foregroundColor(.lrAccent)
                        Text(countdown.label).font(.caption2).foregroundColor(.lrMuted).lineLimit(1)
                    }
                }
                if let distance = distanceText(entry.summary.distanceKm) {
                    VStack(alignment: .leading, spacing: 0) {
                        Text(distance).font(.headline).foregroundColor(.lrAccent)
                        Text("apart").font(.caption2).foregroundColor(.lrMuted)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .padding(14)
    }
}

struct SummaryWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "LoversRockSummary", provider: SummaryProvider()) { entry in
            if #available(iOS 17.0, *) {
                SummaryWidgetView(entry: entry).containerBackground(.background, for: .widget)
            } else {
                SummaryWidgetView(entry: entry)
            }
        }
        .configurationDisplayName("At a glance")
        .description("Your streak, next countdown, and distance apart.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

// MARK: - Lock screen (iOS 16+ accessory families)

struct LockScreenWidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: SummaryEntry

    var body: some View {
        switch family {
        case .accessoryInline:
            // A single line next to the clock.
            Text(inlineText)

        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Image(systemName: "flame.fill").font(.caption2)
                    Text("\(entry.summary.streakCount)").font(.system(size: 16, weight: .bold))
                }
            }

        default: // .accessoryRectangular
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 3) {
                    Image(systemName: "flame.fill").font(.caption2)
                    Text("\(entry.summary.streakCount) day streak").font(.headline)
                }
                if let countdown = entry.summary.nextCountdown {
                    Text("\(countdown.label) in \(countdown.daysRemaining)d").font(.caption2).lineLimit(1)
                }
                if let distance = distanceText(entry.summary.distanceKm) {
                    Text("\(distance) apart").font(.caption2)
                } else if !entry.summary.promptAnsweredToday {
                    Text("Prompt waiting").font(.caption2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var inlineText: String {
        if !entry.signedIn { return "loversrock — sign in" }
        if !entry.summary.paired { return "loversrock — not paired" }
        if let countdown = entry.summary.nextCountdown {
            return "\(entry.summary.streakCount)d streak · \(countdown.label) in \(countdown.daysRemaining)d"
        }
        if let distance = distanceText(entry.summary.distanceKm) {
            return "\(entry.summary.streakCount)d streak · \(distance) apart"
        }
        return "\(entry.summary.streakCount) day streak"
    }
}

struct LockScreenWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "LoversRockLockScreen", provider: SummaryProvider()) { entry in
            LockScreenWidgetView(entry: entry)
        }
        .configurationDisplayName("loversrock glance")
        .description("Streak, countdown and distance on your lock screen.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

// MARK: - Photo widget

struct PhotoEntry: TimelineEntry {
    let date: Date
    let image: Data?
    let signedIn: Bool
}

struct PhotoProvider: TimelineProvider {
    func placeholder(in context: Context) -> PhotoEntry { PhotoEntry(date: Date(), image: nil, signedIn: true) }

    func getSnapshot(in context: Context, completion: @escaping (PhotoEntry) -> Void) {
        completion(PhotoEntry(date: Date(), image: nil, signedIn: WidgetDataLoader.credentials != nil))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<PhotoEntry>) -> Void) {
        Task {
            let data = await WidgetDataLoader.fetchPhoto()
            let entry = PhotoEntry(date: Date(), image: data, signedIn: WidgetDataLoader.credentials != nil)
            let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date().addingTimeInterval(1800)
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }
}

struct PhotoWidgetView: View {
    let entry: PhotoEntry
    var body: some View {
        if let data = entry.image, let uiImage = UIImage(data: data) {
            Image(uiImage: uiImage).resizable().aspectRatio(contentMode: .fill)
        } else {
            UnavailableView(message: entry.signedIn ? "No photo yet" : "Sign in to loversrock")
        }
    }
}

struct PhotoWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "LoversRockPhoto", provider: PhotoProvider()) { entry in
            if #available(iOS 17.0, *) {
                PhotoWidgetView(entry: entry).containerBackground(.background, for: .widget)
            } else {
                PhotoWidgetView(entry: entry)
            }
        }
        .configurationDisplayName("Partner photo")
        .description("The latest photo your partner dropped.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
struct LoversRockWidgetBundle: WidgetBundle {
    var body: some Widget {
        SummaryWidget()
        PhotoWidget()
        LockScreenWidget()
        MomentWidgetsA().body
        MomentWidgetsB().body
    }
}
