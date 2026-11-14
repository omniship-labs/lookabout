import Foundation

/// Firmware for ESP32 cameras, updated over Wi-Fi (`POST /api/update`).
///
/// iOS cannot flash a board over USB: apps have no access to generic USB
/// serial devices. The first flash is done from the web page (Chrome or Edge
/// on a computer) or the Android app; after that this app can update the
/// camera over the home network with the firmware image it carries.
final class FirmwareUpdater: NSObject, ObservableObject, URLSessionTaskDelegate {
    enum State: Equatable {
        case checking
        case unreachable
        /// A Raspberry Pi node: it updates with its own installer.
        case notABoard
        case ready(current: String)
        case updating(progress: Double)
        case done
        case failed(String)
    }

    struct Bundled: Decodable {
        let version: String
        let file: String
    }

    @Published private(set) var state: State = .checking

    /// The firmware image packaged into the app by `npm run firmware:package`.
    static let bundled: Bundled? = {
        guard let url = Bundle.main.url(forResource: "firmware", withExtension: "json"),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(Bundled.self, from: data)
    }()

    private let base: URL
    private lazy var session = URLSession(configuration: .ephemeral, delegate: self, delegateQueue: .main)

    /// `streamURL` is the camera's `/stream` address; the board's API sits beside it.
    init(streamURL: URL) {
        base = streamURL.deletingLastPathComponent()
        super.init()
    }

    var isUpToDate: Bool {
        if case let .ready(current) = state { return current == Self.bundled?.version }
        return false
    }

    func check() {
        state = .checking
        var request = URLRequest(url: base.appendingPathComponent("api/status"))
        request.timeoutInterval = 5
        session.dataTask(with: request) { [weak self] data, _, _ in
            guard let self else { return }
            guard let data, let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                self.state = .unreachable
                return
            }
            if json["source"] != nil {
                self.state = .notABoard
            } else {
                self.state = .ready(current: json["firmware"] as? String ?? "unknown")
            }
        }.resume()
    }

    func update() {
        guard let bundled = Self.bundled,
              let file = Bundle.main.url(forResource: (bundled.file as NSString).deletingPathExtension, withExtension: "bin") else {
            state = .failed("This build of the app doesn’t carry a firmware image.")
            return
        }
        state = .updating(progress: 0)
        var request = URLRequest(url: base.appendingPathComponent("api/update"))
        request.httpMethod = "POST"
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 120
        session.uploadTask(with: request, fromFile: file) { [weak self] data, response, error in
            guard let self else { return }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if error == nil, (200..<300).contains(status) {
                self.state = .done
                // The camera restarts into the new firmware.
                DispatchQueue.main.asyncAfter(deadline: .now() + 8) { self.check() }
            } else {
                let message = data.flatMap { String(data: $0, encoding: .utf8) }.flatMap { $0.isEmpty ? nil : $0 }
                self.state = .failed(message ?? "Could not reach the camera. Check that it is on and on this Wi-Fi.")
            }
        }.resume()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64,
                    totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        guard totalBytesExpectedToSend > 0, case .updating = state else { return }
        state = .updating(progress: Double(totalBytesSent) / Double(totalBytesExpectedToSend))
    }
}
