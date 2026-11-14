package dev.omniship.lookabout.net

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

/** Newest frame from a camera on the home network, and whether it is arriving. */
class StreamState {
    val frame: MutableState<ImageBitmap?> = mutableStateOf(null)
    val connected = mutableStateOf(false)
}

/**
 * Live video from an ESP32 or Raspberry Pi camera (multipart MJPEG at
 * `/stream`). Keeps the last frame and retries when the connection drops.
 */
@Composable
fun rememberMjpegStream(url: String?): StreamState {
    val state = remember(url) { StreamState() }
    LaunchedEffect(url) {
        if (url == null) return@LaunchedEffect
        withContext(Dispatchers.IO) {
            while (isActive) {
                runCatching {
                    val connection = (URL(url).openConnection() as HttpURLConnection).apply {
                        connectTimeout = 8000
                        readTimeout = 8000
                    }
                    try {
                        connection.inputStream.use { input ->
                            readFrames(input) { bitmap ->
                                state.frame.value = bitmap.asImageBitmap()
                                state.connected.value = true
                                isActive
                            }
                        }
                    } finally {
                        connection.disconnect()
                    }
                }
                state.connected.value = false
                delay(2000)
            }
        }
    }
    return state
}

/** Pulls complete JPEGs (FF D8 … FF D9) out of the stream. Stops when [onFrame] returns false. */
private fun readFrames(input: InputStream, onFrame: (Bitmap) -> Boolean) {
    val chunk = ByteArray(16 * 1024)
    val jpeg = ByteArrayOutputStream(64 * 1024)
    var inside = false
    var previous = 0
    while (true) {
        val n = input.read(chunk)
        if (n < 0) return
        for (i in 0 until n) {
            val b = chunk[i].toInt() and 0xFF
            if (!inside) {
                if (previous == 0xFF && b == 0xD8) {
                    inside = true
                    jpeg.reset()
                    jpeg.write(0xFF)
                    jpeg.write(0xD8)
                }
            } else {
                jpeg.write(b)
                if (previous == 0xFF && b == 0xD9) {
                    inside = false
                    val bytes = jpeg.toByteArray()
                    val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                    if (bitmap != null && !onFrame(bitmap)) return
                } else if (jpeg.size() > 4_000_000) {
                    inside = false // not MJPEG, or badly corrupt
                }
            }
            previous = b
        }
    }
}

data class FoundCamera(val name: String, val address: String)

/**
 * Finds Lookabout cameras on the network (`_lookabout._tcp`, advertised by
 * the ESP32 and Raspberry Pi firmware).
 */
@Composable
fun rememberCameraDiscovery(): SnapshotStateList<FoundCamera> {
    val context = LocalContext.current
    val found = remember { mutableStateListOf<FoundCamera>() }
    DisposableEffect(Unit) {
        val nsd = context.getSystemService(Context.NSD_SERVICE) as NsdManager
        val listener = object : NsdManager.DiscoveryListener {
            override fun onServiceFound(info: NsdServiceInfo) {
                // The ESP32 advertises under its host name (port 80); the Pi's
                // service name is "Lookabout camera on <host>" (port 8080).
                val name = info.serviceName
                val camera = if (name.contains(" on ")) {
                    val host = name.substringAfterLast(" on ")
                    FoundCamera(host, "$host.local:8080")
                } else {
                    FoundCamera(name, "$name.local")
                }
                if (camera !in found) found.add(camera)
            }

            override fun onServiceLost(info: NsdServiceInfo) {
                found.removeAll { it.name == info.serviceName || info.serviceName.endsWith(" on ${it.name}") }
            }

            override fun onDiscoveryStarted(type: String) {}
            override fun onDiscoveryStopped(type: String) {}
            override fun onStartDiscoveryFailed(type: String, code: Int) {}
            override fun onStopDiscoveryFailed(type: String, code: Int) {}
        }
        runCatching { nsd.discoverServices("_lookabout._tcp", NsdManager.PROTOCOL_DNS_SD, listener) }
        onDispose { runCatching { nsd.stopServiceDiscovery(listener) } }
    }
    return found
}
