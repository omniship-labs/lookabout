import AVFoundation
import SwiftUI
import UIKit

/// This device's camera while it runs as a Lookabout camera.
final class CameraSession: NSObject, ObservableObject, @unchecked Sendable {
    let session = AVCaptureSession()
    @Published private(set) var isRunning = false
    @Published private(set) var isPaused = false

    private let queue = DispatchQueue(label: "dev.omniship.lookabout.camera")

    /// Asks for camera and microphone access. False if either is refused.
    static func requestAccess() async -> Bool {
        let video = await AVCaptureDevice.requestAccess(for: .video)
        let audio = await AVCaptureDevice.requestAccess(for: .audio)
        return video && audio
    }

    static func status(for type: AVMediaType) -> AVAuthorizationStatus {
        AVCaptureDevice.authorizationStatus(for: type)
    }

    /// Starts capture. Returns false when this device has no usable camera.
    func start(front: Bool, lowLight: Bool) async -> Bool {
        await withCheckedContinuation { continuation in
            queue.async {
                let ok = self.configure(front: front, lowLight: lowLight)
                if ok { self.session.startRunning() }
                DispatchQueue.main.async {
                    self.isRunning = ok
                    self.isPaused = false
                    continuation.resume(returning: ok)
                }
            }
        }
    }

    private func configure(front: Bool, lowLight: Bool) -> Bool {
        session.beginConfiguration()
        defer { session.commitConfiguration() }
        session.inputs.forEach { session.removeInput($0) }
        session.sessionPreset = .hd1280x720 // 720p saves battery

        let position: AVCaptureDevice.Position = front ? .front : .back
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position)
                ?? AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input) else {
            return false
        }
        session.addInput(input)

        if device.isLowLightBoostSupported, (try? device.lockForConfiguration()) != nil {
            device.automaticallyEnablesLowLightBoostWhenAvailable = lowLight
            device.unlockForConfiguration()
        }
        return true
    }

    /// Pause stops video but keeps the pairing.
    func setPaused(_ paused: Bool) {
        queue.async {
            if paused { self.session.stopRunning() } else { self.session.startRunning() }
            DispatchQueue.main.async { self.isPaused = paused }
        }
    }

    func stop() {
        queue.async {
            self.session.stopRunning()
            DispatchQueue.main.async {
                self.isRunning = false
                self.isPaused = false
            }
        }
    }
}

/// Self-view preview of the capture session.
struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.previewLayer.session = session
        view.previewLayer.videoGravity = .resizeAspectFill
        return view
    }

    func updateUIView(_ view: PreviewView, context: Context) {}
}
