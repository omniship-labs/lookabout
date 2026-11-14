import AVFoundation
import SoundAnalysis
import UserNotifications

/// On-device cry detection for a camera in baby-monitor mode.
///
/// Uses Apple's built-in sound classifier (SoundAnalysis, `.version1`), which
/// runs entirely on this device: no audio leaves it. The classifier's labels
/// are looked up at runtime and any that describe a baby or infant crying are
/// used, so the exact label spelling isn't hard-coded.
///
/// Rule from the spec: crying at or above the threshold for 20 seconds raises
/// an alert.
final class CryDetector: NSObject, ObservableObject, SNResultsObserving {
    enum State: Equatable { case off, listening, crying(seconds: Int) }

    @Published private(set) var state: State = .off
    /// 0–1 loudness of the room, for the camera screen.
    @Published private(set) var level: Double = 0

    private let engine = AVAudioEngine()
    private var analyzer: SNAudioStreamAnalyzer?
    private let queue = DispatchQueue(label: "dev.omniship.lookabout.cry")
    private var cryLabels: Set<String> = []
    private var cryingSince: Date?
    private var alerted = false

    /// Confidence needed to count a window as crying, by sensitivity setting.
    private var threshold = 0.6
    static let alertAfterSeconds = 20.0

    func start(sensitivity: String) {
        guard state == .off else { return }
        threshold = ["Low": 0.8, "Medium": 0.6, "High": 0.4][sensitivity] ?? 0.6

        do {
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .mixWithOthers])
            try audio.setActive(true)

            let request = try SNClassifySoundRequest(classifierIdentifier: .version1)
            cryLabels = Set(request.knownClassifications.filter { label in
                let name = label.lowercased()
                return name.contains("cry") && (name.contains("baby") || name.contains("infant"))
            })
            guard !cryLabels.isEmpty else { return }

            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0 else { return } // no microphone (e.g. Simulator)
            let analyzer = SNAudioStreamAnalyzer(format: format)
            try analyzer.add(request, withObserver: self)
            self.analyzer = analyzer

            input.installTap(onBus: 0, bufferSize: 8192, format: format) { [weak self] buffer, time in
                guard let self else { return }
                let loudness = Self.loudness(of: buffer)
                self.queue.async {
                    self.analyzer?.analyze(buffer, atAudioFramePosition: time.sampleTime)
                }
                DispatchQueue.main.async { self.level = loudness }
            }
            try engine.start()
            state = .listening
        } catch {
            stop()
        }
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        analyzer = nil
        cryingSince = nil
        alerted = false
        state = .off
        level = 0
    }

    // MARK: SNResultsObserving

    func request(_ request: SNRequest, didProduce result: SNResult) {
        guard let result = result as? SNClassificationResult else { return }
        let confidence = result.classifications
            .filter { cryLabels.contains($0.identifier) }
            .map(\.confidence)
            .max() ?? 0
        DispatchQueue.main.async { self.update(crying: confidence >= self.threshold) }
    }

    private func update(crying: Bool) {
        guard state != .off else { return }
        guard crying else {
            cryingSince = nil
            alerted = false
            state = .listening
            return
        }
        let since = cryingSince ?? Date()
        cryingSince = since
        let seconds = Date().timeIntervalSince(since)
        state = .crying(seconds: Int(seconds))
        if seconds >= Self.alertAfterSeconds && !alerted {
            alerted = true
            notify()
        }
    }

    /// One alert per event. Until pairing exists this is a local notification
    /// on the camera device; it becomes a push to the paired viewers.
    private func notify() {
        let content = UNMutableNotificationContent()
        content.title = "Lookabout"
        content.body = "Crying for 20 seconds."
        content.sound = .default
        content.interruptionLevel = .timeSensitive
        let request = UNNotificationRequest(identifier: "cry", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }

    static func requestNotificationAccess() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    private static func loudness(of buffer: AVAudioPCMBuffer) -> Double {
        guard let data = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return 0 }
        var sum: Float = 0
        for i in 0..<Int(buffer.frameLength) { sum += data[i] * data[i] }
        let rms = sqrt(sum / Float(buffer.frameLength))
        // Map roughly -60 dB…0 dB to 0…1.
        let db = 20 * log10(max(rms, 0.000_001))
        return Double(min(1, max(0, (db + 60) / 60)))
    }
}
