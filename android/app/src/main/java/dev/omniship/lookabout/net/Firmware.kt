package dev.omniship.lookabout.net

import android.content.Context
import android.hardware.usb.UsbManager
import com.hoho.android.usbserial.driver.UsbSerialPort
import com.hoho.android.usbserial.driver.UsbSerialProber
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/** The firmware image packaged into the app by `npm run firmware:package`. */
data class BundledFirmware(val version: String, val file: String) {
    fun bytes(context: Context): ByteArray = context.assets.open(file).use { it.readBytes() }

    companion object {
        fun load(context: Context): BundledFirmware? = runCatching {
            val json = JSONObject(context.assets.open("firmware.json").bufferedReader().use { it.readText() })
            BundledFirmware(json.getString("version"), json.getString("file"))
        }.getOrNull()
    }
}

/** What a camera on the network reports about itself. */
data class BoardStatus(val firmware: String, val isBoard: Boolean)

object WifiUpdate {
    /** `streamUrl` is the camera's `/stream` address; the board's API sits beside it. */
    private fun base(streamUrl: String) = streamUrl.removeSuffix("/stream")

    /** Null when the camera can't be reached. Call off the main thread. */
    fun status(streamUrl: String): BoardStatus? = runCatching {
        val connection = (URL("${base(streamUrl)}/api/status").openConnection() as HttpURLConnection).apply {
            connectTimeout = 5000
            readTimeout = 5000
        }
        try {
            val json = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
            // The Raspberry Pi node reports a `source`; it updates with its own installer.
            BoardStatus(json.optString("firmware", "unknown"), isBoard = !json.has("source"))
        } finally {
            connection.disconnect()
        }
    }.getOrNull()

    /** Sends the image to the camera (`POST /api/update`); it restarts into it. Call off the main thread. */
    fun update(streamUrl: String, image: ByteArray, onProgress: (Float) -> Unit) {
        val connection = (URL("${base(streamUrl)}/api/update").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            connectTimeout = 8000
            readTimeout = 60000
            setRequestProperty("Content-Type", "application/octet-stream")
            setFixedLengthStreamingMode(image.size)
        }
        try {
            connection.outputStream.use { out ->
                var sent = 0
                while (sent < image.size) {
                    val n = minOf(8192, image.size - sent)
                    out.write(image, sent, n)
                    sent += n
                    onProgress(sent.toFloat() / image.size)
                }
            }
            if (connection.responseCode !in 200..299) {
                val message = connection.errorStream?.bufferedReader()?.use { it.readText() }.orEmpty()
                throw IOException(message.ifBlank { "The camera refused the update." })
            }
        } finally {
            connection.disconnect()
        }
    }
}

/**
 * Flashes an ESP32-S3 plugged into this phone with a USB cable, speaking the
 * chip's built-in (ROM) serial bootloader protocol — the same one esptool
 * uses. Works through the board's UART bridge (CP210x, CH34x) or the S3's
 * own USB serial port.
 *
 * Written from the protocol documentation; not yet run against a board.
 */
class EspFlasher(private val port: UsbSerialPort, private val nativeUsb: Boolean) {

    class FlashException(message: String) : IOException(message)

    data class Part(val address: Int, val data: ByteArray)

    private val pending = ByteArrayOutputStream()

    fun flash(parts: List<Part>, flashSizeBytes: Int, onStatus: (String) -> Unit, onProgress: (Float) -> Unit) {
        onStatus("Connecting to the board")
        port.setParameters(ROM_BAUD, 8, UsbSerialPort.STOPBITS_1, UsbSerialPort.PARITY_NONE)
        enterBootloader()
        sync()

        val magic = command(OP_READ_REG, u32(CHIP_MAGIC_REG)).value
        if (magic != ESP32_S3_MAGIC) {
            throw FlashException("This board is not an ESP32-S3. Lookabout cameras need an ESP32-S3.")
        }

        if (!nativeUsb) {
            // Faster than the bootloader's default 115200.
            command(OP_CHANGE_BAUD, u32(FAST_BAUD) + u32(0))
            port.setParameters(FAST_BAUD, 8, UsbSerialPort.STOPBITS_1, UsbSerialPort.PARITY_NONE)
            Thread.sleep(50)
            drain()
        }

        command(OP_SPI_ATTACH, ByteArray(8))
        command(
            OP_SPI_SET_PARAMS,
            u32(0) + u32(flashSizeBytes) + u32(0x10000) + u32(0x1000) + u32(0x100) + u32(0xFFFF),
        )

        val total = parts.sumOf { it.data.size }.toFloat()
        var done = 0
        for (part in parts) {
            onStatus("Writing firmware")
            val blocks = (part.data.size + BLOCK - 1) / BLOCK
            // The bootloader erases the region here, which can take a while.
            command(
                OP_FLASH_BEGIN,
                u32(part.data.size) + u32(blocks) + u32(BLOCK) + u32(part.address) + u32(0),
                timeoutMs = 10_000 + part.data.size / 1024 * 40,
            )
            for (seq in 0 until blocks) {
                val block = ByteArray(BLOCK) { 0xFF.toByte() }
                val start = seq * BLOCK
                val n = minOf(BLOCK, part.data.size - start)
                System.arraycopy(part.data, start, block, 0, n)
                command(OP_FLASH_DATA, u32(BLOCK) + u32(seq) + u32(0) + u32(0) + block, checksum(block), timeoutMs = 5000)
                done += n
                onProgress(done / total)
            }
        }

        onStatus("Checking what was written")
        for (part in parts) {
            val reply = command(OP_SPI_FLASH_MD5, u32(part.address) + u32(part.data.size) + u32(0) + u32(0), timeoutMs = 20_000)
            val onBoard = String(reply.data, 0, minOf(32, reply.data.size), Charsets.US_ASCII).lowercase()
            val expected = MessageDigest.getInstance("MD5").digest(part.data).joinToString("") { "%02x".format(it) }
            if (onBoard != expected) {
                throw FlashException("The firmware on the board doesn’t match what was sent. Try again with a shorter cable.")
            }
        }

        onStatus("Restarting the board")
        runCatching { command(OP_FLASH_BEGIN, u32(0) + u32(0) + u32(BLOCK) + u32(0) + u32(0)) }
        runCatching { command(OP_FLASH_END, u32(1)) } // 1 = stay; the reset below restarts it
        hardReset()
    }

    // ---- reset lines ---------------------------------------------------------

    private fun enterBootloader() {
        if (nativeUsb) {
            // USB-Serial-JTAG reset sequence.
            port.rts = false; port.dtr = false; Thread.sleep(100)
            port.dtr = true; port.rts = false; Thread.sleep(100)
            port.rts = true; port.dtr = false
            port.rts = true; Thread.sleep(100)
            port.dtr = false; port.rts = false
        } else {
            // Classic auto-reset circuit: RTS drives EN, DTR drives GPIO0.
            port.dtr = false; port.rts = true; Thread.sleep(100)
            port.dtr = true; port.rts = false; Thread.sleep(50)
            port.dtr = false
        }
        Thread.sleep(300)
        drain()
    }

    private fun hardReset() {
        port.dtr = false
        port.rts = true
        Thread.sleep(100)
        port.rts = false
    }

    private fun sync() {
        val payload = byteArrayOf(0x07, 0x07, 0x12, 0x20) + ByteArray(32) { 0x55 }
        repeat(10) {
            try {
                command(OP_SYNC, payload, timeoutMs = 300)
                Thread.sleep(50)
                drain() // the ROM answers a sync several times
                return
            } catch (e: IOException) {
                drain()
            }
        }
        throw FlashException("The board didn’t answer. Hold its BOOT button while plugging it in, then try again.")
    }

    // ---- protocol --------------------------------------------------------------

    private class Reply(val value: Int, val data: ByteArray)

    private fun command(op: Int, data: ByteArray, check: Int = 0, timeoutMs: Int = 3000): Reply {
        val header = byteArrayOf(0x00, op.toByte(), data.size.toByte(), (data.size shr 8).toByte()) + u32(check)
        port.write(slip(header + data), 2000)
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val packet = readPacket(deadline) ?: break
            if (packet.size < 8 || packet[0].toInt() != 0x01 || (packet[1].toInt() and 0xFF) != op) continue
            val value = le32(packet, 4)
            val body = packet.copyOfRange(8, packet.size)
            // The ROM ends every reply with four status bytes: failed flag, error code, 0, 0.
            if (body.size >= 4 && body[body.size - 4].toInt() != 0) {
                throw FlashException("The board reported an error (code ${body[body.size - 3].toInt() and 0xFF}).")
            }
            return Reply(value, if (body.size >= 4) body.copyOfRange(0, body.size - 4) else body)
        }
        throw IOException("No reply from the board")
    }

    /** Reads one SLIP-framed packet, or null when the deadline passes. */
    private fun readPacket(deadline: Long): ByteArray? {
        val chunk = ByteArray(4096)
        while (true) {
            val bytes = pending.toByteArray()
            val start = bytes.indexOf(SLIP_END)
            if (start >= 0) {
                val end = (start + 1 until bytes.size).firstOrNull { bytes[it] == SLIP_END }
                if (end != null) {
                    pending.reset()
                    pending.write(bytes, end + 1, bytes.size - end - 1)
                    if (end == start + 1) continue // empty frame between packets
                    return unslip(bytes, start + 1, end)
                }
            }
            val left = deadline - System.currentTimeMillis()
            if (left <= 0) return null
            val n = port.read(chunk, minOf(left, 200L).toInt())
            if (n > 0) pending.write(chunk, 0, n)
        }
    }

    private fun drain() {
        val chunk = ByteArray(4096)
        while (port.read(chunk, 50) > 0) { /* discard */ }
        pending.reset()
    }

    private fun slip(packet: ByteArray): ByteArray {
        val out = ByteArrayOutputStream(packet.size + 16)
        out.write(0xC0)
        for (b in packet) {
            when (b) {
                SLIP_END -> { out.write(0xDB); out.write(0xDC) }
                SLIP_ESC -> { out.write(0xDB); out.write(0xDD) }
                else -> out.write(b.toInt())
            }
        }
        out.write(0xC0)
        return out.toByteArray()
    }

    private fun unslip(bytes: ByteArray, from: Int, to: Int): ByteArray {
        val out = ByteArrayOutputStream(to - from)
        var i = from
        while (i < to) {
            val b = bytes[i]
            if (b == SLIP_ESC && i + 1 < to) {
                out.write(if (bytes[i + 1] == 0xDC.toByte()) 0xC0 else 0xDB)
                i += 2
            } else {
                out.write(b.toInt())
                i++
            }
        }
        return out.toByteArray()
    }

    private fun checksum(block: ByteArray): Int {
        var sum = 0xEF
        for (b in block) sum = sum xor (b.toInt() and 0xFF)
        return sum
    }

    companion object {
        private const val ROM_BAUD = 115200
        private const val FAST_BAUD = 460800
        private const val BLOCK = 0x400
        private const val CHIP_MAGIC_REG = 0x40001000
        private const val ESP32_S3_MAGIC = 0x9
        private const val SLIP_END = 0xC0.toByte()
        private const val SLIP_ESC = 0xDB.toByte()

        private const val OP_FLASH_BEGIN = 0x02
        private const val OP_FLASH_DATA = 0x03
        private const val OP_FLASH_END = 0x04
        private const val OP_SYNC = 0x08
        private const val OP_READ_REG = 0x0A
        private const val OP_SPI_SET_PARAMS = 0x0B
        private const val OP_SPI_ATTACH = 0x0D
        private const val OP_CHANGE_BAUD = 0x0F
        private const val OP_SPI_FLASH_MD5 = 0x13

        private const val ESPRESSIF_VID = 0x303A

        private fun u32(v: Int) = byteArrayOf(v.toByte(), (v shr 8).toByte(), (v shr 16).toByte(), (v shr 24).toByte())
        private fun le32(b: ByteArray, at: Int) =
            (b[at].toInt() and 0xFF) or ((b[at + 1].toInt() and 0xFF) shl 8) or
                ((b[at + 2].toInt() and 0xFF) shl 16) or ((b[at + 3].toInt() and 0xFF) shl 24)

        /** The first USB serial device plugged into this phone, if any. */
        fun findDevice(context: Context) =
            UsbSerialProber.getDefaultProber()
                .findAllDrivers(context.getSystemService(Context.USB_SERVICE) as UsbManager)
                .firstOrNull()

        /**
         * Opens the board and flashes every part. Needs USB permission for the
         * device already granted. Call off the main thread.
         */
        fun flashBundled(context: Context, onStatus: (String) -> Unit, onProgress: (Float) -> Unit) {
            val manager = context.getSystemService(Context.USB_SERVICE) as UsbManager
            val driver = findDevice(context) ?: throw FlashException("No board found. Plug the ESP32-S3 into this phone.")
            val connection = manager.openDevice(driver.device)
                ?: throw FlashException("Android didn’t allow access to the board.")
            val manifest = JSONObject(context.assets.open("firmware-parts.json").bufferedReader().use { it.readText() })
            val list = manifest.getJSONArray("parts")
            val parts = (0 until list.length()).map { i ->
                val p = list.getJSONObject(i)
                Part(p.getInt("address"), context.assets.open(p.getString("file")).use { it.readBytes() })
            }
            val port = driver.ports[0]
            port.open(connection)
            try {
                EspFlasher(port, nativeUsb = driver.device.vendorId == ESPRESSIF_VID)
                    .flash(parts, manifest.getInt("flashSizeBytes"), onStatus, onProgress)
            } finally {
                runCatching { port.close() }
            }
        }
    }
}
