import SwiftUI

/// 6 · Alerts & settings. Appearance here applies to the whole app.
struct SettingsView: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        Form {
            Section("Appearance") {
                Picker("Appearance", selection: $store.settings.appearance) {
                    Text("System").tag(Appearance.system)
                    Text("Light").tag(Appearance.light)
                    Text("Dark").tag(Appearance.dark)
                }
                .pickerStyle(.segmented)
            }

            Section("Baby monitor") {
                toggle("Cry detection", "Alert after 20 s of crying", $store.settings.cryDetection)
                Picker(selection: $store.settings.sensitivity) {
                    ForEach(["Low", "Medium", "High"], id: \.self) { Text($0) }
                } label: {
                    label("Sensitivity", "Ignores fan and white noise")
                }
                toggle("Keep audio on in background", "Hear the room with the app closed", $store.settings.backgroundAudio)
            }

            Section("Security cameras") {
                toggle("Motion alerts", "Only inside drawn zones", $store.settings.motionAlerts)
            }

            Section("Recording") {
                LabeledContent {
                    Text("Not set up")
                } label: {
                    label("Home hub", "Live view works without it")
                }
                Picker(selection: $store.settings.keepDays) {
                    ForEach([7, 14, 30], id: \.self) { Text("\($0) days").tag($0) }
                } label: {
                    label("Keep clips for", "Oldest clips delete first")
                }
            }

            Section("This device") {
                Button("Change what this device does") { store.settings.role = nil }
            }

            Section {
                VStack(spacing: 9) {
                    Text("OmniShip").foregroundStyle(LK.textStrong) + Text(" Labs").foregroundStyle(LK.beacon)
                    Text("OPEN MEETS NEW IDEAS").font(LK.mono(11.5)).tracking(1.8).foregroundStyle(LK.beacon)
                    Text("An OmniShip Labs project").font(LK.sans(13.5)).foregroundStyle(LK.textMuted)
                    Text("AGPL-3.0").font(LK.mono(11)).foregroundStyle(LK.textMuted)
                        .padding(.horizontal, 9).padding(.vertical, 2)
                        .overlay(Capsule().strokeBorder(LK.border, lineWidth: 1))
                    Link("omniship.dev", destination: URL(string: "https://omniship.dev")!)
                        .font(LK.mono(12.5)).foregroundStyle(LK.textMuted)
                }
                .font(LK.display(18))
                .frame(maxWidth: .infinity)
                .listRowBackground(Color.clear)
            }
        }
        .scrollContentBackground(.hidden)
        .background(LK.surfacePage.ignoresSafeArea())
        .navigationTitle("Alerts & settings")
        .tint(LK.switchOn)
    }

    private func label(_ title: String, _ sub: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(title).font(LK.sans(14, .medium)).foregroundStyle(LK.textStrong)
            Text(sub).font(LK.sans(12)).foregroundStyle(LK.textMuted)
        }
    }

    private func toggle(_ title: String, _ sub: String, _ value: Binding<Bool>) -> some View {
        Toggle(isOn: value) { label(title, sub) }
    }
}

/// Add a camera that is on your home network (ESP32 or Raspberry Pi).
struct AddCameraView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @StateObject private var discovery = CameraDiscovery()

    @State private var address = ""
    @State private var name = ""
    @State private var testURL: URL?
    @State private var error = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("An ESP32-S3 with a USB webcam, or a Raspberry Pi camera, running the Lookabout firmware on your Wi-Fi.")
                        .font(LK.sans(14)).foregroundStyle(LK.textMuted)

                    if !discovery.found.isEmpty {
                        Text("FOUND ON YOUR NETWORK").eyebrow()
                        VStack(spacing: 0) {
                            ForEach(discovery.found) { cam in
                                Button {
                                    address = cam.address
                                    if name.isEmpty { name = cam.name }
                                    testURL = AppStore.normalize(cam.address)?.appendingPathComponent("stream")
                                } label: {
                                    HStack {
                                        VStack(alignment: .leading, spacing: 1) {
                                            Text(cam.name).font(LK.sans(14, .semibold)).foregroundStyle(LK.textStrong)
                                            Text(cam.address).font(LK.mono(12)).foregroundStyle(LK.textMuted)
                                        }
                                        Spacer()
                                        Pill(text: "LIVE", tone: .success, small: true)
                                    }
                                    .frame(minHeight: 60)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.horizontal, 14)
                        .card(radius: LK.radiusMd)
                    }

                    field("Camera address on your network", text: $address, placeholder: "lookabout-cam.local", mono: true)
                    if error {
                        Text("That doesn’t look like an address. Try lookabout-cam.local or the camera’s IP address.")
                            .font(LK.sans(12)).foregroundStyle(LK.danger)
                    }

                    VideoTile(streamURL: testURL, placeholder: "TEST PREVIEW")
                        .frame(height: 180)
                        .accessibilityLabel("Test preview from the camera")

                    Button("Test the stream") {
                        testURL = AppStore.normalize(address)?.appendingPathComponent("stream")
                        error = testURL == nil
                    }
                    .buttonStyle(OutlineButtonStyle())

                    field("Name", text: $name, placeholder: "Garage", mono: false)

                    Button("Add this camera") {
                        if store.addCamera(name: name.trimmingCharacters(in: .whitespaces), device: "ON WI-FI", address: address) {
                            dismiss()
                        } else {
                            error = true
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(address.isEmpty || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                .padding(.horizontal, LK.side)
                .padding(.vertical, 16)
            }
            .background(LK.surfacePage.ignoresSafeArea())
            .navigationTitle("Add a camera")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .onAppear { discovery.start() }
            .onDisappear { discovery.stop() }
        }
    }

    private func field(_ label: String, text: Binding<String>, placeholder: String, mono: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(LK.sans(13, .semibold)).foregroundStyle(LK.textStrong)
            TextField(placeholder, text: text)
                .font(mono ? LK.mono(14) : LK.sans(16, .medium))
                .textInputAutocapitalization(mono ? .never : .words)
                .autocorrectionDisabled(mono)
                .keyboardType(mono ? .URL : .default)
                .padding(.horizontal, 14)
                .frame(height: 44)
                .background(LK.surfaceCard, in: RoundedRectangle(cornerRadius: LK.radiusSm))
                .overlay(RoundedRectangle(cornerRadius: LK.radiusSm).strokeBorder(LK.borderStrong, lineWidth: 1))
        }
    }
}
