package dev.omniship.lookabout.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.outlined.AccessTime
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role as SemanticsRole
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.omniship.lookabout.model.AppStore
import dev.omniship.lookabout.model.Appearance
import dev.omniship.lookabout.model.Camera
import dev.omniship.lookabout.model.SampleData
import dev.omniship.lookabout.net.rememberCameraDiscovery
import dev.omniship.lookabout.ui.Chip
import dev.omniship.lookabout.ui.ClipRow
import dev.omniship.lookabout.ui.EventRow
import dev.omniship.lookabout.ui.Eyebrow
import dev.omniship.lookabout.ui.LevelBar
import dev.omniship.lookabout.ui.OutlineButton
import dev.omniship.lookabout.ui.Pill
import dev.omniship.lookabout.ui.PillTone
import dev.omniship.lookabout.hub.HubSession
import dev.omniship.lookabout.ui.PrimaryButton
import dev.omniship.lookabout.ui.SoundMeter
import dev.omniship.lookabout.ui.VideoTile
import dev.omniship.lookabout.ui.card
import dev.omniship.lookabout.ui.theme.LocalTokens
import dev.omniship.lookabout.ui.theme.Palette
import dev.omniship.lookabout.ui.theme.Radius
import dev.omniship.lookabout.ui.theme.Side
import dev.omniship.lookabout.ui.theme.Type

private sealed interface Overlay {
    data object None : Overlay
    data object Add : Overlay
    data object Hub : Overlay
    data class Detail(val camera: Camera) : Overlay
}

/** Viewer chrome: Live · Cameras · Events · Alerts. */
@Composable
fun ViewerScreen(store: AppStore, hub: HubSession) {
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var overlay by remember { mutableStateOf<Overlay>(Overlay.None) }
    BackHandler(enabled = overlay != Overlay.None) { overlay = Overlay.None }

    val tabs = listOf(
        "Live" to Icons.Outlined.Videocam,
        "Cameras" to Icons.Outlined.GridView,
        "Events" to Icons.Outlined.AccessTime,
        "Alerts" to Icons.Outlined.Notifications,
    )
    run {
        val t = LocalTokens.current
        Scaffold(
            containerColor = t.surfacePage,
            bottomBar = {
                if (overlay == Overlay.None) {
                    NavigationBar(containerColor = if (t.isDark) t.surfaceSunken else t.surfaceCard) {
                        tabs.forEachIndexed { index, (label, icon) ->
                            NavigationBarItem(
                                selected = tab == index,
                                onClick = { tab = index },
                                icon = { Icon(icon, null) },
                                label = { Text(label) },
                                colors = NavigationBarItemDefaults.colors(
                                    selectedIconColor = t.textStrong, selectedTextColor = t.textStrong,
                                    unselectedIconColor = t.textMuted, unselectedTextColor = t.textMuted,
                                    indicatorColor = t.surfaceInverse.copy(alpha = if (t.isDark) 1f else 0.08f),
                                ),
                            )
                        }
                    }
                }
            },
        ) { padding ->
            Box(Modifier.fillMaxSize().padding(padding)) {
                when (val o = overlay) {
                    Overlay.Add -> AddCamera(store) { overlay = Overlay.None }
                    Overlay.Hub -> HubScreen(hub) { overlay = Overlay.None }
                    is Overlay.Detail -> CameraDetail(o.camera) { overlay = Overlay.None }
                    Overlay.None -> when (tab) {
                        0 -> Live()
                        1 -> Cameras(store, onAdd = { overlay = Overlay.Add }, onOpen = { overlay = Overlay.Detail(it) })
                        2 -> Events()
                        else -> SettingsScreen(store, hub, openHub = { overlay = Overlay.Hub })
                    }
                }
            }
        }
    }
}

@Composable
private fun Page(content: @Composable () -> Unit) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = Side)
            .padding(top = 12.dp, bottom = 20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) { content() }
}

/** Opens the mic to the camera while held; haptic tick on start and end. */
@Composable
private fun HoldToTalk(modifier: Modifier = Modifier) {
    val haptics = LocalHapticFeedback.current
    var talking by remember { mutableStateOf(false) }
    Box(
        modifier
            .fillMaxWidth()
            .height(52.dp)
            .clip(RoundedCornerShape(Radius.Md))
            .background(if (talking) Palette.BeaconPress else Palette.Beacon)
            .semantics { role = SemanticsRole.Button }
            .pointerInput(Unit) {
                detectTapGestures(onPress = {
                    talking = true
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    tryAwaitRelease()
                    talking = false
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                })
            },
        contentAlignment = Alignment.Center,
    ) { Text(if (talking) "Talking…" else "Hold to talk", style = Type.sans(14, FontWeight.SemiBold), color = Color.White) }
}

// ---- Live (4b · nursery multi-cam) ----------------------------------------

@Composable
private fun Live() {
    val t = LocalTokens.current
    val cams = SampleData.roomCameras
    val loudest = cams.maxBy { it.level }
    var mainId by rememberSaveable { mutableStateOf(loudest.id) }
    var follow by rememberSaveable { mutableStateOf(true) }
    var mix by rememberSaveable { mutableStateOf("all") }
    var lullaby by rememberSaveable { mutableStateOf(false) }
    val main = cams.first { it.id == mainId }

    Page {
        Row(Modifier.fillMaxWidth().heightIn(min = 44.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(SampleData.ROOM_NAME, Modifier.weight(1f), style = Type.display(22), color = t.textStrong)
            Pill("${cams.size} CAMS")
        }

        VideoTile(Modifier.fillMaxWidth().height(236.dp), description = "Live video from ${main.name}") {
            // AUTO (success fill): main view follows the loudest camera. PINNED (outline): stays put.
            Row(
                Modifier
                    .align(Alignment.TopStart)
                    .padding(10.dp)
                    .height(36.dp)
                    .clip(CircleShape)
                    .background(if (follow) Palette.Success else LocalTokens.current.surfacePage.copy(alpha = 0.85f))
                    .then(if (follow) Modifier else Modifier.border(1.dp, LocalTokens.current.borderStrong, CircleShape))
                    .clickable {
                        follow = !follow
                        if (follow) mainId = loudest.id
                    }
                    .semantics {
                        contentDescription = if (follow) "Main view follows the loudest camera. Tap to pin." else "Main view is pinned. Tap to follow sound."
                    }
                    .padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    if (follow) "AUTO" else "PINNED", style = Type.mono(11),
                    color = if (follow) Palette.Ink else LocalTokens.current.textStrong,
                )
            }
            if (main.id == loudest.id) {
                Pill("HEARS SOUND", PillTone.WARNING, modifier = Modifier.align(Alignment.TopEnd).padding(12.dp))
            }
            Text(
                main.name, Modifier.align(Alignment.BottomStart).padding(12.dp),
                style = Type.display(17), color = LocalTokens.current.textStrong,
            )
        }

        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            cams.filter { it.id != main.id }.forEach { cam ->
                // Tapping a small feed swaps it in and pins it.
                VideoTile(
                    Modifier.weight(1f).height(104.dp).clickable {
                        mainId = cam.id
                        follow = false
                    },
                    placeholder = "FEED", radius = Radius.Md, description = "Show ${cam.name} in main view",
                ) {
                    if (cam.id == loudest.id) {
                        Box(Modifier.align(Alignment.TopEnd).padding(8.dp).size(10.dp).background(Palette.Warning, CircleShape))
                    }
                    Text(
                        cam.name,
                        Modifier
                            .align(Alignment.BottomStart)
                            .fillMaxWidth()
                            .background(LocalTokens.current.surfacePage.copy(alpha = 0.85f))
                            .padding(horizontal = 10.dp, vertical = 7.dp),
                        style = Type.sans(13, FontWeight.SemiBold), color = LocalTokens.current.textStrong,
                    )
                }
            }
        }

        Column(
            Modifier.fillMaxWidth().card().padding(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text("Stirring", Modifier.weight(1f), style = Type.display(18), color = t.textStrong)
                Text("Heard by Crib side", style = Type.sans(13), color = t.textMuted)
            }
            cams.forEach { LevelBar(it.name, it.level) }
            Row(
                Modifier.fillMaxWidth().background(t.surfaceSunken, RoundedCornerShape(10.dp)).padding(3.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                listOf("all" to "Hear all, mixed", "main" to "Main view only").forEach { (id, label) ->
                    val on = mix == id
                    Box(
                        Modifier
                            .weight(1f)
                            .height(40.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .background(if (on) (if (t.isDark) t.surfaceInverse else t.surfaceCard) else Color.Transparent)
                            .clickable { mix = id },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            label, style = Type.sans(13, if (on) FontWeight.SemiBold else FontWeight.Medium),
                            color = if (on) t.textStrong else t.textMuted,
                        )
                    }
                }
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            HoldToTalk(Modifier.weight(1f))
            OutlineButton("Lullaby", Modifier.weight(1f), height = 52.dp, selected = lullaby) { lullaby = !lullaby }
        }

        Column {
            Eyebrow("TONIGHT", Modifier.padding(top = 6.dp, bottom = 6.dp))
            SampleData.tonight.forEach { EventRow(it) }
        }
    }
}

// ---- Cameras (5 · CCTV grid + events) --------------------------------------

@Composable
private fun Cameras(store: AppStore, onAdd: () -> Unit, onOpen: (Camera) -> Unit) {
    val t = LocalTokens.current
    var filter by rememberSaveable { mutableStateOf("all") }
    val cameras = store.cameras
    Page {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Cameras", Modifier.weight(1f), style = Type.display(26), color = t.textStrong)
            Box(
                Modifier
                    .size(44.dp)
                    .clip(RoundedCornerShape(Radius.Md))
                    .background(t.surfaceCard)
                    .border(1.dp, t.borderStrong, RoundedCornerShape(Radius.Md))
                    .clickable(onClick = onAdd)
                    .semantics { contentDescription = "Add camera" },
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Filled.Add, null, tint = t.textStrong) }
        }
        Text("${cameras.size} online · No hub · live only", style = Type.sans(13), color = t.textMuted)

        cameras.chunked(2).forEach { pair ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                pair.forEach { camera ->
                    VideoTile(
                        Modifier.weight(1f).height(128.dp).clickable { onOpen(camera) },
                        streamUrl = camera.streamUrl, placeholder = "FEED", radius = Radius.Md, highlight = camera.motion,
                        description = camera.name,
                    ) {
                        if (camera.motion) {
                            Pill("MOTION", PillTone.ACCENT, small = true, modifier = Modifier.align(Alignment.TopStart).padding(8.dp))
                        }
                        Row(
                            Modifier
                                .align(Alignment.BottomStart)
                                .fillMaxWidth()
                                .background(LocalTokens.current.surfacePage.copy(alpha = 0.85f))
                                .padding(horizontal = 10.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                camera.name, Modifier.weight(1f), style = Type.sans(13, FontWeight.SemiBold),
                                color = LocalTokens.current.textStrong, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            )
                            Text(camera.device, style = Type.mono(10), color = LocalTokens.current.textMuted)
                        }
                    }
                }
                if (pair.size == 1) Box(Modifier.weight(1f))
            }
        }

        Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Events today", Modifier.weight(1f), style = Type.display(19), color = t.textStrong)
            Text("12 CLIPS", style = Type.mono(11), color = t.textMuted)
        }
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("all" to "All", "motion" to "Motion", "sound" to "Sound").forEach { (id, label) ->
                Chip(label, filter == id) { filter = id }
            }
        }
        SampleData.clipsToday.filter { filter == "all" || it.kind == filter }.forEach { ClipRow(it) }
    }
}

/** 4 · One camera's live view. */
@Composable
private fun CameraDetail(camera: Camera, back: () -> Unit) {
    val t = LocalTokens.current
    Page {
        Text(
            "‹  ${camera.name}",
            Modifier.clickable(onClick = back).padding(vertical = 10.dp).semantics { contentDescription = "Back" },
            style = Type.display(22), color = t.textStrong,
        )
        VideoTile(
            Modifier.fillMaxWidth().height(250.dp), streamUrl = camera.streamUrl,
            description = "Live video from ${camera.name}",
        ) {
            Pill("LIVE", PillTone.SCRIM, modifier = Modifier.align(Alignment.TopStart).padding(12.dp))
        }
        if (camera.isSample) {
            Column(
                Modifier.fillMaxWidth().card().padding(horizontal = 16.dp, vertical = 14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Row(verticalAlignment = Alignment.Bottom) {
                    Text("Calm", Modifier.weight(1f), style = Type.display(18), color = t.textStrong)
                    Text("Quiet for 42 min", style = Type.sans(13), color = t.textMuted)
                }
                SoundMeter(SampleData.soundLevels)
                Text("SOUND · LAST 10 MIN", style = Type.mono(11), color = t.textMuted)
            }
            HoldToTalk()
            Column {
                Eyebrow("TONIGHT", Modifier.padding(top = 6.dp, bottom = 6.dp))
                SampleData.tonight.forEach { EventRow(it) }
            }
        } else {
            Text(
                "This camera sends video only. It is on your home network, so it shows while this phone is on the same Wi-Fi.",
                style = Type.sans(13), color = t.textMuted,
            )
            camera.streamUrl?.let { FirmwareCard(it) }
        }
    }
}

// ---- Events -----------------------------------------------------------------

@Composable
private fun Events() {
    val t = LocalTokens.current
    var filter by rememberSaveable { mutableStateOf("all") }
    Page {
        Text("Events", style = Type.display(26), color = t.textStrong)
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("all" to "All", "crying" to "Crying", "motion" to "Motion", "offline" to "Offline").forEach { (id, label) ->
                Chip(label, filter == id) { filter = id }
            }
        }
        SampleData.eventDays.forEach { (label, clips) ->
            val items = clips.filter { filter == "all" || it.kind == filter }
            if (items.isNotEmpty()) {
                Eyebrow(label, Modifier.padding(top = 6.dp))
                items.forEach { ClipRow(it) }
            }
        }
    }
}

// ---- Alerts & settings --------------------------------------------------------

@Composable
private fun SettingsScreen(store: AppStore, hub: HubSession, openHub: () -> Unit) {
    val t = LocalTokens.current
    val s = store.settings

    @Composable
    fun section(label: String, content: @Composable () -> Unit) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Eyebrow(label)
            Column(Modifier.fillMaxWidth().card(Radius.Md).padding(horizontal = 14.dp)) { content() }
        }
    }

    @Composable
    fun row(title: String, sub: String, onClick: (() -> Unit)? = null, trailing: @Composable () -> Unit) {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 56.dp)
                .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Column(Modifier.weight(1f)) {
                Text(title, style = Type.sans(14, FontWeight.Medium), color = t.textStrong)
                Text(sub, style = Type.sans(12), color = t.textMuted)
            }
            trailing()
        }
    }

    @Composable
    fun toggle(title: String, sub: String, on: Boolean, set: (Boolean) -> Unit) = row(title, sub) {
        Switch(
            checked = on, onCheckedChange = set,
            colors = SwitchDefaults.colors(checkedTrackColor = t.switchOn, checkedThumbColor = Color.White),
        )
    }

    @Composable
    fun value(text: String) = Text(text, style = Type.sans(14), color = t.textMuted)

    fun <T> next(list: List<T>, current: T) = list[(list.indexOf(current) + 1) % list.size]

    Page {
        Text("Alerts & settings", style = Type.display(26), color = t.textStrong)

        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Eyebrow("APPEARANCE")
            Row(
                Modifier.fillMaxWidth().background(t.surfaceSunken, RoundedCornerShape(Radius.Md)).padding(4.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Appearance.entries.forEach { option ->
                    val on = s.appearance == option
                    Box(
                        Modifier
                            .weight(1f)
                            .height(40.dp)
                            .clip(RoundedCornerShape(9.dp))
                            .background(if (on) (if (t.isDark) t.surfaceInverse else t.surfaceCard) else Color.Transparent)
                            .clickable { store.update { copy(appearance = option) } },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            option.name.lowercase().replaceFirstChar { it.uppercase() },
                            style = Type.sans(14, if (on) FontWeight.SemiBold else FontWeight.Medium),
                            color = if (on) t.textStrong else t.textMuted,
                        )
                    }
                }
            }
        }

        section("BABY MONITOR") {
            toggle("Cry detection", "Alert after 20 s of crying", s.cryDetection) { store.update { copy(cryDetection = it) } }
            row("Sensitivity", "Ignores fan and white noise", onClick = {
                store.update { copy(sensitivity = next(listOf("Low", "Medium", "High"), sensitivity)) }
            }) { value(s.sensitivity) }
            toggle("Keep audio on in background", "Hear the room with the app closed", s.backgroundAudio) {
                store.update { copy(backgroundAudio = it) }
            }
        }
        section("SECURITY CAMERAS") {
            toggle("Motion alerts", "Only inside drawn zones", s.motionAlerts) { store.update { copy(motionAlerts = it) } }
        }
        section("RECORDING") {
            row("Home hub", "Live view works without it", onClick = openHub) { value(hub.signIn?.hubName ?: "Not signed in") }
            row("Keep clips for", "Oldest clips delete first", onClick = {
                store.update { copy(keepDays = next(listOf(7, 14, 30), keepDays)) }
            }) { value("${s.keepDays} days") }
        }
        section("THIS DEVICE") {
            row("Change what this device does", "Camera or viewer", onClick = { store.update { copy(role = null) } }) { value("Change") }
        }

        Column(
            Modifier.fillMaxWidth().padding(top = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            Row {
                Text("OmniShip", style = Type.display(18), color = t.textStrong)
                Text(" Labs", style = Type.display(18), color = Palette.Beacon)
            }
            Text("OPEN MEETS NEW IDEAS", style = Type.mono(11, wide = true), color = Palette.Beacon)
            Text("An OmniShip Labs project", style = Type.sans(13), color = t.textMuted)
            Text(
                "AGPL-3.0",
                Modifier.border(1.dp, t.border, CircleShape).padding(horizontal = 9.dp, vertical = 2.dp),
                style = Type.mono(11), color = t.textMuted,
            )
            Text("omniship.dev", style = Type.mono(12), color = t.textMuted)
        }
    }
}

// ---- Add a camera on your network --------------------------------------------

@Composable
private fun AddCamera(store: AppStore, close: () -> Unit) {
    run {
        val t = LocalTokens.current
        val found = rememberCameraDiscovery()
        var address by rememberSaveable { mutableStateOf("") }
        var name by rememberSaveable { mutableStateOf("") }
        var testUrl by rememberSaveable { mutableStateOf<String?>(null) }
        var error by rememberSaveable { mutableStateOf(false) }

        Page {
            Text(
                "‹  Add a camera",
                Modifier.clickable(onClick = close).padding(vertical = 10.dp).semantics { contentDescription = "Back" },
                style = Type.display(22), color = t.textStrong,
            )
            Text(
                "An ESP32-S3 with a USB webcam, or a Raspberry Pi camera, running the Lookabout firmware on your Wi-Fi.",
                style = Type.sans(14), color = t.textMuted,
            )

            if (found.isNotEmpty()) {
                Eyebrow("FOUND ON YOUR NETWORK")
                Column(Modifier.fillMaxWidth().card(Radius.Md).padding(horizontal = 14.dp)) {
                    found.forEach { cam ->
                        Row(
                            Modifier.fillMaxWidth().heightIn(min = 60.dp).clickable {
                                address = cam.address
                                if (name.isBlank()) name = cam.name
                                testUrl = AppStore.normalize(cam.address)?.let { "$it/stream" }
                            },
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(cam.name, style = Type.sans(14, FontWeight.SemiBold), color = t.textStrong)
                                Text(cam.address, style = Type.mono(12), color = t.textMuted)
                            }
                            Pill("LIVE", PillTone.SUCCESS, small = true)
                        }
                    }
                }
            }

            OutlinedTextField(
                value = address, onValueChange = { address = it; error = false },
                label = { Text("Camera address on your network") },
                placeholder = { Text("lookabout-cam.local") },
                isError = error, singleLine = true, modifier = Modifier.fillMaxWidth(),
                supportingText = if (error) {
                    { Text("That doesn’t look like an address. Try lookabout-cam.local or the camera’s IP address.") }
                } else null,
            )
            VideoTile(
                Modifier.fillMaxWidth().height(180.dp), streamUrl = testUrl, placeholder = "TEST PREVIEW",
                description = "Test preview from the camera",
            )
            OutlineButton("Test the stream") {
                testUrl = AppStore.normalize(address)?.let { "$it/stream" }
                error = testUrl == null
            }
            OutlinedTextField(
                value = name, onValueChange = { name = it.take(24) },
                label = { Text("Name") }, placeholder = { Text("Garage") },
                singleLine = true, modifier = Modifier.fillMaxWidth(),
            )
            PrimaryButton("Add this camera", enabled = address.isNotBlank() && name.isNotBlank()) {
                if (store.addCamera(name.trim(), "ON WI-FI", address)) close() else error = true
            }

            Box(Modifier.padding(top = 12.dp)) { UsbFlashCard() }
        }
    }
}
