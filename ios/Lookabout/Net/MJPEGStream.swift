import Network
import SwiftUI
import UIKit

/// Live video from an ESP32 or Raspberry Pi camera on the home network
/// (multipart MJPEG at `/stream`).
final class MJPEGStream: NSObject, ObservableObject, URLSessionDataDelegate {
    @Published private(set) var image: UIImage?
    @Published private(set) var isConnected = false

    private var session: URLSession?
    private var url: URL?
    private var buffer = Data()
    private static let soi = Data([0xFF, 0xD8])
    private static let eoi = Data([0xFF, 0xD9])

    func start(_ url: URL) {
        stop()
        self.url = url
        connect()
    }

    func stop() {
        url = nil
        session?.invalidateAndCancel()
        session = nil
        buffer.removeAll()
        isConnected = false
    }

    private func connect() {
        guard let url else { return }
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 15
        let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
        self.session = session
        session.dataTask(with: url).resume()
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        buffer.append(data)
        var newest: UIImage?
        while let start = buffer.range(of: Self.soi),
              let end = buffer.range(of: Self.eoi, in: start.upperBound..<buffer.endIndex) {
            newest = UIImage(data: buffer.subdata(in: start.lowerBound..<end.upperBound)) ?? newest
            buffer.removeSubrange(buffer.startIndex..<end.upperBound)
        }
        if buffer.count > 4_000_000 { buffer.removeAll() } // not MJPEG, or badly corrupt
        if let newest {
            DispatchQueue.main.async {
                self.image = newest
                self.isConnected = true
            }
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        DispatchQueue.main.async {
            guard self.session === session else { return } // stopped or replaced
            self.isConnected = false
            self.buffer.removeAll()
            // Keep the last frame on screen and retry, like the spec's reconnecting state.
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                guard self.session === session else { return }
                self.connect()
            }
        }
    }
}

/// Finds Lookabout cameras on the network (`_lookabout._tcp`, advertised by
/// the ESP32 and Raspberry Pi firmware).
final class CameraDiscovery: ObservableObject {
    struct Found: Identifiable, Equatable {
        let id: String
        let name: String
        /// Address to add the camera with, e.g. "lookabout-cam.local".
        let address: String
    }

    @Published private(set) var found: [Found] = []
    private var browser: NWBrowser?

    func start() {
        let browser = NWBrowser(for: .bonjour(type: "_lookabout._tcp", domain: nil), using: .tcp)
        browser.browseResultsChangedHandler = { [weak self] results, _ in
            let found = results.compactMap { result -> Found? in
                guard case let .service(name, _, _, _) = result.endpoint else { return nil }
                // The ESP32 firmware advertises under its host name; the Pi's
                // service name is "Lookabout camera on <host>", port 8080.
                if let host = name.components(separatedBy: " on ").last, name.contains(" on ") {
                    return Found(id: name, name: host, address: "\(host).local:8080")
                }
                return Found(id: name, name: name, address: "\(name).local")
            }
            DispatchQueue.main.async { self?.found = found }
        }
        browser.start(queue: .main)
        self.browser = browser
    }

    func stop() {
        browser?.cancel()
        browser = nil
    }
}
