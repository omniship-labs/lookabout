import SwiftUI

// Lookabout-specific pieces from the design. Standard controls (Toggle,
// Picker, TextField, TabView, NavigationStack) stay native so Dynamic Type,
// VoiceOver and future iOS changes keep working; only what the product
// introduces is drawn here.

/// One "o" of the wordmark, and the bare glyph: lens ring + Beacon moon.
struct LensEye: View {
    var ring: Color = LK.textStrong
    var moon: Color = LK.beacon
    /// Ring thickness as a fraction of the diameter.
    var weight: CGFloat = 0.18

    var body: some View {
        GeometryReader { geo in
            let size = min(geo.size.width, geo.size.height)
            ZStack {
                Circle().strokeBorder(ring, lineWidth: size * weight)
                MoonShape().fill(moon).frame(width: size * 0.42, height: size * 0.42)
            }
            .frame(width: size, height: size)
        }
        .aspectRatio(1, contentMode: .fit)
    }
}

/// Crescent: a disc with a second disc cut out of its upper right.
struct MoonShape: Shape {
    func path(in rect: CGRect) -> Path {
        let r = rect.width / 2
        var disc = Path()
        disc.addEllipse(in: rect)
        var cut = Path()
        cut.addEllipse(in: CGRect(x: rect.midX, y: rect.minY - r, width: rect.width, height: rect.height))
        return disc.subtracting(cut)
    }
}

/// Lowercase "lookabout" where both o's are a lens ring + moon.
struct LensWordmark: View {
    var size: CGFloat = 24

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: size * 0.03) {
            Text("l")
            LensEye().frame(width: size * 0.54, height: size * 0.54)
            LensEye().frame(width: size * 0.54, height: size * 0.54)
            Text("kabout")
        }
        .font(LK.display(size))
        .tracking(-size * 0.03)
        .foregroundStyle(LK.textStrong)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Lookabout")
    }
}

/// App icon tile: Ink tile, paper ring, Beacon moon.
struct AppIconTile: View {
    var size: CGFloat = 40
    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.22)
            .fill(LK.surfaceInverse)
            .frame(width: size, height: size)
            .overlay(LensEye(ring: LK.paper, weight: 0.15).padding(size * 0.2))
            .accessibilityHidden(true)
    }
}

enum PillTone { case success, warning, accent, outline, scrim }

/// Mono status pill: LIVE, MOTION, HEARS SOUND, 3 CAMS.
struct Pill: View {
    let text: String
    var tone: PillTone = .outline
    var small = false

    var body: some View {
        Text(text)
            .font(LK.mono(small ? 10 : 11))
            .tracking(0.9)
            .padding(.horizontal, small ? 8 : 10)
            .padding(.vertical, small ? 3 : 4)
            .foregroundStyle(foreground)
            .background(background, in: Capsule())
            .overlay(Capsule().strokeBorder(tone == .outline ? LK.borderStrong : .clear, lineWidth: 1))
    }

    private var foreground: Color {
        switch tone {
        case .success, .warning: return LK.ink
        case .accent: return .white
        case .outline: return LK.textBody
        case .scrim: return LK.textStrong
        }
    }

    private var background: Color {
        switch tone {
        case .success: return LK.success
        case .warning: return LK.warning
        case .accent: return LK.beacon
        case .outline: return .clear
        case .scrim: return LK.surfacePage.opacity(0.82)
        }
    }
}

/// Feed tile. Shows the camera's video when it has a stream on your network,
/// otherwise the placeholder label. Always dark inside.
struct VideoTile<Overlay: View>: View {
    var streamURL: URL?
    var placeholder = "LIVE VIDEO"
    var radius: CGFloat = LK.radiusLg
    var highlight = false
    @ViewBuilder var overlay: () -> Overlay

    @StateObject private var stream = MJPEGStream()

    var body: some View {
        ZStack {
            LK.surfaceCard
            if let image = stream.image {
                Image(uiImage: image).resizable().scaledToFill()
                    .opacity(stream.isConnected ? 1 : 0.45) // last frame, dimmed, while reconnecting
            } else {
                Text(streamURL == nil ? placeholder : "CONNECTING")
                    .font(LK.mono(11)).tracking(0.9).foregroundStyle(LK.textMuted)
            }
            overlay()
        }
        .clipShape(RoundedRectangle(cornerRadius: radius))
        .overlay(
            RoundedRectangle(cornerRadius: radius)
                .strokeBorder(highlight ? LK.beacon : LK.border, lineWidth: highlight ? 1.5 : 1)
        )
        .lookaboutDark()
        .onAppear { if let streamURL { stream.start(streamURL) } }
        .onDisappear { stream.stop() }
        .onChange(of: streamURL) { _, url in
            if let url { stream.start(url) } else { stream.stop() }
        }
    }
}

extension VideoTile where Overlay == EmptyView {
    init(streamURL: URL? = nil, placeholder: String = "LIVE VIDEO", radius: CGFloat = LK.radiusLg) {
        self.init(streamURL: streamURL, placeholder: placeholder, radius: radius, highlight: false) { EmptyView() }
    }
}

/// 40 bars over a 10-minute window; a bar turns warning above the cry threshold.
struct SoundMeter: View {
    let levels: [Int]
    var body: some View {
        HStack(alignment: .bottom, spacing: 3) {
            ForEach(Array(levels.enumerated()), id: \.offset) { _, level in
                RoundedRectangle(cornerRadius: 2)
                    .fill(level > SampleData.cryBarThreshold ? LK.warning : LK.success)
                    .frame(height: CGFloat(max(3, level)))
            }
        }
        .frame(height: 36, alignment: .bottom)
        .accessibilityHidden(true)
    }
}

/// Per-camera 6pt level bar: success below the threshold, warning above.
struct LevelBar: View {
    let name: String
    let level: Double
    var body: some View {
        HStack(spacing: 10) {
            Text(name).font(LK.sans(13)).foregroundStyle(LK.textBody).frame(width: 96, alignment: .leading)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(LK.surfaceSunken)
                    Capsule().fill(level > SampleData.levelThreshold ? LK.warning : LK.success)
                        .frame(width: geo.size.width * level / 100)
                }
            }
            .frame(height: 6)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(name), sound level \(Int(level)) percent")
    }
}

/// time · dot · label · meta
struct EventRow: View {
    let event: SampleData.Event
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Text(event.time).font(LK.mono(12)).foregroundStyle(LK.textMuted).frame(width: 68, alignment: .leading)
                Circle().fill(dot).frame(width: 8, height: 8)
                Text(event.label).font(LK.sans(14)).foregroundStyle(LK.textStrong)
                Spacer()
                Text(event.meta).font(LK.sans(13)).foregroundStyle(LK.textMuted)
            }
            .frame(minHeight: 44)
            Rectangle().fill(LK.border).frame(height: 1)
        }
        .accessibilityElement(children: .combine)
    }

    private var dot: Color {
        switch event.tone {
        case .warning: return LK.warning
        case .success: return LK.success
        case .muted: return LK.textMuted
        }
    }
}

/// Clip row: thumbnail, title, meta, time.
struct ClipRow: View {
    let clip: SampleData.Clip
    var body: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: LK.radiusSm).fill(LK.surfaceSunken)
                .frame(width: 76, height: 48)
                .overlay(Image(systemName: "play.fill").font(.system(size: 13)).foregroundStyle(LK.textMuted))
            VStack(alignment: .leading, spacing: 2) {
                Text(clip.title).font(LK.sans(14, .semibold)).foregroundStyle(LK.textStrong)
                Text(clip.meta).font(LK.sans(12)).foregroundStyle(LK.textMuted)
            }
            Spacer()
            Text(clip.time).font(LK.mono(12)).foregroundStyle(LK.textMuted)
        }
        .padding(8)
        .card(radius: LK.radiusMd)
        .accessibilityElement(children: .combine)
    }
}

/// Filter chip, 36 tall.
struct Chip: View {
    let label: String
    let active: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(label)
                .font(LK.sans(13, active ? .semibold : .medium))
                .foregroundStyle(active ? LK.surfaceSunken : LK.textBody)
                .padding(.horizontal, 14)
                .frame(height: 36)
                .background(active ? LK.textStrong : .clear, in: Capsule())
                .overlay(Capsule().strokeBorder(active ? .clear : LK.borderStrong, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(active ? .isSelected : [])
    }
}

/// Numbered steps card used in the add-camera flows.
struct StepsCard: View {
    let steps: [String]
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                HStack(alignment: .top, spacing: 12) {
                    Text("\(index + 1)")
                        .font(LK.mono(11)).foregroundStyle(LK.paper)
                        .frame(width: 24, height: 24)
                        .background(LK.surfaceInverse, in: Circle())
                    Text(step).font(LK.sans(14)).foregroundStyle(LK.textBody)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }
}
