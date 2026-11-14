package dev.omniship.lookabout.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

/**
 * OmniShip Labs design tokens (design-beacon `tokens/colors.css`) as used in
 * the Lookabout design. Every screen follows the app theme; only the video
 * tiles use [DarkTokens] inside.
 */
data class Tokens(
    val textStrong: Color,
    val textBody: Color,
    val textMuted: Color,
    val textFaint: Color,
    val surfacePage: Color,
    val surfaceCard: Color,
    val surfaceSunken: Color,
    val surfaceInverse: Color,
    val border: Color,
    val borderStrong: Color,
    /** Switch "on": Ink in light, success in dark. */
    val switchOn: Color,
    val isDark: Boolean,
)

object Palette {
    val Ink = Color(0xFF0E1726)
    val Paper = Color(0xFFF7F4EE)
    val Beacon = Color(0xFFF24E1E)
    val BeaconPress = Color(0xFFD43F14)
    val Success = Color(0xFF0E9E81)
    val Warning = Color(0xFFC9851A)
    val Danger = Color(0xFFD7382B)
}

val LightTokens = Tokens(
    textStrong = Palette.Ink,
    textBody = Color(0xFF3A4453),
    textMuted = Color(0xFF5B6573),
    textFaint = Color(0xFF8A93A3),
    surfacePage = Palette.Paper,
    surfaceCard = Color.White,
    surfaceSunken = Color(0xFFF0EDE5),
    surfaceInverse = Palette.Ink,
    border = Color(0xFFE7E3DA),
    borderStrong = Color(0xFFD8D3C8),
    switchOn = Palette.Ink,
    isDark = false,
)

val DarkTokens = Tokens(
    textStrong = Color(0xFFF4F1EA),
    textBody = Color(0xFFD2D8E0),
    textMuted = Color(0xFF9AA3B2),
    textFaint = Color(0xFF6B7689),
    surfacePage = Color(0xFF0B1220),
    surfaceCard = Color(0xFF141F33),
    surfaceSunken = Color(0xFF0E1726),
    surfaceInverse = Color(0xFF1C2B45),
    border = Color(0xFF243349),
    borderStrong = Color(0xFF2E3F58),
    switchOn = Palette.Success,
    isDark = true,
)

val LocalTokens = staticCompositionLocalOf { LightTokens }

object Radius {
    val Sm = 8.dp
    val Md = 12.dp
    val Lg = 18.dp
    val Xl = 24.dp
}

/** Phone side padding (between space-4 and space-5; open issue in the spec). */
val Side = 20.dp

// Type. The design uses Space Grotesk / IBM Plex Sans / IBM Plex Mono; until
// those font files are bundled the system faces stand in.
object Type {
    fun display(size: Int) = TextStyle(
        fontSize = size.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.025).em,
        lineHeight = (size * 1.1).sp,
    )
    fun sans(size: Int, weight: FontWeight = FontWeight.Normal) =
        TextStyle(fontSize = size.sp, fontWeight = weight, lineHeight = (size * 1.45).sp)
    fun mono(size: Int, wide: Boolean = false) = TextStyle(
        fontFamily = FontFamily.Monospace, fontSize = size.sp, fontWeight = FontWeight.Medium,
        letterSpacing = if (wide) 0.16.em else 0.08.em,
    )
}

@Composable
fun LookaboutTheme(dark: Boolean, content: @Composable () -> Unit) {
    val t = if (dark) DarkTokens else LightTokens
    val scheme = if (dark) {
        darkColorScheme(
            primary = Palette.Beacon, onPrimary = Color.White,
            background = t.surfacePage, onBackground = t.textBody,
            surface = t.surfaceCard, onSurface = t.textStrong,
            surfaceVariant = t.surfaceSunken, onSurfaceVariant = t.textMuted,
            outline = t.borderStrong, outlineVariant = t.border, error = Palette.Danger,
        )
    } else {
        lightColorScheme(
            primary = Palette.Beacon, onPrimary = Color.White,
            background = t.surfacePage, onBackground = t.textBody,
            surface = t.surfaceCard, onSurface = t.textStrong,
            surfaceVariant = t.surfaceSunken, onSurfaceVariant = t.textMuted,
            outline = t.borderStrong, outlineVariant = t.border, error = Palette.Danger,
        )
    }
    CompositionLocalProvider(LocalTokens provides t) {
        MaterialTheme(colorScheme = scheme, content = content)
    }
}

/** Pins the dark theme. Used inside video tiles so labels stay legible over video. */
@Composable
fun DarkScope(content: @Composable () -> Unit) = LookaboutTheme(dark = true, content = content)
