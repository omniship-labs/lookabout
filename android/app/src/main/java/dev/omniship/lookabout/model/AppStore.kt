package dev.omniship.lookabout.model

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.util.UUID

enum class Role { CAMERA, VIEWER }
enum class CameraMode { BABY, SECURITY }
enum class Appearance { SYSTEM, LIGHT, DARK }

/** A camera the viewer knows about. */
data class Camera(
    val id: String,
    val name: String,
    val device: String,
    val motion: Boolean = false,
    /** Set for cameras on your own network (ESP32, Raspberry Pi): their MJPEG stream. */
    val streamUrl: String? = null,
    /** Sample content from the design, until pairing and the hub exist. */
    val isSample: Boolean = false,
)

/** Settings kept on this device. */
data class Settings(
    val appearance: Appearance = Appearance.SYSTEM,
    val role: Role? = null,
    val cameraName: String = "Nursery",
    val cameraMode: CameraMode = CameraMode.BABY,
    val frontLens: Boolean = false,
    val lowLight: Boolean = true,
    val cryDetection: Boolean = true,
    val sensitivity: String = "Medium",
    val backgroundAudio: Boolean = true,
    val motionAlerts: Boolean = true,
    val keepDays: Int = 14,
    val directCameras: List<Camera> = emptyList(),
)

class AppStore(context: Context) {
    private val prefs = context.getSharedPreferences("lookabout", Context.MODE_PRIVATE)

    var settings by mutableStateOf(load())
        private set

    /** Cameras on your network first, then the design's sample cameras. */
    val cameras: List<Camera> get() = settings.directCameras + SampleData.houseCameras

    fun update(change: Settings.() -> Settings) {
        settings = settings.change()
        prefs.edit().putString(KEY, toJson(settings).toString()).apply()
    }

    fun addCamera(name: String, device: String, address: String): Boolean {
        val base = normalize(address) ?: return false
        val camera = Camera(UUID.randomUUID().toString(), name, device, streamUrl = "$base/stream")
        update { copy(directCameras = directCameras + camera) }
        return true
    }

    fun remove(camera: Camera) = update { copy(directCameras = directCameras.filterNot { it.id == camera.id }) }

    private fun load(): Settings {
        val raw = prefs.getString(KEY, null) ?: return Settings()
        return runCatching { fromJson(JSONObject(raw)) }.getOrDefault(Settings())
    }

    companion object {
        private const val KEY = "settings"

        /** "lookabout-cam.local" or "192.168.1.20:8080" → http URL without a trailing slash. */
        fun normalize(address: String): String? {
            var text = address.trim()
            if (text.isEmpty()) return null
            if (!text.startsWith("http://", true) && !text.startsWith("https://", true)) text = "http://$text"
            text = text.trimEnd('/')
            return runCatching { URI(text) }.getOrNull()?.takeIf { !it.host.isNullOrEmpty() }?.let { text }
        }

        private fun toJson(s: Settings) = JSONObject().apply {
            put("appearance", s.appearance.name)
            put("role", s.role?.name ?: JSONObject.NULL)
            put("cameraName", s.cameraName)
            put("cameraMode", s.cameraMode.name)
            put("frontLens", s.frontLens)
            put("lowLight", s.lowLight)
            put("cryDetection", s.cryDetection)
            put("sensitivity", s.sensitivity)
            put("backgroundAudio", s.backgroundAudio)
            put("motionAlerts", s.motionAlerts)
            put("keepDays", s.keepDays)
            put("directCameras", JSONArray().apply {
                s.directCameras.forEach { c ->
                    put(JSONObject().put("id", c.id).put("name", c.name).put("device", c.device).put("streamUrl", c.streamUrl))
                }
            })
        }

        private fun fromJson(j: JSONObject): Settings {
            val d = Settings()
            val cams = j.optJSONArray("directCameras") ?: JSONArray()
            return Settings(
                appearance = runCatching { Appearance.valueOf(j.getString("appearance")) }.getOrDefault(d.appearance),
                role = if (j.isNull("role")) null else runCatching { Role.valueOf(j.getString("role")) }.getOrNull(),
                cameraName = j.optString("cameraName", d.cameraName),
                cameraMode = runCatching { CameraMode.valueOf(j.getString("cameraMode")) }.getOrDefault(d.cameraMode),
                frontLens = j.optBoolean("frontLens", d.frontLens),
                lowLight = j.optBoolean("lowLight", d.lowLight),
                cryDetection = j.optBoolean("cryDetection", d.cryDetection),
                sensitivity = j.optString("sensitivity", d.sensitivity),
                backgroundAudio = j.optBoolean("backgroundAudio", d.backgroundAudio),
                motionAlerts = j.optBoolean("motionAlerts", d.motionAlerts),
                keepDays = j.optInt("keepDays", d.keepDays),
                directCameras = (0 until cams.length()).map { i ->
                    val c = cams.getJSONObject(i)
                    Camera(c.getString("id"), c.getString("name"), c.getString("device"), streamUrl = c.optString("streamUrl"))
                },
            )
        }
    }
}

/**
 * Sample content from the Lookabout design (names, times, levels). Stands in
 * for live data until pairing, streaming and the home hub are built.
 */
object SampleData {
    data class RoomCamera(val id: String, val name: String, val level: Int)
    enum class Tone { WARNING, SUCCESS, MUTED }
    data class Event(val time: String, val label: String, val meta: String, val tone: Tone)
    data class Clip(val kind: String, val title: String, val meta: String, val time: String)

    const val ROOM_NAME = "Nursery"
    const val LEVEL_THRESHOLD = 40
    const val CRY_BAR_THRESHOLD = 12

    val roomCameras = listOf(
        RoomCamera("over", "Crib overhead", 12),
        RoomCamera("side", "Crib side", 64),
        RoomCamera("mat", "Play mat", 6),
    )

    val soundLevels = listOf(
        3, 4, 3, 5, 4, 3, 4, 6, 5, 4, 3, 3, 4, 5, 8, 14, 22, 28, 24, 18,
        12, 8, 6, 5, 4, 4, 3, 3, 4, 3, 3, 4, 3, 3, 4, 3, 3, 3, 4, 3,
    )

    val tonight = listOf(
        Event("1:00 AM", "Crying", "2 min · clip", Tone.WARNING),
        Event("12:14 AM", "Stirring", "30 s", Tone.MUTED),
        Event("10:48 PM", "Fell asleep", "quiet 2h", Tone.SUCCESS),
    )

    val houseCameras = listOf(
        Camera("front", "Front door", "OLD PIXEL", motion = true, isSample = true),
        Camera("driveway", "Driveway", "USB CAM", isSample = true),
        Camera("backyard", "Backyard", "IPAD", isSample = true),
        Camera("nursery", "Nursery", "PHONE", isSample = true),
    )

    val clipsToday = listOf(
        Clip("motion", "Motion · Front door", "18 s · porch zone", "2:03 PM"),
        Clip("motion", "Motion · Driveway", "42 s · gate zone", "11:20 AM"),
        Clip("sound", "Sound · Nursery", "Crying · 2 min", "1:00 AM"),
    )

    val eventDays = listOf(
        "TODAY" to listOf(
            Clip("crying", "Crying · Nursery", "2 min · clip", "1:00 AM"),
            Clip("motion", "Motion · Front door", "Porch zone · 18 s", "11:20 PM"),
            Clip("offline", "Offline · Driveway", "Back after 6 min", "10:02 PM"),
        ),
        "YESTERDAY" to listOf(
            Clip("stirring", "Stirring · Nursery", "40 s", "3:15 AM"),
            Clip("motion", "Motion · Backyard", "Lawn zone · 32 s", "7:48 PM"),
        ),
    )
}
