package dev.omniship.lookabout.ui.screens

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbManager
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import dev.omniship.lookabout.net.BoardStatus
import dev.omniship.lookabout.net.BundledFirmware
import dev.omniship.lookabout.net.EspFlasher
import dev.omniship.lookabout.net.WifiUpdate
import dev.omniship.lookabout.ui.Eyebrow
import dev.omniship.lookabout.ui.OutlineButton
import dev.omniship.lookabout.ui.PrimaryButton
import dev.omniship.lookabout.ui.card
import dev.omniship.lookabout.ui.theme.LocalTokens
import dev.omniship.lookabout.ui.theme.Palette
import dev.omniship.lookabout.ui.theme.Radius
import dev.omniship.lookabout.ui.theme.Type
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private sealed interface Work {
    data object Idle : Work
    data class Running(val status: String) : Work
    data class Done(val message: String) : Work
    data class Failed(val message: String) : Work
}

/** Firmware version of an ESP32 camera, with an over-Wi-Fi update. */
@Composable
fun FirmwareCard(streamUrl: String) {
    val t = LocalTokens.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val bundled = remember { BundledFirmware.load(context) }
    var status by remember { mutableStateOf<BoardStatus?>(null) }
    var checked by remember { mutableStateOf(false) }
    var work by remember { mutableStateOf<Work>(Work.Idle) }
    var progress by remember { mutableFloatStateOf(0f) }
    var refresh by remember { mutableStateOf(0) }

    LaunchedEffect(streamUrl, refresh) {
        checked = false
        status = withContext(Dispatchers.IO) { WifiUpdate.status(streamUrl) }
        checked = true
    }

    val current = status
    val upToDate = current != null && current.firmware == bundled?.version
    val line = when (val w = work) {
        is Work.Running -> "Sending update · ${(progress * 100).toInt()}%"
        is Work.Done -> w.message
        is Work.Failed -> w.message
        Work.Idle -> when {
            !checked -> "Checking…"
            current == null -> "Not reachable on this Wi-Fi"
            !current.isBoard -> "Raspberry Pi · update with its installer"
            upToDate -> "Version ${current.firmware} · up to date"
            bundled != null -> "Version ${current.firmware} · ${bundled.version} available"
            else -> "Version ${current.firmware}"
        }
    }

    Column(
        Modifier.fillMaxWidth().card().padding(horizontal = 16.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Eyebrow("CAMERA FIRMWARE")
        Text(line, style = Type.sans(14, FontWeight.Medium), color = t.textStrong)
        if (work is Work.Running) {
            LinearProgressIndicator(progress = { progress }, Modifier.fillMaxWidth(), color = Palette.Success, trackColor = t.surfaceSunken)
        }
        if (work !is Work.Running && current?.isBoard == true && bundled != null) {
            OutlineButton(if (upToDate) "Reinstall firmware" else "Update firmware") {
                work = Work.Running("")
                progress = 0f
                scope.launch {
                    work = try {
                        withContext(Dispatchers.IO) {
                            WifiUpdate.update(streamUrl, bundled.bytes(context)) { progress = it }
                        }
                        Work.Done("Updated. The camera is restarting.")
                    } catch (e: Exception) {
                        Work.Failed(e.message ?: "Could not reach the camera. Check that it is on and on this Wi-Fi.")
                    }
                    if (work is Work.Done) {
                        delay(8000) // the camera restarts into the new firmware
                        work = Work.Idle
                        refresh++
                    }
                }
            }
            Text(
                "Sent from this phone over your Wi-Fi. If it is interrupted, the camera keeps its current firmware.",
                style = Type.sans(12), color = t.textMuted,
            )
        }
    }
}

private const val ACTION_USB_PERMISSION = "dev.omniship.lookabout.USB_PERMISSION"

/** First flash: an ESP32-S3 plugged into this phone with a USB cable. */
@Composable
fun UsbFlashCard() {
    val t = LocalTokens.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val bundled = remember { BundledFirmware.load(context) }
    var work by remember { mutableStateOf<Work>(Work.Idle) }
    var progress by remember { mutableFloatStateOf(0f) }

    fun flash() {
        work = Work.Running("Connecting to the board")
        progress = 0f
        scope.launch {
            work = try {
                withContext(Dispatchers.IO) {
                    EspFlasher.flashBundled(
                        context,
                        onStatus = { work = Work.Running(it) },
                        onProgress = { progress = it },
                    )
                }
                Work.Done("Firmware ${bundled?.version.orEmpty()} is on the board. Join the “Lookabout-Setup” Wi-Fi it opens to give it your Wi-Fi details.")
            } catch (e: Exception) {
                Work.Failed(e.message ?: "Flashing failed.")
            }
        }
    }

    // Android asks the person before an app may talk to a USB device.
    DisposableEffect(Unit) {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(c: Context, intent: Intent) {
                if (intent.action != ACTION_USB_PERMISSION) return
                if (intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)) flash()
                else work = Work.Failed("Lookabout needs your OK to use the board. Tap Flash and allow it.")
            }
        }
        ContextCompat.registerReceiver(
            context, receiver, IntentFilter(ACTION_USB_PERMISSION), ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        onDispose { context.unregisterReceiver(receiver) }
    }

    fun start() {
        val manager = context.getSystemService(Context.USB_SERVICE) as UsbManager
        val driver = EspFlasher.findDevice(context)
        when {
            driver == null -> work = Work.Failed("No board found. Plug the ESP32-S3 into this phone with a USB cable (the port marked UART).")
            manager.hasPermission(driver.device) -> flash()
            else -> manager.requestPermission(
                driver.device,
                PendingIntent.getBroadcast(
                    context, 0, Intent(ACTION_USB_PERMISSION).setPackage(context.packageName),
                    PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                ),
            )
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Eyebrow("NEW BOARD · OVER USB")
        Column(
            Modifier.fillMaxWidth().card().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            listOf(
                "Plug the ESP32-S3 into this phone with a USB cable, using the board’s port marked UART.",
                "Tap Flash and allow Lookabout to use the board.",
                "When it finishes, move the webcam to the board’s USB port and power it up.",
            ).forEachIndexed { index, step ->
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(Modifier.size(24.dp).background(t.surfaceInverse, CircleShape), contentAlignment = Alignment.Center) {
                        Text("${index + 1}", style = Type.mono(11), color = Palette.Paper)
                    }
                    Text(step, Modifier.weight(1f), style = Type.sans(14), color = t.textBody)
                }
            }
        }
        when (val w = work) {
            is Work.Running -> StatusBox("FLASHING", "${w.status} · ${(progress * 100).toInt()}%", Palette.Success, progress)
            is Work.Done -> StatusBox("DONE", w.message, Palette.Success, null)
            is Work.Failed -> StatusBox("FLASHING DIDN’T FINISH", w.message, Palette.Warning, null)
            Work.Idle -> {}
        }
        PrimaryButton(
            if (work is Work.Done) "Flash another board" else "Flash over USB",
            enabled = bundled != null && work !is Work.Running,
        ) { start() }
    }
}

@Composable
private fun StatusBox(label: String, text: String, tone: androidx.compose.ui.graphics.Color, progress: Float?) {
    val t = LocalTokens.current
    val shape = RoundedCornerShape(Radius.Md)
    Column(
        Modifier
            .fillMaxWidth()
            .background(tone.copy(alpha = 0.12f), shape)
            .border(1.dp, tone, shape)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(label, style = Type.mono(11, wide = true), color = tone)
        Text(text, style = Type.sans(14, FontWeight.SemiBold), color = t.textStrong)
        if (progress != null) {
            LinearProgressIndicator(progress = { progress }, Modifier.fillMaxWidth(), color = tone, trackColor = t.surfaceSunken)
        }
    }
}
