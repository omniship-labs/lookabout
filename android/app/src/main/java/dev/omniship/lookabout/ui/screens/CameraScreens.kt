package dev.omniship.lookabout.ui.screens

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.BatteryManager
import android.provider.Settings as SystemSettings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.PhoneAndroid
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material.icons.outlined.VideocamOff
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import dev.omniship.lookabout.model.AppStore
import dev.omniship.lookabout.model.CameraMode
import dev.omniship.lookabout.model.Role
import dev.omniship.lookabout.ui.Eyebrow
import dev.omniship.lookabout.ui.LensEye
import dev.omniship.lookabout.ui.LensWordmark
import dev.omniship.lookabout.ui.OutlineButton
import dev.omniship.lookabout.ui.PrimaryButton
import dev.omniship.lookabout.ui.card
import dev.omniship.lookabout.ui.theme.LocalTokens
import dev.omniship.lookabout.ui.theme.Palette
import dev.omniship.lookabout.ui.theme.Radius
import dev.omniship.lookabout.ui.theme.Side
import dev.omniship.lookabout.ui.theme.Type
import kotlinx.coroutines.delay

/** 1 · Start: pick a role for this device. */
@Composable
fun StartScreen(store: AppStore) {
    val t = LocalTokens.current
    Column(
        Modifier
            .fillMaxSize()
            .background(t.surfacePage)
            .systemBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = Side)
            .padding(top = 24.dp, bottom = 28.dp),
        verticalArrangement = Arrangement.spacedBy(28.dp),
    ) {
        LensWordmark(24)
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Eyebrow("STEP 1 OF 2", size = 12)
            Text("What should this device do?", style = Type.display(34), color = t.textStrong)
            Text(
                "Any phone, laptop or webcam works. Pick a role here, then pair it with your other device.",
                style = Type.sans(16), color = t.textBody,
            )
        }
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            RoleCard(
                primary = true, icon = Icons.Outlined.Videocam, title = "Use as a camera",
                text = "Point it at the crib or the door. It streams to your viewers and can sit with the screen off.",
            ) { store.update { copy(role = Role.CAMERA) } }
            RoleCard(
                primary = false, icon = Icons.Outlined.PhoneAndroid, title = "Use as a viewer",
                text = "Watch and listen from your phone. Get alerts for crying, sound or motion.",
            ) { store.update { copy(role = Role.VIEWER) } }
        }
        Row(
            Modifier
                .fillMaxWidth()
                .background(t.surfaceSunken, RoundedCornerShape(Radius.Md))
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(Icons.Outlined.Lock, null, Modifier.size(18.dp), tint = Palette.Success)
            Text(
                "Video goes device to device, end-to-end encrypted. Nothing is uploaded unless you add a home hub.",
                style = Type.sans(13), color = t.textBody,
            )
        }
        Row(Modifier.fillMaxWidth().padding(top = 24.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("BY OMNISHIP LABS", style = Type.mono(11), color = t.textMuted)
            Text("AGPL-3.0", style = Type.mono(11), color = t.textMuted)
        }
    }
}

@Composable
private fun RoleCard(primary: Boolean, icon: ImageVector, title: String, text: String, onClick: () -> Unit) {
    val t = LocalTokens.current
    val shape = RoundedCornerShape(Radius.Lg)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(t.surfaceCard)
            .border(if (primary) 1.5.dp else 1.dp, if (primary) Palette.Beacon else t.border, shape)
            .clickable(onClick = onClick)
            .padding(20.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Box(
            Modifier.size(48.dp).background(if (primary) Palette.Beacon else t.surfaceInverse, RoundedCornerShape(Radius.Md)),
            contentAlignment = Alignment.Center,
        ) { Icon(icon, null, tint = if (primary) Color.White else Palette.Paper) }
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, style = Type.display(19), color = t.textStrong)
            Text(text, style = Type.sans(14), color = t.textMuted)
        }
    }
}

private fun granted(context: Context, permission: String) =
    ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

/** 2 · Camera setup, 3 · streaming, and the permission-denied state. */
@Composable
fun CameraFlow(store: AppStore) {
    val context = LocalContext.current
    var live by remember { mutableStateOf(false) }
    var denied by remember { mutableStateOf(false) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        val ok = result[Manifest.permission.CAMERA] == true && result[Manifest.permission.RECORD_AUDIO] == true
        live = ok
        denied = !ok
    }
    val start = {
        if (granted(context, Manifest.permission.CAMERA) && granted(context, Manifest.permission.RECORD_AUDIO)) {
            live = true
            denied = false
        } else {
            launcher.launch(arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO))
        }
    }
    when {
        denied -> CameraDenied(store, retry = start)
        live -> CameraLive(store) { live = false }
        else -> CameraSetup(store, start)
    }
}

@Composable
private fun SettingRow(label: String, content: @Composable () -> Unit) {
    val t = LocalTokens.current
    Row(
        Modifier.fillMaxWidth().height(52.dp).padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, style = Type.sans(14), color = t.textBody)
        content()
    }
}

@Composable
private fun Segments(options: List<Pair<String, Boolean>>, onPick: (Int) -> Unit) {
    val t = LocalTokens.current
    Row(
        Modifier.fillMaxWidth().background(t.surfaceSunken, RoundedCornerShape(Radius.Md)).padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        options.forEachIndexed { index, (label, on) ->
            Box(
                Modifier
                    .weight(1f)
                    .height(44.dp)
                    .clip(RoundedCornerShape(9.dp))
                    .background(if (on) (if (t.isDark) t.surfaceInverse else t.surfaceCard) else Color.Transparent)
                    .clickable { onPick(index) },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    label,
                    style = Type.sans(14, if (on) FontWeight.SemiBold else FontWeight.Medium),
                    color = if (on) t.textStrong else t.textMuted,
                )
            }
        }
    }
}

@Composable
private fun CameraSetup(store: AppStore, start: () -> Unit) {
    val t = LocalTokens.current
    val s = store.settings
    Column(
        Modifier
            .fillMaxSize()
            .background(t.surfacePage)
            .systemBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = Side)
            .padding(top = 16.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        Text(
            "‹  STEP 2 OF 2 · CAMERA",
            Modifier.clickable { store.update { copy(role = null) } }.padding(vertical = 12.dp)
                .semantics { contentDescription = "Back" },
            style = Type.mono(12, wide = true), color = t.textMuted,
        )
        Text("Set up this camera", style = Type.display(28), color = t.textStrong)

        OutlinedTextField(
            value = s.cameraName,
            onValueChange = { name -> store.update { copy(cameraName = name.take(24)) } },
            label = { Text("Camera name") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )

        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Mode", style = Type.sans(13, FontWeight.SemiBold), color = t.textStrong)
            Segments(
                listOf("Baby monitor" to (s.cameraMode == CameraMode.BABY), "Security cam" to (s.cameraMode == CameraMode.SECURITY)),
            ) { index -> store.update { copy(cameraMode = if (index == 0) CameraMode.BABY else CameraMode.SECURITY) } }
            Text(
                "Baby monitor keeps audio always on and listens for crying. Security cam records on motion.",
                style = Type.sans(12), color = t.textMuted,
            )
        }

        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Camera & mic", style = Type.sans(13, FontWeight.SemiBold), color = t.textStrong)
            Column(Modifier.card(Radius.Md)) {
                Box(Modifier.clickable { store.update { copy(frontLens = !frontLens) } }) {
                    SettingRow("Lens") {
                        Text(
                            if (s.frontLens) "Front camera" else "Back camera (wide)",
                            style = Type.sans(14, FontWeight.Medium), color = t.textStrong,
                        )
                    }
                }
                Box(Modifier.fillMaxWidth().height(1.dp).background(t.border))
                SettingRow("Quality") { Text("720p · saves battery", style = Type.sans(14, FontWeight.Medium), color = t.textStrong) }
                Box(Modifier.fillMaxWidth().height(1.dp).background(t.border))
                SettingRow("Low-light boost") {
                    Switch(
                        checked = s.lowLight,
                        onCheckedChange = { on -> store.update { copy(lowLight = on) } },
                        colors = SwitchDefaults.colors(checkedTrackColor = t.switchOn, checkedThumbColor = Color.White),
                    )
                }
            }
        }

        PrimaryButton("Start camera", onClick = start)
        Text(
            "Keep it plugged in. The screen can go dark while it streams.",
            Modifier.fillMaxWidth(), style = Type.sans(12), color = t.textMuted, textAlign = TextAlign.Center,
        )
    }
}

private data class Power(val percent: Int, val charging: Boolean)

private fun readPower(context: Context): Power {
    val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
    val level = intent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
    val scale = intent?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100
    val plugged = (intent?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) ?: 0) != 0
    return Power(if (level < 0) 100 else level * 100 / scale, plugged)
}

@Composable
private fun SelfView(front: Boolean, modifier: Modifier) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val view = remember { PreviewView(context) }
    DisposableEffect(front) {
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            runCatching {
                val provider = future.get()
                val preview = Preview.Builder().build().also { it.surfaceProvider = view.surfaceProvider }
                val selector = if (front) CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA
                provider.unbindAll()
                provider.bindToLifecycle(owner, selector, preview)
            }
        }, ContextCompat.getMainExecutor(context))
        onDispose { runCatching { future.get().unbindAll() } }
    }
    AndroidView({ view }, modifier.semantics { contentDescription = "Small self-view preview of the camera" })
}

@Composable
private fun CameraLive(store: AppStore, stop: () -> Unit) {
    val t = LocalTokens.current
    val context = LocalContext.current
    val s = store.settings
    var paused by remember { mutableStateOf(false) }
    val startedAt = remember { System.currentTimeMillis() }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var lastTouch by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var power by remember { mutableStateOf(readPower(context)) }

    LaunchedEffect(Unit) {
        while (true) {
            delay(1000)
            now = System.currentTimeMillis()
            power = readPower(context)
        }
    }
    val dimmed = now - lastTouch > 10_000
    val low = !power.charging && power.percent < 20
    val mode = if (s.cameraMode == CameraMode.BABY) "baby monitor mode" else "security cam mode"

    Box(
        Modifier
            .fillMaxSize()
            .background(t.surfacePage)
            .pointerInput(Unit) {
                awaitPointerEventScope {
                    while (true) {
                        awaitPointerEvent()
                        lastTouch = System.currentTimeMillis()
                    }
                }
            }
    ) {
        Column(
            Modifier.fillMaxSize().systemBarsPadding().padding(horizontal = 24.dp).padding(top = 40.dp, bottom = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                LensEye(22.dp, ring = t.textMuted, moon = t.textMuted, weight = 0.14f)
                Text("This device is a Lookabout camera", style = Type.sans(13), color = t.textMuted)
            }
            Row(
                Modifier.background(Palette.Beacon.copy(alpha = 0.16f), CircleShape).padding(horizontal = 12.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Box(Modifier.size(8.dp).background(if (paused) t.textMuted else Palette.Beacon, CircleShape))
                Text(if (paused) "PAUSED" else "LIVE", style = Type.mono(12, wide = true), color = t.textStrong)
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(s.cameraName.ifBlank { "Camera" }, style = Type.display(36), color = t.textStrong)
                Text(
                    if (paused) "Video paused · $mode" else "Waiting for a viewer · $mode",
                    style = Type.sans(15), color = t.textMuted, textAlign = TextAlign.Center,
                )
            }

            if (low) {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .background(Palette.Warning.copy(alpha = 0.12f), RoundedCornerShape(Radius.Lg))
                        .border(1.5.dp, Palette.Warning, RoundedCornerShape(Radius.Lg))
                        .padding(22.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Text("Battery ${power.percent}%", style = Type.sans(18, FontWeight.SemiBold), color = t.textStrong)
                    Text("Plug this device in to keep watching.", style = Type.sans(14), color = t.textBody)
                }
            } else if (!paused) {
                SelfView(
                    s.frontLens,
                    Modifier.size(160.dp, 120.dp).clip(RoundedCornerShape(Radius.Md)).border(1.dp, t.border, RoundedCornerShape(Radius.Md)),
                )
            } else {
                Box(
                    Modifier.size(160.dp, 120.dp).card(Radius.Md),
                    contentAlignment = Alignment.Center,
                ) { Text("SELF-VIEW", style = Type.mono(11), color = t.textMuted) }
            }

            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Stat("MIC", "On", Modifier.weight(1f))
                    Stat("POWER", if (power.charging) "Plugged in" else "Battery ${power.percent}%", Modifier.weight(1f))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    val minutes = (now - startedAt) / 60_000
                    Stat(
                        "UPTIME",
                        if (minutes >= 60) "${minutes / 60}h ${minutes % 60}m" else "${minutes}m ${(now - startedAt) / 1000 % 60}s",
                        Modifier.weight(1f),
                    )
                    Stat("HUB", "No hub · live only", Modifier.weight(1f))
                }
            }

            Spacer(Modifier.weight(1f))
            Text(
                "Screen dims in 10 s to keep the room dark. Tap to wake.",
                style = Type.sans(13), color = t.textMuted, textAlign = TextAlign.Center,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlineButton(if (paused) "Resume" else "Pause", Modifier.weight(1f), height = 52.dp) { paused = !paused }
                OutlineButton("Stop camera", Modifier.weight(1f), height = 52.dp, filled = true, onClick = stop)
            }
        }
        if (dimmed) {
            // Dims to near-black after 10 s to keep the room dark; any tap wakes.
            Box(
                Modifier
                    .fillMaxSize()
                    .background(Palette.Ink.copy(alpha = 0.94f))
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {
                        lastTouch = System.currentTimeMillis()
                    }
                    .semantics { contentDescription = "Wake screen" }
            )
        }
    }
}

@Composable
private fun Stat(label: String, value: String, modifier: Modifier) {
    val t = LocalTokens.current
    Column(modifier.card(Radius.Md).padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, style = Type.mono(11), color = t.textMuted)
        Text(value, style = Type.sans(15, FontWeight.Medium), color = t.textStrong)
    }
}

/** Camera or microphone refused: explain why and offer the way back in. */
@Composable
private fun CameraDenied(store: AppStore, retry: () -> Unit) {
    val t = LocalTokens.current
    val context = LocalContext.current
    Column(
        Modifier.fillMaxSize().background(t.surfacePage).systemBarsPadding().padding(horizontal = 24.dp).padding(top = 48.dp, bottom = 28.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        Box(Modifier.size(64.dp).card(), contentAlignment = Alignment.Center) {
            Icon(Icons.Outlined.VideocamOff, null, Modifier.size(30.dp), tint = t.textStrong)
        }
        Text("Lookabout can’t use the camera", style = Type.display(28), color = t.textStrong)
        Text(
            "To work as a camera, this phone needs camera and microphone access. Video goes only to your paired viewers, encrypted.",
            style = Type.sans(15), color = t.textBody,
        )
        Column(Modifier.card(Radius.Md)) {
            listOf("Camera" to Manifest.permission.CAMERA, "Microphone" to Manifest.permission.RECORD_AUDIO).forEachIndexed { i, (label, permission) ->
                if (i > 0) Box(Modifier.fillMaxWidth().height(1.dp).background(t.border))
                val ok = granted(context, permission)
                SettingRow(label) {
                    Text(
                        if (ok) "Allowed" else "Not allowed",
                        style = Type.sans(14, FontWeight.SemiBold), color = if (ok) Palette.Success else Palette.Danger,
                    )
                }
            }
        }
        Spacer(Modifier.weight(1f))
        PrimaryButton("Open phone settings") {
            context.startActivity(
                Intent(SystemSettings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
            )
        }
        OutlineButton("Try again", onClick = retry)
        OutlineButton("Use as viewer instead") { store.update { copy(role = Role.VIEWER) } }
    }
}
