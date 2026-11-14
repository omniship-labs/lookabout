package dev.omniship.lookabout.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathOperation
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.omniship.lookabout.model.SampleData
import dev.omniship.lookabout.net.rememberMjpegStream
import dev.omniship.lookabout.ui.theme.DarkScope
import dev.omniship.lookabout.ui.theme.LocalTokens
import dev.omniship.lookabout.ui.theme.Palette
import dev.omniship.lookabout.ui.theme.Radius
import dev.omniship.lookabout.ui.theme.Type

// Lookabout-specific pieces from the design. Standard controls (Switch,
// TextField, NavigationBar) stay Material so font scaling, TalkBack and
// future Material updates keep working; only what the product introduces is
// drawn here.

/** One "o" of the wordmark, and the bare glyph: lens ring + Beacon moon. */
@Composable
fun LensEye(size: Dp, ring: Color = LocalTokens.current.textStrong, moon: Color = Palette.Beacon, weight: Float = 0.18f) {
    Canvas(Modifier.size(size)) {
        val d = this.size.minDimension
        val stroke = d * weight
        drawCircle(ring, radius = (d - stroke) / 2, style = Stroke(stroke))
        val m = d * 0.42f
        val origin = Offset((d - m) / 2, (d - m) / 2)
        val disc = Path().apply { addOval(Rect(origin, Size(m, m))) }
        val cut = Path().apply { addOval(Rect(Offset(origin.x + m / 2, origin.y - m / 2), Size(m, m))) }
        drawPath(Path.combine(PathOperation.Difference, disc, cut), moon)
    }
}

/** Lowercase "lookabout" where both o's are a lens ring + moon. */
@Composable
fun LensWordmark(size: Int = 24) {
    val t = LocalTokens.current
    Row(
        Modifier.clearAndSetSemantics { contentDescription = "Lookabout" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(1.dp),
    ) {
        Text("l", style = Type.display(size), color = t.textStrong)
        Box(Modifier.padding(top = (size * 0.22f).dp)) { LensEye((size * 0.54f).dp) }
        Box(Modifier.padding(top = (size * 0.22f).dp)) { LensEye((size * 0.54f).dp) }
        Text("kabout", style = Type.display(size), color = t.textStrong)
    }
}

@Composable
fun Eyebrow(text: String, modifier: Modifier = Modifier, size: Int = 11) {
    Text(text, modifier, style = Type.mono(size, wide = true), color = LocalTokens.current.textMuted)
}

@Composable
fun Modifier.card(radius: Dp = Radius.Lg): Modifier {
    val t = LocalTokens.current
    return this
        .background(t.surfaceCard, RoundedCornerShape(radius))
        .border(1.dp, t.border, RoundedCornerShape(radius))
}

enum class PillTone { SUCCESS, WARNING, ACCENT, OUTLINE, SCRIM }

/** Mono status pill: LIVE, MOTION, HEARS SOUND, 3 CAMS. */
@Composable
fun Pill(text: String, tone: PillTone = PillTone.OUTLINE, small: Boolean = false, modifier: Modifier = Modifier) {
    val t = LocalTokens.current
    val (bg, fg) = when (tone) {
        PillTone.SUCCESS -> Palette.Success to Palette.Ink
        PillTone.WARNING -> Palette.Warning to Palette.Ink
        PillTone.ACCENT -> Palette.Beacon to Color.White
        PillTone.OUTLINE -> Color.Transparent to t.textBody
        PillTone.SCRIM -> t.surfacePage.copy(alpha = 0.82f) to t.textStrong
    }
    Text(
        text,
        modifier
            .background(bg, CircleShape)
            .then(if (tone == PillTone.OUTLINE) Modifier.border(1.dp, t.borderStrong, CircleShape) else Modifier)
            .padding(horizontal = if (small) 8.dp else 10.dp, vertical = if (small) 3.dp else 4.dp),
        style = Type.mono(if (small) 10 else 11),
        color = fg,
        maxLines = 1,
    )
}

/**
 * Feed tile. Shows the camera's video when it has a stream on your network,
 * otherwise the placeholder label. Always dark inside.
 */
@Composable
fun VideoTile(
    modifier: Modifier = Modifier,
    streamUrl: String? = null,
    placeholder: String = "LIVE VIDEO",
    radius: Dp = Radius.Lg,
    highlight: Boolean = false,
    description: String? = null,
    overlay: @Composable BoxScope.() -> Unit = {},
) {
    DarkScope {
        val t = LocalTokens.current
        val stream = rememberMjpegStream(streamUrl)
        val shape = RoundedCornerShape(radius)
        Box(
            modifier
                .clip(shape)
                .background(t.surfaceCard)
                .border(if (highlight) 1.5.dp else 1.dp, if (highlight) Palette.Beacon else t.border, shape)
                .then(if (description != null) Modifier.semantics { contentDescription = description } else Modifier),
            contentAlignment = Alignment.Center,
        ) {
            val frame = stream.frame.value
            if (frame != null) {
                Image(
                    frame, null, Modifier.fillMaxSize().alpha(if (stream.connected.value) 1f else 0.45f),
                    contentScale = ContentScale.Crop,
                )
            } else {
                Text(if (streamUrl == null) placeholder else "CONNECTING", style = Type.mono(11), color = t.textMuted)
            }
            overlay()
        }
    }
}

/** 40 bars over a 10-minute window; a bar turns warning above the cry threshold. */
@Composable
fun SoundMeter(levels: List<Int>) {
    Row(
        Modifier.fillMaxWidth().height(36.dp).clearAndSetSemantics {},
        horizontalArrangement = Arrangement.spacedBy(3.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        levels.forEach { level ->
            Box(
                Modifier
                    .weight(1f)
                    .height(maxOf(3, level).dp)
                    .background(
                        if (level > SampleData.CRY_BAR_THRESHOLD) Palette.Warning else Palette.Success,
                        RoundedCornerShape(2.dp),
                    )
            )
        }
    }
}

/** Per-camera 6dp level bar: success below the threshold, warning above. */
@Composable
fun LevelBar(name: String, level: Int) {
    val t = LocalTokens.current
    Row(
        Modifier.clearAndSetSemantics { contentDescription = "$name, sound level $level percent" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(name, Modifier.width(96.dp), style = Type.sans(13), color = t.textBody)
        Box(Modifier.weight(1f).height(6.dp).background(t.surfaceSunken, CircleShape)) {
            Box(
                Modifier
                    .fillMaxWidth(level / 100f)
                    .height(6.dp)
                    .background(if (level > SampleData.LEVEL_THRESHOLD) Palette.Warning else Palette.Success, CircleShape)
            )
        }
    }
}

/** time · dot · label · meta */
@Composable
fun EventRow(event: SampleData.Event) {
    val t = LocalTokens.current
    Column {
        Row(
            Modifier.heightIn(min = 44.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(event.time, Modifier.width(68.dp), style = Type.mono(12), color = t.textMuted)
            Box(
                Modifier.size(8.dp).background(
                    when (event.tone) {
                        SampleData.Tone.WARNING -> Palette.Warning
                        SampleData.Tone.SUCCESS -> Palette.Success
                        SampleData.Tone.MUTED -> t.textMuted
                    },
                    CircleShape,
                )
            )
            Text(event.label, Modifier.weight(1f), style = Type.sans(14), color = t.textStrong)
            Text(event.meta, style = Type.sans(13), color = t.textMuted)
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(t.border))
    }
}

/** Clip row: thumbnail, title, meta, time. */
@Composable
fun ClipRow(clip: SampleData.Clip) {
    val t = LocalTokens.current
    Row(
        Modifier.fillMaxWidth().card(Radius.Md).padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            Modifier.size(76.dp, 48.dp).background(t.surfaceSunken, RoundedCornerShape(Radius.Sm)),
            contentAlignment = Alignment.Center,
        ) { Icon(Icons.Filled.PlayArrow, null, Modifier.size(18.dp), tint = t.textMuted) }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(clip.title, style = Type.sans(14, FontWeight.SemiBold), color = t.textStrong, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(clip.meta, style = Type.sans(12), color = t.textMuted)
        }
        Text(clip.time, style = Type.mono(12), color = t.textMuted)
    }
}

/** Filter chip, 36 tall. */
@Composable
fun Chip(label: String, active: Boolean, onClick: () -> Unit) {
    val t = LocalTokens.current
    Box(
        Modifier
            .height(36.dp)
            .clip(CircleShape)
            .background(if (active) t.textStrong else Color.Transparent)
            .then(if (active) Modifier else Modifier.border(1.dp, t.borderStrong, CircleShape))
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            style = Type.sans(13, if (active) FontWeight.SemiBold else FontWeight.Medium),
            color = if (active) t.surfaceSunken else t.textBody,
        )
    }
}

/** The one Beacon action per view. */
@Composable
fun PrimaryButton(text: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) {
    Box(
        modifier
            .fillMaxWidth()
            .height(52.dp)
            .alpha(if (enabled) 1f else 0.45f)
            .clip(RoundedCornerShape(Radius.Md))
            .background(Palette.Beacon)
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Text(text, style = Type.sans(16, FontWeight.SemiBold), color = Color.White) }
}

/** Outline button: Pause, Lullaby, secondary actions. */
@Composable
fun OutlineButton(
    text: String,
    modifier: Modifier = Modifier,
    height: Dp = 48.dp,
    filled: Boolean = false,
    selected: Boolean = false,
    onClick: () -> Unit,
) {
    val t = LocalTokens.current
    val shape = RoundedCornerShape(Radius.Md)
    Box(
        modifier
            .fillMaxWidth()
            .height(height)
            .clip(shape)
            .background(if (filled) t.surfaceInverse else Color.Transparent)
            .border(BorderStroke(if (selected) 1.5.dp else 1.dp, if (selected) Palette.Success else t.borderStrong), shape)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Text(text, style = Type.sans(15, FontWeight.Medium), color = if (filled) Palette.Paper else t.textStrong) }
}

@Composable
fun VSpace(height: Dp) = Spacer(Modifier.height(height))
