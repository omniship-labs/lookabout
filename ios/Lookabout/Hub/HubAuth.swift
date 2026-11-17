import CryptoKit
import Foundation

// Sign-in logic for the home hub (docs/hub-auth.md), kept free of UI so it can
// get a test target later. Nothing here touches the network or the Keychain.

/// PKCE (RFC 7636, S256) for the browser sign-in that ends on `lookabout://hub/signed-in`.
struct PKCE: Equatable {
    let verifier: String
    let challenge: String

    init(verifier: String) {
        self.verifier = verifier
        self.challenge = Self.challenge(for: verifier)
    }

    /// A fresh random verifier (43 characters of base64url, 32 random bytes).
    static func make() -> PKCE {
        var bytes = [UInt8](repeating: 0, count: 32)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        precondition(status == errSecSuccess, "no secure random bytes")
        return PKCE(verifier: base64url(Data(bytes)))
    }

    static func challenge(for verifier: String) -> String {
        base64url(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    static func base64url(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

/// What a `lookabout://` link asks the app to do.
enum HubLink: Equatable {
    /// `lookabout://hub?address=…&code=…`: the QR an admin makes. Pairs this device.
    case pair(address: String, code: String)
    /// `lookabout://hub/signed-in?code=…`: the end of a browser sign-in.
    case signedIn(code: String)
    /// `lookabout://hub/signed-in?error=…` (the hub may say why).
    case signInFailed(message: String)

    static func parse(_ url: URL) -> HubLink? {
        guard url.scheme?.lowercased() == "lookabout", url.host?.lowercased() == "hub",
              let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        func value(_ name: String) -> String? {
            parts.queryItems?.first { $0.name == name }?.value.flatMap { $0.isEmpty ? nil : $0 }
        }
        let path = parts.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        switch path {
        case "":
            guard let address = value("address"), let code = value("code") else { return nil }
            return .pair(address: address, code: code)
        case "signed-in":
            if let code = value("code") { return .signedIn(code: code) }
            if value("error") != nil { return .signInFailed(message: value("message") ?? "That sign-in didn’t work.") }
            return nil
        default:
            return nil
        }
    }
}

enum HubAddress {
    static let defaultPort = 8787

    /// "lookabout.local" or "192.168.1.5" → "http://host:8787"; an address with a port or https is kept as typed.
    static func normalize(_ text: String) -> URL? {
        var value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return nil }
        let hadScheme = value.lowercased().hasPrefix("http://") || value.lowercased().hasPrefix("https://")
        if !hadScheme { value = "http://" + value }
        guard var parts = URLComponents(string: value), let host = parts.host, !host.isEmpty else { return nil }
        if parts.port == nil && parts.scheme?.lowercased() == "http" { parts.port = defaultPort }
        parts.path = ""
        parts.query = nil
        parts.fragment = nil
        return parts.url
    }
}

/// The hub's stable error `code`s the app switches on.
enum HubFailure: Error, Equatable {
    case unreachable
    case notSignedIn          // 401: the session ended; go back to sign-in
    case notFound             // 404: no such thing, or not yours
    case manageOnly, adminOnly
    case tooManyTries(retryAfter: Int?)
    case setupRequired        // 423
    case other(status: Int, message: String)

    static func from(status: Int, body: Data?, retryAfter: String? = nil) -> HubFailure {
        let json = body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        let code = json?["code"] as? String
        let message = (json?["error"] as? String) ?? "The hub answered \(status)."
        switch (status, code) {
        case (401, _): return .notSignedIn
        case (423, _): return .setupRequired
        case (429, _): return .tooManyTries(retryAfter: retryAfter.flatMap { Int($0) })
        case (403, "admin_only"): return .adminOnly
        case (403, "manage_only"): return .manageOnly
        case (404, _): return .notFound
        default: return .other(status: status, message: message)
        }
    }

    var message: String {
        switch self {
        case .unreachable: return "The hub isn’t answering. Check its address and that this device is on the same network."
        case .notSignedIn: return "That didn’t work. Check the details and try again."
        case .notFound: return "The hub has no such thing, or you can’t see it."
        case .manageOnly: return "You can view this camera but not change it."
        case .adminOnly: return "Only an admin can do that."
        case let .tooManyTries(seconds):
            return seconds.map { "Too many tries. Wait \(max(1, ($0 + 59) / 60)) min and try again." } ?? "Too many tries. Wait a bit and try again."
        case .setupRequired: return "This hub hasn’t been set up yet. Finish setup on its page first."
        case let .other(_, message): return message
        }
    }
}

/// The hub's `GET /api/me`, enough to decide what to show. The hub checks everything itself.
struct HubMe: Equatable {
    struct Member: Equatable { let id: String; let name: String; let email: String?; let role: String }
    enum Access: String { case view, manage }

    let member: Member
    let householdName: String
    let sessionID: String?
    /// nil = every camera (admin). Otherwise camera id → level.
    let cameras: [String: Access]?

    var isAdmin: Bool { member.role == "admin" }

    func access(to cameraID: String) -> Access? {
        guard let cameras else { return .manage }
        return cameras[cameraID]
    }

    func canSee(_ cameraID: String) -> Bool { access(to: cameraID) != nil }
    func canManage(_ cameraID: String) -> Bool { access(to: cameraID) == .manage }

    /// Delete, Zones and Rename are only offered with `manage`.
    func visible<T>(_ items: [T], id: (T) -> String) -> [T] { items.filter { canSee(id($0)) } }

    static func parse(_ object: Any?) -> HubMe? {
        guard let json = object as? [String: Any],
              let m = json["member"] as? [String: Any],
              let id = m["id"] as? String, let name = m["name"] as? String, let role = m["role"] as? String
        else { return nil }
        var cameras: [String: Access]?
        if let map = json["cameras"] as? [String: String] {
            cameras = map.compactMapValues(Access.init(rawValue:))
        } else if (json["cameras"] as? String) != "all" {
            cameras = [:] // anything unexpected shows nothing rather than everything
        }
        return HubMe(
            member: Member(id: id, name: name, email: m["email"] as? String, role: role),
            householdName: ((json["household"] as? [String: Any])?["name"] as? String) ?? "Home",
            sessionID: (json["session"] as? [String: Any])?["id"] as? String,
            cameras: cameras
        )
    }
}

/// The saved sign-in, without the token (that lives in the Keychain).
struct HubSignIn: Codable, Equatable {
    var address: String
    var hubID: String
    var hubName: String
}
