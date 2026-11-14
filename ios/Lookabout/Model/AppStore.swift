import Foundation
import SwiftUI

enum Role: String, Codable { case camera, viewer }
enum CameraMode: String, Codable, CaseIterable { case baby, security }
enum Appearance: String, Codable, CaseIterable { case system, light, dark }

/// A camera the viewer knows about.
struct Camera: Identifiable, Codable, Equatable, Hashable {
    var id: String
    var name: String
    var device: String
    var motion = false
    /// Set for cameras on your own network (ESP32, Raspberry Pi): their MJPEG stream.
    var streamURL: URL?
    /// Sample content from the design, until pairing and the hub exist.
    var isSample = false
}

/// Settings kept on this device.
struct Settings: Codable, Equatable {
    var appearance: Appearance = .system
    var role: Role?
    var cameraName = "Nursery"
    var cameraMode: CameraMode = .baby
    var frontLens = false
    var lowLight = true
    var cryDetection = true
    var sensitivity = "Medium"
    var backgroundAudio = true
    var motionAlerts = true
    var keepDays = 14
    var directCameras: [Camera] = []
}

final class AppStore: ObservableObject {
    private static let key = "lookabout-settings"

    @Published var settings: Settings {
        didSet {
            if let data = try? JSONEncoder().encode(settings) {
                UserDefaults.standard.set(data, forKey: Self.key)
            }
        }
    }

    init() {
        if let data = UserDefaults.standard.data(forKey: Self.key),
           let saved = try? JSONDecoder().decode(Settings.self, from: data) {
            settings = saved
        } else {
            settings = Settings()
        }
    }

    /// Cameras on your network first, then the design's sample cameras.
    var cameras: [Camera] { settings.directCameras + SampleData.houseCameras }

    var colorScheme: ColorScheme? {
        switch settings.appearance {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }

    func addCamera(name: String, device: String, address: String) -> Bool {
        guard let base = Self.normalize(address) else { return false }
        let camera = Camera(
            id: UUID().uuidString,
            name: name,
            device: device,
            streamURL: base.appendingPathComponent("stream")
        )
        settings.directCameras.append(camera)
        return true
    }

    func remove(_ camera: Camera) {
        settings.directCameras.removeAll { $0.id == camera.id }
    }

    /// "lookabout-cam.local" or "192.168.1.20:8080" → http URL.
    static func normalize(_ address: String) -> URL? {
        var text = address.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        if !text.lowercased().hasPrefix("http://") && !text.lowercased().hasPrefix("https://") {
            text = "http://" + text
        }
        while text.hasSuffix("/") { text.removeLast() }
        guard let url = URL(string: text), url.host != nil else { return nil }
        return url
    }
}

/// Sample content from the Lookabout design (names, times, levels). Stands in
/// for live data until pairing, streaming and the home hub are built.
enum SampleData {
    struct RoomCamera: Identifiable, Equatable {
        let id: String
        let name: String
        let level: Double // 0–100
    }

    struct Event: Identifiable {
        enum Tone { case warning, success, muted }
        let id = UUID()
        let time: String
        let label: String
        let meta: String
        let tone: Tone
    }

    struct Clip: Identifiable {
        let id = UUID()
        let kind: String
        let title: String
        let meta: String
        let time: String
    }

    static let roomName = "Nursery"
    static let roomCameras = [
        RoomCamera(id: "over", name: "Crib overhead", level: 12),
        RoomCamera(id: "side", name: "Crib side", level: 64),
        RoomCamera(id: "mat", name: "Play mat", level: 6),
    ]
    static let levelThreshold = 40.0
    static let cryBarThreshold = 12

    static let soundLevels = [
        3, 4, 3, 5, 4, 3, 4, 6, 5, 4, 3, 3, 4, 5, 8, 14, 22, 28, 24, 18,
        12, 8, 6, 5, 4, 4, 3, 3, 4, 3, 3, 4, 3, 3, 4, 3, 3, 3, 4, 3,
    ]

    static let tonight = [
        Event(time: "1:00 AM", label: "Crying", meta: "2 min · clip", tone: .warning),
        Event(time: "12:14 AM", label: "Stirring", meta: "30 s", tone: .muted),
        Event(time: "10:48 PM", label: "Fell asleep", meta: "quiet 2h", tone: .success),
    ]

    static let houseCameras = [
        Camera(id: "front", name: "Front door", device: "OLD PIXEL", motion: true, isSample: true),
        Camera(id: "driveway", name: "Driveway", device: "USB CAM", isSample: true),
        Camera(id: "backyard", name: "Backyard", device: "IPAD", isSample: true),
        Camera(id: "nursery", name: "Nursery", device: "PHONE", isSample: true),
    ]

    static let clipsToday = [
        Clip(kind: "motion", title: "Motion · Front door", meta: "18 s · porch zone", time: "2:03 PM"),
        Clip(kind: "motion", title: "Motion · Driveway", meta: "42 s · gate zone", time: "11:20 AM"),
        Clip(kind: "sound", title: "Sound · Nursery", meta: "Crying · 2 min", time: "1:00 AM"),
    ]

    static let eventDays: [(label: String, items: [Clip])] = [
        ("TODAY", [
            Clip(kind: "crying", title: "Crying · Nursery", meta: "2 min · clip", time: "1:00 AM"),
            Clip(kind: "motion", title: "Motion · Front door", meta: "Porch zone · 18 s", time: "11:20 PM"),
            Clip(kind: "offline", title: "Offline · Driveway", meta: "Back after 6 min", time: "10:02 PM"),
        ]),
        ("YESTERDAY", [
            Clip(kind: "stirring", title: "Stirring · Nursery", meta: "40 s", time: "3:15 AM"),
            Clip(kind: "motion", title: "Motion · Backyard", meta: "Lawn zone · 32 s", time: "7:48 PM"),
        ]),
    ]
}
