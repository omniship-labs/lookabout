import SwiftUI
import UIKit

/// OmniShip Labs design tokens (design-beacon `tokens/colors.css`), as used in
/// the Lookabout design. Semantic colours follow light/dark everywhere; only
/// the video tiles pin dark inside with `.lookaboutDark()`.
enum LK {
    // Base palette
    static let ink = Color(hex: 0x0E1726)
    static let paper = Color(hex: 0xF7F4EE)
    static let beacon = Color(hex: 0xF24E1E)
    static let beaconPress = Color(hex: 0xD43F14)
    static let success = Color(hex: 0x0E9E81)
    static let warning = Color(hex: 0xC9851A)
    static let danger = Color(hex: 0xD7382B)
    static let info = Color(hex: 0x2A6FDB)

    // Semantic aliases (light, dark)
    static let textStrong = dynamic(0x0E1726, 0xF4F1EA)
    static let textBody = dynamic(0x3A4453, 0xD2D8E0)
    static let textMuted = dynamic(0x5B6573, 0x9AA3B2)
    static let textFaint = dynamic(0x8A93A3, 0x6B7689)
    static let surfacePage = dynamic(0xF7F4EE, 0x0B1220)
    static let surfaceCard = dynamic(0xFFFFFF, 0x141F33)
    static let surfaceSunken = dynamic(0xF0EDE5, 0x0E1726)
    static let surfaceInverse = dynamic(0x0E1726, 0x1C2B45)
    static let border = dynamic(0xE7E3DA, 0x243349)
    static let borderStrong = dynamic(0xD8D3C8, 0x2E3F58)
    /// Switch "on": Ink in light, success in dark.
    static let switchOn = dynamic(0x0E1726, 0x0E9E81)

    // Radii
    static let radiusSm: CGFloat = 8
    static let radiusMd: CGFloat = 12
    static let radiusLg: CGFloat = 18
    static let radiusXl: CGFloat = 24

    /// Phone side padding (between space-4 and space-5; open issue in the spec).
    static let side: CGFloat = 20

    private static func dynamic(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) })
    }

    // Type. The design uses Space Grotesk / IBM Plex Sans / IBM Plex Mono;
    // until those font files are bundled the system faces stand in.
    static func display(_ size: CGFloat) -> Font { .system(size: size, weight: .semibold) }
    static func sans(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font { .system(size: size, weight: weight) }
    static func mono(_ size: CGFloat) -> Font { .system(size: size, weight: .medium, design: .monospaced) }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1
        )
    }
}

extension View {
    /// Pins the dark theme. Used inside video tiles so labels stay legible over video.
    func lookaboutDark() -> some View {
        environment(\.colorScheme, .dark)
    }

    /// Mono eyebrow label, e.g. "STEP 1 OF 2", "TONIGHT".
    func eyebrow(_ size: CGFloat = 11) -> some View {
        font(LK.mono(size)).tracking(size * 0.16).foregroundStyle(LK.textMuted)
    }

    func card(radius: CGFloat = LK.radiusLg) -> some View {
        background(LK.surfaceCard, in: RoundedRectangle(cornerRadius: radius))
            .overlay(RoundedRectangle(cornerRadius: radius).strokeBorder(LK.border, lineWidth: 1))
    }
}

/// The one Beacon action per view.
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(LK.sans(16, .semibold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(configuration.isPressed ? LK.beaconPress : LK.beacon, in: RoundedRectangle(cornerRadius: LK.radiusMd))
            .opacity(enabled ? 1 : 0.45)
    }
}

/// Outline button: Pause, Lullaby, secondary actions.
struct OutlineButtonStyle: ButtonStyle {
    var filled = false
    var height: CGFloat = 48
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(LK.sans(15, .medium))
            .foregroundStyle(LK.textStrong)
            .frame(maxWidth: .infinity, minHeight: height)
            .background(filled ? LK.surfaceInverse : (configuration.isPressed ? LK.surfaceSunken : .clear), in: RoundedRectangle(cornerRadius: LK.radiusMd))
            .overlay(RoundedRectangle(cornerRadius: LK.radiusMd).strokeBorder(LK.borderStrong, lineWidth: 1))
    }
}
