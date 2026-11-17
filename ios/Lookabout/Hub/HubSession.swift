import AuthenticationServices
import Foundation
import Security
import UIKit

/// The token lives in the Keychain, never in UserDefaults and never in a URL.
enum TokenVault {
    private static let service = "dev.omniship.lookabout.hub"

    static func save(_ token: String) {
        delete()
        let item: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "token",
            kSecValueData as String: Data(token.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        SecItemAdd(item as CFDictionary, nil)
    }

    static func load() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "token",
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func delete() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "token",
        ]
        SecItemDelete(query as CFDictionary)
    }
}

/// Which hub this device is signed in to, and as whom.
@MainActor
final class HubSession: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
    private static let key = "lookabout-hub"

    @Published private(set) var signIn: HubSignIn?
    @Published private(set) var me: HubMe?
    @Published var busy = false
    @Published var error: String?
    /// A QR or link asked to pair with this hub; the sign-in screen fills it in.
    @Published var pendingLink: HubLinkRequest?
    /// Set when a 401 ended the session, so the screen can say so.
    @Published private(set) var endedMessage: String?

    private var webSession: ASWebAuthenticationSession?

    var isSignedIn: Bool { signIn != nil }
    var deviceName: String { UIDevice.current.name }

    override init() {
        super.init()
        if let data = UserDefaults.standard.data(forKey: Self.key),
           let saved = try? JSONDecoder().decode(HubSignIn.self, from: data), TokenVault.load() != nil {
            signIn = saved
        }
    }

    private var client: HubClient? {
        guard let signIn, let base = URL(string: signIn.address) else { return nil }
        return HubClient(base: base, token: TokenVault.load())
    }

    private func store(_ granted: HubClient.Granted, address: URL) {
        TokenVault.save(granted.token)
        let saved = HubSignIn(address: address.absoluteString, hubID: granted.hubID, hubName: granted.hubName)
        signIn = saved
        me = granted.me
        endedMessage = nil
        if let data = try? JSONEncoder().encode(saved) { UserDefaults.standard.set(data, forKey: Self.key) }
    }

    private func clear() {
        TokenVault.delete()
        UserDefaults.standard.removeObject(forKey: Self.key)
        signIn = nil
        me = nil
    }

    /// Run a hub call. A 401 means the session ended (30 days, or removed under
    /// Paired devices), so the sign-in is dropped and the person goes back to sign-in.
    func call<T>(_ work: (HubClient) async throws -> T) async -> T? {
        guard let client else { return nil }
        do { return try await work(client) } catch let failure as HubFailure {
            if failure == .notSignedIn {
                clear()
                endedMessage = "Your session ended. Sign in again."
            } else {
                error = failure.message
            }
        } catch { self.error = HubFailure.unreachable.message }
        return nil
    }

    /// `GET /api/me`: what this member may see and do.
    func refresh() async {
        if let fresh = await call({ try await $0.me() }), let fresh { me = fresh }
    }

    // MARK: Ways to sign in

    private func attempt(address: String, wrongLogin: String? = nil, _ work: (HubClient) async throws -> HubClient.Granted) async {
        guard let base = HubAddress.normalize(address) else { error = "Enter the hub’s address, like lookabout.local."; return }
        busy = true; error = nil
        defer { busy = false }
        do { store(try await work(HubClient(base: base)), address: base) } catch let failure as HubFailure {
            error = failure == .notSignedIn ? (wrongLogin ?? failure.message) : failure.message
        } catch { self.error = HubFailure.unreachable.message }
    }

    func pair(address: String, code: String) async {
        await attempt(address: address, wrongLogin: "That code is wrong or has run out. Ask an admin for a new one.") {
            try await $0.pair(code: code.trimmingCharacters(in: .whitespaces), name: deviceName)
        }
    }

    func signIn(address: String, email: String, password: String) async {
        await attempt(address: address, wrongLogin: "That email or password isn’t right.") {
            try await $0.signIn(email: email.trimmingCharacters(in: .whitespaces), password: password, device: deviceName)
        }
    }

    /// Google or Apple, in a system browser sheet that ends on `lookabout://hub/signed-in?code=…`,
    /// then the one-time code is swapped for the token with the PKCE verifier.
    func browserSignIn(address: String, provider: String) async {
        guard let base = HubAddress.normalize(address) else { error = "Enter the hub’s address, like lookabout.local."; return }
        busy = true; error = nil
        defer { busy = false }
        let pkce = PKCE.make()
        do {
            let url = try await HubClient(base: base).providerRedirect(provider, challenge: pkce.challenge)
            let callback = try await openSheet(url)
            switch HubLink.parse(callback) {
            case let .signedIn(code):
                store(try await HubClient(base: base).exchange(code: code, verifier: pkce.verifier, device: deviceName), address: base)
            case let .signInFailed(message): error = message
            default: error = "The sign-in didn’t finish. Try again."
            }
        } catch let failure as HubFailure { error = failure.message } catch let err as ASWebAuthenticationSessionError where err.code == .canceledLogin {
            // The person closed the sheet.
        } catch { self.error = "The sign-in didn’t finish. Try again." }
    }

    /// A `lookabout://hub?address=…&code=…` link (the QR an admin makes) opens the pairing form with both filled in.
    func handle(_ url: URL) {
        if case let .pair(address, code)? = HubLink.parse(url) { pendingLink = HubLinkRequest(address: address, code: code) }
    }

    private func openSheet(_ url: URL) async throws -> URL {
        try await withCheckedThrowingContinuation { cont in
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "lookabout") { callback, error in
                if let callback { cont.resume(returning: callback) } else { cont.resume(throwing: error ?? HubFailure.unreachable) }
            }
            session.presentationContextProvider = self
            self.webSession = session
            if !session.start() { cont.resume(throwing: HubFailure.unreachable) }
        }
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first ?? ASPresentationAnchor()
        }
    }

    // MARK: Signed in

    func signOut() async {
        if let client { _ = try? await client.signOut() } // best effort: the token is dropped either way
        clear()
    }
}

struct HubLinkRequest: Equatable { let address: String; let code: String }
