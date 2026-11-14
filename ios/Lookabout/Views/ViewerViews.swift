import SwiftUI
import UIKit

/// Viewer chrome: Live · Cameras · Events · Alerts.
struct ViewerView: View {
    var body: some View {
        TabView {
            NavigationStack { LiveView() }
                .tabItem { Label("Live", systemImage: "video") }
            NavigationStack { CamerasView() }
                .tabItem { Label("Cameras", systemImage: "square.grid.2x2") }
            NavigationStack { EventsView() }
                .tabItem { Label("Events", systemImage: "clock") }
            NavigationStack { SettingsView() }
                .tabItem { Label("Alerts", systemImage: "bell") }
        }
        .tint(LK.textStrong)
    }
}

// MARK: - Live (4b · nursery multi-cam)

struct LiveView: View {
    @State private var mainID = SampleData.roomCameras.max { $0.level < $1.level }!.id
    @State private var follow = true
    @State private var mix = "all"
    @State private var talking = false
    @State private var lullaby = false

    private var cams: [SampleData.RoomCamera] { SampleData.roomCameras }
    private var loudest: SampleData.RoomCamera { cams.max { $0.level < $1.level }! }
    private var main: SampleData.RoomCamera { cams.first { $0.id == mainID } ?? cams[0] }

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                HStack {
                    Text(SampleData.roomName).font(LK.display(22)).foregroundStyle(LK.textStrong)
                    Spacer()
                    Pill(text: "\(cams.count) CAMS")
                }
                .frame(minHeight: 44)

                VideoTile(streamURL: nil, placeholder: "LIVE VIDEO", radius: LK.radiusLg, highlight: false) {
                    VStack {
                        HStack(alignment: .top) {
                            followPill
                            Spacer()
                            if main.id == loudest.id { Pill(text: "HEARS SOUND", tone: .warning) }
                        }
                        Spacer()
                        Text(main.name).font(LK.display(17)).foregroundStyle(LK.textStrong)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(10)
                }
                .frame(height: 236)
                .id(main.id)
                .transition(.opacity)
                .accessibilityLabel("Live video from \(main.name)")

                HStack(spacing: 10) {
                    ForEach(cams.filter { $0.id != main.id }) { cam in
                        Button {
                            // Tapping a small feed swaps it in and pins it.
                            withAnimation(.easeOut(duration: 0.2)) {
                                mainID = cam.id
                                follow = false
                            }
                        } label: {
                            VideoTile(streamURL: nil, placeholder: "FEED", radius: LK.radiusMd, highlight: false) {
                                VStack {
                                    if cam.id == loudest.id {
                                        Circle().fill(LK.warning).frame(width: 10, height: 10)
                                            .frame(maxWidth: .infinity, alignment: .trailing).padding(8)
                                    }
                                    Spacer()
                                    HStack {
                                        Text(cam.name).font(LK.sans(13, .semibold)).foregroundStyle(LK.textStrong)
                                        Spacer()
                                        Image(systemName: "arrow.up.left.and.arrow.down.right")
                                            .font(.system(size: 11)).foregroundStyle(LK.textMuted)
                                    }
                                    .padding(.horizontal, 10).padding(.vertical, 7)
                                    .background(LK.surfacePage.opacity(0.85))
                                }
                            }
                            .frame(height: 104)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Show \(cam.name) in main view")
                    }
                }

                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .firstTextBaseline) {
                        Text("Stirring").font(LK.display(18)).foregroundStyle(LK.textStrong)
                        Spacer()
                        Text("Heard by Crib side").font(LK.sans(13)).foregroundStyle(LK.textMuted)
                    }
                    ForEach(cams) { LevelBar(name: $0.name, level: $0.level) }
                    Picker("Audio", selection: $mix) {
                        Text("Hear all, mixed").tag("all")
                        Text("Main view only").tag("main")
                    }
                    .pickerStyle(.segmented)
                }
                .padding(.horizontal, 16).padding(.vertical, 14)
                .card()

                HStack(spacing: 8) {
                    HoldToTalkButton(talking: $talking)
                    Button {
                        lullaby.toggle()
                    } label: {
                        Label("Lullaby", systemImage: "music.note")
                    }
                    .buttonStyle(OutlineButtonStyle(height: 52))
                    .overlay(RoundedRectangle(cornerRadius: LK.radiusMd).strokeBorder(lullaby ? LK.success : .clear, lineWidth: 1.5))
                    .accessibilityAddTraits(lullaby ? .isSelected : [])
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text("TONIGHT").eyebrow().padding(.bottom, 6)
                    ForEach(SampleData.tonight) { EventRow(event: $0) }
                }
                .padding(.top, 6)
            }
            .padding(.horizontal, LK.side)
            .padding(.bottom, 20)
        }
        .background(LK.surfacePage.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
    }

    /// AUTO (success fill): main view follows the loudest camera. PINNED (outline): stays put.
    private var followPill: some View {
        Button {
            withAnimation(.easeOut(duration: 0.2)) {
                follow.toggle()
                if follow { mainID = loudest.id }
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "speaker.wave.2").font(.system(size: 12))
                Text(follow ? "AUTO" : "PINNED").font(LK.mono(11)).tracking(0.9)
            }
            .foregroundStyle(follow ? LK.ink : LK.textStrong)
            .padding(.horizontal, 12)
            .frame(height: 36)
            .background(follow ? LK.success : LK.surfacePage.opacity(0.85), in: Capsule())
            .overlay(Capsule().strokeBorder(follow ? .clear : LK.borderStrong, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(follow ? "Main view follows the loudest camera" : "Main view is pinned")
        .accessibilityHint(follow ? "Double tap to pin" : "Double tap to follow sound")
    }
}

/// Opens the mic to the camera while held; haptic tick on start and end.
struct HoldToTalkButton: View {
    @Binding var talking: Bool

    var body: some View {
        Label(talking ? "Talking…" : "Hold to talk", systemImage: "mic")
            .font(LK.sans(14, .semibold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(talking ? LK.beaconPress : LK.beacon, in: RoundedRectangle(cornerRadius: LK.radiusMd))
            .scaleEffect(talking ? 0.985 : 1)
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { _ in set(true) }
                    .onEnded { _ in set(false) }
            )
            .accessibilityAddTraits(.isButton)
            .accessibilityHint("Hold to talk through the camera")
    }

    private func set(_ on: Bool) {
        guard talking != on else { return }
        talking = on
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }
}

// MARK: - Cameras (5 · CCTV grid + events)

struct CamerasView: View {
    @EnvironmentObject private var store: AppStore
    @State private var filter = "all"
    @State private var adding = false

    private let columns = [GridItem(.flexible(), spacing: 10), GridItem(.flexible())]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text("Cameras").font(LK.display(26)).foregroundStyle(LK.textStrong)
                    Spacer()
                    Button {
                        adding = true
                    } label: {
                        Image(systemName: "plus").font(.system(size: 17, weight: .medium))
                            .foregroundStyle(LK.textStrong)
                            .frame(width: 44, height: 44)
                            .background(LK.surfaceCard, in: RoundedRectangle(cornerRadius: LK.radiusMd))
                            .overlay(RoundedRectangle(cornerRadius: LK.radiusMd).strokeBorder(LK.borderStrong, lineWidth: 1))
                    }
                    .accessibilityLabel("Add camera")
                }
                Text("\(store.cameras.count) online · No hub · live only")
                    .font(LK.sans(13)).foregroundStyle(LK.textMuted)
                    .padding(.top, 6).padding(.bottom, 14)

                LazyVGrid(columns: columns, spacing: 10) {
                    ForEach(store.cameras) { camera in
                        NavigationLink(value: camera) { tile(camera) }
                            .buttonStyle(.plain)
                            .contextMenu {
                                if !camera.isSample {
                                    Button("Remove camera", role: .destructive) { store.remove(camera) }
                                }
                            }
                    }
                }

                HStack {
                    Text("Events today").font(LK.display(19)).foregroundStyle(LK.textStrong)
                    Spacer()
                    Text("12 CLIPS").font(LK.mono(11)).tracking(0.9).foregroundStyle(LK.textMuted)
                }
                .padding(.top, 20).padding(.bottom, 10)

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        Chip(label: "All", active: filter == "all") { filter = "all" }
                        Chip(label: "Motion", active: filter == "motion") { filter = "motion" }
                        Chip(label: "Sound", active: filter == "sound") { filter = "sound" }
                    }
                }
                .padding(.bottom, 12)

                VStack(spacing: 8) {
                    ForEach(SampleData.clipsToday.filter { filter == "all" || $0.kind == filter }) { ClipRow(clip: $0) }
                }
            }
            .padding(.horizontal, LK.side)
            .padding(.bottom, 20)
        }
        .background(LK.surfacePage.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .navigationDestination(for: Camera.self) { CameraDetailView(camera: $0) }
        .sheet(isPresented: $adding) { AddCameraView() }
    }

    private func tile(_ camera: Camera) -> some View {
        VideoTile(streamURL: camera.streamURL, placeholder: "FEED", radius: LK.radiusMd, highlight: camera.motion) {
            VStack {
                if camera.motion {
                    Pill(text: "MOTION", tone: .accent, small: true)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(8)
                }
                Spacer()
                HStack {
                    Text(camera.name).font(LK.sans(13, .semibold)).foregroundStyle(LK.textStrong).lineLimit(1)
                    Spacer()
                    Text(camera.device).font(LK.mono(10)).foregroundStyle(LK.textMuted)
                }
                .padding(.horizontal, 10).padding(.vertical, 8)
                .background(LK.surfacePage.opacity(0.85))
            }
        }
        .frame(height: 128)
        .accessibilityElement(children: .combine)
    }
}

/// 4 · One camera's live view.
struct CameraDetailView: View {
    let camera: Camera
    @State private var talking = false

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                VideoTile(streamURL: camera.streamURL, placeholder: "LIVE VIDEO", radius: LK.radiusLg, highlight: false) {
                    VStack {
                        HStack {
                            TimelineView(.periodic(from: .now, by: 15)) { timeline in
                                Pill(text: "LIVE · \(timeline.date.formatted(date: .omitted, time: .shortened).uppercased())", tone: .scrim)
                            }
                            Spacer()
                        }
                        Spacer()
                    }
                    .padding(12)
                }
                .frame(height: 250)
                .accessibilityLabel("Live video from \(camera.name)")

                if camera.isSample {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(alignment: .firstTextBaseline) {
                            Text("Calm").font(LK.display(18)).foregroundStyle(LK.textStrong)
                            Spacer()
                            Text("Quiet for 42 min").font(LK.sans(13)).foregroundStyle(LK.textMuted)
                        }
                        SoundMeter(levels: SampleData.soundLevels)
                        Text("SOUND · LAST 10 MIN").font(LK.mono(11)).tracking(0.9).foregroundStyle(LK.textMuted)
                    }
                    .padding(.horizontal, 16).padding(.vertical, 14)
                    .card()

                    HoldToTalkButton(talking: $talking)

                    VStack(alignment: .leading, spacing: 2) {
                        Text("TONIGHT").eyebrow().padding(.bottom, 6)
                        ForEach(SampleData.tonight) { EventRow(event: $0) }
                    }
                } else {
                    Text("This camera sends video only. It is on your home network, so it shows while this phone is on the same Wi-Fi.")
                        .font(LK.sans(13)).foregroundStyle(LK.textMuted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if let url = camera.streamURL {
                        FirmwareCard(streamURL: url)
                    }
                }
            }
            .padding(.horizontal, LK.side)
            .padding(.vertical, 12)
        }
        .background(LK.surfacePage.ignoresSafeArea())
        .navigationTitle(camera.name)
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Firmware version of an ESP32 camera, with an over-Wi-Fi update.
struct FirmwareCard: View {
    @StateObject private var updater: FirmwareUpdater

    init(streamURL: URL) {
        _updater = StateObject(wrappedValue: FirmwareUpdater(streamURL: streamURL))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("CAMERA FIRMWARE").eyebrow()
            Text(line).font(LK.sans(14, .medium)).foregroundStyle(LK.textStrong)
            if case let .updating(progress) = updater.state {
                ProgressView(value: progress).tint(LK.success)
            }
            if case .ready = updater.state {
                Button(updater.isUpToDate ? "Reinstall firmware" : "Update firmware") { updater.update() }
                    .buttonStyle(OutlineButtonStyle())
                Text("Sent from this phone over your Wi-Fi. If it is interrupted, the camera keeps its current firmware.")
                    .font(LK.sans(12)).foregroundStyle(LK.textMuted)
            }
            if case .failed = updater.state {
                Button("Try again") { updater.check() }.buttonStyle(OutlineButtonStyle())
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
        .onAppear { updater.check() }
    }

    private var line: String {
        let available = FirmwareUpdater.bundled?.version
        switch updater.state {
        case .checking: return "Checking…"
        case .unreachable: return "Not reachable on this Wi-Fi"
        case .notABoard: return "Raspberry Pi · update with its installer"
        case .ready(let current):
            if updater.isUpToDate { return "Version \(current) · up to date" }
            return available.map { "Version \(current) · \($0) available" } ?? "Version \(current)"
        case .updating(let progress): return "Sending update · \(Int(progress * 100))%"
        case .done: return "Updated. The camera is restarting."
        case .failed(let message): return message
        }
    }
}

// MARK: - Events

struct EventsView: View {
    @State private var filter = "all"
    private let filters = [("all", "All"), ("crying", "Crying"), ("motion", "Motion"), ("offline", "Offline")]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("Events").font(LK.display(26)).foregroundStyle(LK.textStrong).frame(minHeight: 44)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(filters, id: \.0) { id, label in
                            Chip(label: label, active: filter == id) { filter = id }
                        }
                    }
                }
                ForEach(SampleData.eventDays, id: \.label) { day in
                    let items = day.items.filter { filter == "all" || $0.kind == filter }
                    if !items.isEmpty {
                        Text(day.label).eyebrow().padding(.top, 6)
                        ForEach(items) { ClipRow(clip: $0) }
                    }
                }
            }
            .padding(.horizontal, LK.side)
            .padding(.bottom, 20)
        }
        .background(LK.surfacePage.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
    }
}
