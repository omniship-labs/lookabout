import Foundation

/// One hub, one bearer token. The token goes in the `Authorization` header and
/// nowhere else: never in a URL (media uses tickets).
struct HubClient {
    let base: URL
    var token: String?

    private func request(_ method: String, _ path: String, body: [String: Any]? = nil) throws -> URLRequest {
        guard let url = URL(string: path, relativeTo: base)?.absoluteURL else { throw HubFailure.unreachable }
        var req = URLRequest(url: url, timeoutInterval: 10)
        req.httpMethod = method
        req.cachePolicy = .reloadIgnoringLocalCacheData
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        return req
    }

    @discardableResult
    func send(_ method: String, _ path: String, body: [String: Any]? = nil) async throws -> Any? {
        let req = try request(method, path, body: body)
        let data: Data, response: URLResponse
        do { (data, response) = try await URLSession.shared.data(for: req) } catch { throw HubFailure.unreachable }
        guard let http = response as? HTTPURLResponse else { throw HubFailure.unreachable }
        guard (200..<300).contains(http.statusCode) else {
            throw HubFailure.from(status: http.statusCode, body: data, retryAfter: http.value(forHTTPHeaderField: "Retry-After"))
        }
        return data.isEmpty ? nil : try? JSONSerialization.jsonObject(with: data)
    }

    // MARK: Sign-in (docs/hub-auth.md)

    struct Granted { let token: String; let me: HubMe?; let hubID: String; let hubName: String }

    func providers() async throws -> [String: Any] {
        (try await send("GET", "/api/auth/providers") as? [String: Any]) ?? [:]
    }

    func pair(code: String, name: String) async throws -> Granted {
        let j = try await send("POST", "/api/pair", body: ["code": code, "name": name, "platform": "ios"]) as? [String: Any]
        return try await granted(j, tokenKey: "token")
    }

    func signIn(email: String, password: String, device: String) async throws -> Granted {
        let j = try await send("POST", "/api/auth/login/local?app=1", body: ["email": email, "password": password, "device": device]) as? [String: Any]
        return try await granted(j, tokenKey: "token")
    }

    /// Where to send the system browser sheet for Google or Apple.
    func providerRedirect(_ provider: String, challenge: String) async throws -> URL {
        let j = try await send("POST", "/api/auth/login/\(provider)", body: ["return_to": "/", "app": true, "code_challenge": challenge]) as? [String: Any]
        guard let text = j?["redirect"] as? String, let url = URL(string: text) else { throw HubFailure.other(status: 0, message: "The hub gave no sign-in address.") }
        return url
    }

    func exchange(code: String, verifier: String, device: String) async throws -> Granted {
        let j = try await send("POST", "/api/auth/token", body: ["code": code, "code_verifier": verifier, "device": device]) as? [String: Any]
        return try await granted(j, tokenKey: "token")
    }

    private func granted(_ j: [String: Any]?, tokenKey: String) async throws -> Granted {
        guard let token = j?[tokenKey] as? String, !token.isEmpty else { throw HubFailure.other(status: 0, message: "The hub didn’t give a session.") }
        let info = try await send("GET", "/api/hub") as? [String: Any]
        var authed = self
        authed.token = token
        var me = HubMe.parse(j?["me"])
        if me == nil { me = (try? await authed.me()) ?? nil }
        return Granted(token: token, me: me, hubID: (info?["id"] as? String) ?? "", hubName: (info?["name"] as? String) ?? "Home hub")
    }

    // MARK: Signed in

    func me() async throws -> HubMe? { HubMe.parse(try await send("GET", "/api/me")) }
    func signOut() async throws { try await send("POST", "/api/auth/logout") }

    struct Device: Identifiable, Equatable { let id: String; let name: String; let current: Bool }

    func devices() async throws -> [Device] {
        let list = (try await send("GET", "/api/me/sessions") as? [String: Any])?["sessions"] as? [[String: Any]] ?? []
        return list.compactMap { s in
            guard let id = s["id"] as? String else { return nil }
            return Device(id: id, name: (s["device"] as? String) ?? "Device", current: (s["you"] as? Bool) ?? false)
        }
    }

    func endDevice(_ id: String) async throws {
        try await send("DELETE", "/api/me/sessions/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)")
    }

    /// A five-minute ticket for one camera's stream, snapshot or clip. Use as `?ticket=`.
    func ticket(camera id: String) async throws -> String {
        let j = try await send("POST", "/api/cameras/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)/ticket", body: [:]) as? [String: Any]
        guard let t = j?["ticket"] as? String else { throw HubFailure.other(status: 0, message: "The hub gave no ticket.") }
        return t
    }
}
