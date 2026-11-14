import AVFoundation
import SwiftUI
import UIKit

/// 1 · Start: pick a role for this device.
struct StartView: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                LensWordmark(size: 24)

                VStack(alignment: .leading, spacing: 10) {
                    Text("STEP 1 OF 2").eyebrow(12)
                    Text("What should this device do?")
                        .font(LK.display(34)).tracking(-0.85).foregroundStyle(LK.textStrong)
                    Text("Any phone, laptop or webcam works. Pick a role here, then pair it with your other device.")
                        .font(LK.sans(16)).foregroundStyle(LK.textBody)
                }

                VStack(spacing: 14) {
                    roleCard(.camera, primary: true, icon: "video", title: "Use as a camera",
                             text: "Point it at the crib or the door. It streams to your viewers and can sit with the screen off.")
                    roleCard(.viewer, primary: false, icon: "iphone", title: "Use as a viewer",
                             text: "Watch and listen from your phone. Get alerts for crying, sound or motion.")
                }

                HStack(spacing: 10) {
                    Image(systemName: "lock").foregroundStyle(LK.success)
                    Text("Video goes device to device, end-to-end encrypted. Nothing is uploaded unless you add a home hub.")
                        .font(LK.sans(13)).foregroundStyle(LK.textBody)
                }
                .padding(.horizontal, 16).padding(.vertical, 14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(LK.surfaceSunken, in: RoundedRectangle(cornerRadius: LK.radiusMd))

                HStack {
                    Text("BY OMNISHIP LABS")
                    Spacer()
                    Text("AGPL-3.0")
                }
                .font(LK.mono(11)).tracking(0.9).foregroundStyle(LK.textMuted)
                .padding(.top, 24)
            }
            .padding(.horizontal, LK.side)
            .padding(.top, 24).padding(.bottom, 28)
        }
        .background(LK.surfacePage.ignoresSafeArea())
    }

    private func roleCard(_ role: Role, primary: Bool, icon: String, title: String, text: String) -> some View {
        Button {
            store.settings.role = role
        } label: {
            HStack(alignment: .top, spacing: 16) {
                Image(systemName: icon)
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(primary ? .white : LK.paper)
                    .frame(width: 48, height: 48)
                    .background(primary ? LK.beacon : LK.surfaceInverse, in: RoundedRectangle(cornerRadius: LK.radiusMd))
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(LK.display(19)).foregroundStyle(LK.textStrong)
                    Text(text).font(LK.sans(14)).foregroundStyle(LK.textMuted).multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
            }
            .padding(20)
            .background(LK.surfaceCard, in: RoundedRectangle(cornerRadius: LK.radiusLg))
            .overlay(
                RoundedRectangle(cornerRadius: LK.radiusLg)
                    .strokeBorder(primary ? LK.beacon : LK.border, lineWidth: primary ? 1.5 : 1)
            )
            .shadow(color: LK.ink.opacity(primary ? 0.16 : 0.05), radius: primary ? 10 : 4, y: primary ? 8 : 2)
        }
        .buttonStyle(.plain)
    }
}

/// 2 · Camera setup, 3 · streaming, and the permission-denied state.
struct CameraFlowView: View {
    @EnvironmentObject private var store: AppStore
    @StateObject private var camera = CameraSession()
    @StateObject private var cry = CryDetector()
    @State private var denied = false

    var body: some View {
        Group {
            if denied {
                CameraDeniedView(retry: start)
            } else if camera.isRunning {
                CameraLiveView(camera: camera, cry: cry, stop: stop)
            } else {
                CameraSetupView(start: start)
            }
        }
    }

    private func start() {
        Task { @MainActor in
            guard await CameraSession.requestAccess(),
                  await camera.start(front: store.settings.frontLens, lowLight: store.settings.lowLight) else {
                denied = true
                return
            }
            denied = false
            if store.settings.cameraMode == .baby && store.settings.cryDetection {
                CryDetector.requestNotificationAccess()
                cry.start(sensitivity: store.settings.sensitivity)
            }
            UIApplication.shared.isIdleTimerDisabled = true // keep streaming with the screen dimmed
        }
    }

    private func stop() {
        cry.stop()
        camera.stop()
        UIApplication.shared.isIdleTimerDisabled = false
    }
}

struct CameraSetupView: View {
    @EnvironmentObject private var store: AppStore
    let start: () -> Void

    var body: some View {
        Form {
            Section {
                TextField("Camera name", text: $store.settings.cameraName)
                    .onChange(of: store.settings.cameraName) { _, name in
                        if name.count > 24 { store.settings.cameraName = String(name.prefix(24)) }
                    }
            } header: {
                Text("Camera name")
            }

            Section {
                Picker("Mode", selection: $store.settings.cameraMode) {
                    Text("Baby monitor").tag(CameraMode.baby)
                    Text("Security cam").tag(CameraMode.security)
                }
                .pickerStyle(.segmented)
            } header: {
                Text("Mode")
            } footer: {
                Text("Baby monitor keeps audio always on and listens for crying. Security cam records on motion.")
            }

            Section("Camera & mic") {
                Picker("Lens", selection: $store.settings.frontLens) {
                    Text("Back camera (wide)").tag(false)
                    Text("Front camera").tag(true)
                }
                LabeledContent("Quality", value: "720p · saves battery")
                Toggle("Low-light boost", isOn: $store.settings.lowLight).tint(LK.switchOn)
            }

            Section {
                Button("Start camera", action: start)
                    .buttonStyle(PrimaryButtonStyle())
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            } footer: {
                Text("Keep it plugged in. The screen can go dark while it streams.")
                    .frame(maxWidth: .infinity, alignment: .center)
            }
        }
        .scrollContentBackground(.hidden)
        .background(LK.surfacePage.ignoresSafeArea())
        .navigationTitle("Set up this camera")
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Back") { store.settings.role = nil }
            }
        }
    }
}

struct CameraLiveView: View {
    @EnvironmentObject private var store: AppStore
    @ObservedObject var camera: CameraSession
    @ObservedObject var cry: CryDetector
    let stop: () -> Void

    @State private var startedAt = Date()
    @State private var lastTouch = Date()
    @State private var battery = Self.readBattery()

    private static let dimAfter: TimeInterval = 10

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { timeline in
            let dimmed = timeline.date.timeIntervalSince(lastTouch) > Self.dimAfter
            ZStack {
                content(now: timeline.date)
                if dimmed {
                    // Dims to near-black after 10 s to keep the room dark; any tap wakes.
                    LK.ink.opacity(0.94).ignoresSafeArea()
                        .contentShape(Rectangle())
                        .onTapGesture { lastTouch = Date() }
                        .accessibilityLabel("Wake screen")
                        .accessibilityAddTraits(.isButton)
                        .transition(.opacity)
                }
            }
            .animation(.easeOut(duration: 0.32), value: dimmed)
        }
        .background(LK.surfacePage.ignoresSafeArea())
        .simultaneousGesture(TapGesture().onEnded { lastTouch = Date() })
        .onAppear {
            UIDevice.current.isBatteryMonitoringEnabled = true
            battery = Self.readBattery()
        }
        .onReceive(NotificationCenter.default.publisher(for: UIDevice.batteryLevelDidChangeNotification)) { _ in
            battery = Self.readBattery()
        }
        .onReceive(NotificationCenter.default.publisher(for: UIDevice.batteryStateDidChangeNotification)) { _ in
            battery = Self.readBattery()
        }
    }

    private func content(now: Date) -> some View {
        VStack(spacing: 24) {
            HStack(spacing: 8) {
                LensEye(ring: LK.textMuted, moon: LK.textMuted, weight: 0.14).frame(width: 22, height: 22)
                Text("This device is a Lookabout camera").font(LK.sans(13)).foregroundStyle(LK.textMuted)
            }

            HStack(spacing: 8) {
                Circle().fill(camera.isPaused ? LK.textMuted : LK.beacon).frame(width: 8, height: 8)
                Text(camera.isPaused ? "PAUSED" : "LIVE").font(LK.mono(12)).tracking(1.9).foregroundStyle(LK.textStrong)
            }
            .padding(.horizontal, 12).padding(.vertical, 6)
            .background(LK.beacon.opacity(0.16), in: Capsule())

            VStack(spacing: 8) {
                Text(store.settings.cameraName.isEmpty ? "Camera" : store.settings.cameraName)
                    .font(LK.display(36)).foregroundStyle(LK.textStrong)
                Text(statusLine).font(LK.sans(15)).foregroundStyle(LK.textMuted).multilineTextAlignment(.center)
            }

            if battery.low {
                VStack(spacing: 10) {
                    Image(systemName: "battery.25").font(.system(size: 28)).foregroundStyle(LK.warning)
                    Text("Battery \(battery.percent)%").font(LK.sans(18, .semibold)).foregroundStyle(LK.textStrong)
                    Text("Plug this device in to keep watching.")
                        .font(LK.sans(14)).foregroundStyle(LK.textBody)
                }
                .padding(22).frame(maxWidth: .infinity)
                .background(LK.warning.opacity(0.12), in: RoundedRectangle(cornerRadius: LK.radiusLg))
                .overlay(RoundedRectangle(cornerRadius: LK.radiusLg).strokeBorder(LK.warning, lineWidth: 1.5))
            } else {
                CameraPreview(session: camera.session)
                    .frame(width: 160, height: 120)
                    .background(LK.surfaceCard)
                    .clipShape(RoundedRectangle(cornerRadius: LK.radiusMd))
                    .overlay(RoundedRectangle(cornerRadius: LK.radiusMd).strokeBorder(LK.border, lineWidth: 1))
                    .opacity(camera.isPaused ? 0.3 : 1)
                    .accessibilityLabel("Small self-view preview of the camera")
            }

            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible())], spacing: 10) {
                stat("MIC", micLine)
                stat("POWER", battery.label)
                stat("UPTIME", uptime(now.timeIntervalSince(startedAt)))
                stat("HUB", "No hub · live only")
            }

            Spacer(minLength: 0)

            Text("Screen dims in 10 s to keep the room dark. Tap to wake.")
                .font(LK.sans(13)).foregroundStyle(LK.textMuted).multilineTextAlignment(.center)

            HStack(spacing: 10) {
                Button(camera.isPaused ? "Resume" : "Pause") { camera.setPaused(!camera.isPaused) }
                    .buttonStyle(OutlineButtonStyle(height: 52))
                Button("Stop camera", action: stop)
                    .buttonStyle(OutlineButtonStyle(filled: true, height: 52))
            }
        }
        .padding(.horizontal, 24).padding(.top, 40).padding(.bottom, 24)
    }

    private var statusLine: String {
        let mode = store.settings.cameraMode == .baby ? "baby monitor mode" : "security cam mode"
        return camera.isPaused ? "Video paused · \(mode)" : "Waiting for a viewer · \(mode)"
    }

    private var micLine: String {
        switch cry.state {
        case .off: return "On"
        case .listening: return "On · cry detection"
        case .crying(let seconds): return "Crying · \(seconds) s"
        }
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(LK.mono(11)).tracking(0.9).foregroundStyle(LK.textMuted)
            Text(value).font(LK.sans(15, .medium)).foregroundStyle(LK.textStrong)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(radius: LK.radiusMd)
        .accessibilityElement(children: .combine)
    }

    private func uptime(_ interval: TimeInterval) -> String {
        let minutes = Int(interval) / 60
        return minutes >= 60 ? "\(minutes / 60)h \(minutes % 60)m" : "\(minutes)m \(Int(interval) % 60)s"
    }

    private static func readBattery() -> (percent: Int, label: String, low: Bool) {
        let device = UIDevice.current
        let percent = Int((device.batteryLevel * 100).rounded())
        switch device.batteryState {
        case .charging, .full: return (percent, "Plugged in", false)
        case .unplugged: return (percent, "Battery \(percent)%", percent < 20)
        default: return (percent, "Not reported", false)
        }
    }
}

/// Camera or microphone refused: explain why and offer the way back in.
struct CameraDeniedView: View {
    @EnvironmentObject private var store: AppStore
    let retry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Image(systemName: "video.slash")
                .font(.system(size: 26)).foregroundStyle(LK.textStrong)
                .frame(width: 64, height: 64)
                .card()
            Text("Lookabout can’t use the camera")
                .font(LK.display(28)).tracking(-0.7).foregroundStyle(LK.textStrong)
            Text("To work as a camera, this phone needs camera and microphone access. Video goes only to your paired viewers, encrypted.")
                .font(LK.sans(15)).foregroundStyle(LK.textBody)

            VStack(spacing: 0) {
                row("Camera", CameraSession.status(for: .video))
                Rectangle().fill(LK.border).frame(height: 1)
                row("Microphone", CameraSession.status(for: .audio))
            }
            .padding(.horizontal, 14)
            .card(radius: LK.radiusMd)

            Spacer()

            Button("Open phone settings") {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            Button("Try again", action: retry).buttonStyle(OutlineButtonStyle())
            Button("Use as viewer instead") { store.settings.role = .viewer }.buttonStyle(OutlineButtonStyle())
        }
        .padding(.horizontal, 24).padding(.top, 48).padding(.bottom, 28)
        .background(LK.surfacePage.ignoresSafeArea())
    }

    private func row(_ label: String, _ status: AVAuthorizationStatus) -> some View {
        HStack {
            Text(label).font(LK.sans(14)).foregroundStyle(LK.textStrong)
            Spacer()
            Text(status == .authorized ? "Allowed" : "Not allowed")
                .font(LK.sans(14, .semibold))
                .foregroundStyle(status == .authorized ? LK.success : LK.danger)
        }
        .frame(height: 48)
    }
}
