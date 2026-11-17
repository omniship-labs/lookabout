import SwiftUI

/// Settings → Home hub: sign in, or who you're signed in as and which devices are signed in.
struct HubAccountView: View {
    @EnvironmentObject private var hub: HubSession

    var body: some View {
        Group {
            if hub.isSignedIn { HubSignedInView() } else { HubSignInView() }
        }
        .navigationTitle("Home hub")
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct HubSignInView: View {
    @EnvironmentObject private var hub: HubSession
    @State private var address = ""
    @State private var code = ""
    @State private var email = ""
    @State private var password = ""

    var body: some View {
        Form {
            if let ended = hub.endedMessage {
                Section { Text(ended).foregroundStyle(LK.warning) }
            }
            Section("Hub address") {
                TextField("lookabout.local", text: $address)
                    .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
            }
            Section {
                TextField("Pairing code", text: $code)
                    .textInputAutocapitalization(.characters).autocorrectionDisabled()
                Button("Pair this device") { Task { await hub.pair(address: address, code: code) } }
                    .disabled(address.isEmpty || code.isEmpty || hub.busy)
            } header: { Text("Pairing code") } footer: {
                Text("An admin makes one for you on the hub’s page, or scan its QR code.")
            }
            Section("Email and password") {
                TextField("Email", text: $email)
                    .textContentType(.username).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.emailAddress)
                SecureField("Password", text: $password).textContentType(.password)
                Button("Sign in") { Task { await hub.signIn(address: address, email: email, password: password) } }
                    .disabled(address.isEmpty || email.isEmpty || password.isEmpty || hub.busy)
            }
            Section("Or continue with") {
                Button("Continue with Google") { Task { await hub.browserSignIn(address: address, provider: "google") } }
                Button("Continue with Apple") { Task { await hub.browserSignIn(address: address, provider: "apple") } }
            }
            .disabled(address.isEmpty || hub.busy)
            if let error = hub.error {
                Section { Text(error).foregroundStyle(LK.danger) }
            }
        }
        .scrollContentBackground(.hidden)
        .background(LK.surfacePage.ignoresSafeArea())
        .tint(LK.switchOn)
        .onAppear(perform: takeLink)
        .onChange(of: hub.pendingLink) { _ in takeLink() }
    }

    private func takeLink() {
        guard let link = hub.pendingLink else { return }
        address = link.address
        code = link.code
        hub.pendingLink = nil
    }
}

struct HubSignedInView: View {
    @EnvironmentObject private var hub: HubSession
    @State private var devices: [HubClient.Device] = []

    var body: some View {
        Form {
            if let me = hub.me {
                Section {
                    LabeledContent("Signed in as", value: me.member.name)
                    LabeledContent("Household", value: me.householdName)
                    LabeledContent("Access", value: me.isAdmin ? "Admin · every camera" : "\(me.cameras?.count ?? 0) cameras")
                }
            }
            Section("Signed-in devices") {
                ForEach(devices) { device in
                    HStack {
                        Text(device.name)
                        Spacer()
                        if device.current { Pill(text: "THIS DEVICE", small: true) }
                        else {
                            Button("End", role: .destructive) {
                                Task { _ = await hub.call { try await $0.endDevice(device.id) }; await load() }
                            }
                        }
                    }
                }
            }
            Section {
                Button("Sign out", role: .destructive) { Task { await hub.signOut() } }
            } footer: { Text(hub.signIn?.address ?? "") }
            if let error = hub.error { Section { Text(error).foregroundStyle(LK.danger) } }
        }
        .scrollContentBackground(.hidden)
        .background(LK.surfacePage.ignoresSafeArea())
        .tint(LK.switchOn)
        .task { await hub.refresh(); await load() }
    }

    private func load() async { devices = await hub.call { try await $0.devices() } ?? [] }
}
