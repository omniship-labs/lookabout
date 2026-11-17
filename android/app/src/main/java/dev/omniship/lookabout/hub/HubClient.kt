package dev.omniship.lookabout.hub

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * One hub, one bearer token. The token goes in the `Authorization` header and
 * nowhere else: never in a URL (media uses tickets). Blocking: call from a
 * background dispatcher.
 */
class HubClient(private val base: String, private val token: String? = null) {
    data class Granted(val token: String, val me: HubMe?, val hubId: String, val hubName: String)
    data class Device(val id: String, val name: String, val current: Boolean)

    private fun send(method: String, path: String, body: JSONObject? = null): JSONObject? {
        val conn = try {
            URL(base + path).openConnection() as HttpURLConnection
        } catch (e: Exception) {
            throw HubFailure.Unreachable
        }
        try {
            conn.requestMethod = method
            conn.connectTimeout = 8000
            conn.readTimeout = 10000
            conn.useCaches = false
            token?.let { conn.setRequestProperty("Authorization", "Bearer $it") }
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(body.toString().toByteArray()) }
            }
            val status = conn.responseCode
            val stream = if (status in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }
            if (status !in 200..299) throw HubFailure.from(status, text, conn.getHeaderField("Retry-After"))
            return text?.takeIf { it.isNotBlank() }?.let { runCatching { JSONObject(it) }.getOrNull() }
        } catch (e: HubFailure) {
            throw e
        } catch (e: Exception) {
            throw HubFailure.Unreachable
        } finally {
            conn.disconnect()
        }
    }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8").replace("+", "%20")

    // Sign-in (docs/hub-auth.md)

    fun providers(): JSONObject = send("GET", "/api/auth/providers") ?: JSONObject()

    fun pair(code: String, name: String): Granted =
        granted(send("POST", "/api/pair", JSONObject().put("code", code).put("name", name).put("platform", "android")))

    fun signIn(email: String, password: String, device: String): Granted = granted(
        send("POST", "/api/auth/login/local?app=1", JSONObject().put("email", email).put("password", password).put("device", device)),
    )

    /** Where to send the Custom Tab for Google or Apple. */
    fun providerRedirect(provider: String, challenge: String): String {
        val body = JSONObject().put("return_to", "/").put("app", true).put("code_challenge", challenge)
        return send("POST", "/api/auth/login/$provider", body)?.optString("redirect")?.ifEmpty { null }
            ?: throw HubFailure.Other(0, "The hub gave no sign-in address.")
    }

    fun exchange(code: String, verifier: String, device: String): Granted = granted(
        send("POST", "/api/auth/token", JSONObject().put("code", code).put("code_verifier", verifier).put("device", device)),
    )

    private fun granted(json: JSONObject?): Granted {
        val newToken = json?.optString("token").orEmpty().ifEmpty { throw HubFailure.Other(0, "The hub didn’t give a session.") }
        val info = send("GET", "/api/hub")
        val me = HubMe.parse(json?.optJSONObject("me")) ?: runCatching { HubClient(base, newToken).me() }.getOrNull()
        return Granted(newToken, me, info?.optString("id").orEmpty(), info?.optString("name")?.ifEmpty { null } ?: "Home hub")
    }

    // Signed in

    fun me(): HubMe? = HubMe.parse(send("GET", "/api/me"))
    fun signOut() { send("POST", "/api/auth/logout") }

    fun devices(): List<Device> {
        val list: JSONArray = send("GET", "/api/me/sessions")?.optJSONArray("sessions") ?: return emptyList()
        return (0 until list.length()).mapNotNull { i ->
            val s = list.getJSONObject(i)
            val id = s.optString("id").ifEmpty { return@mapNotNull null }
            Device(id, s.optString("device").ifEmpty { "Device" }, s.optBoolean("you"))
        }
    }

    fun endDevice(id: String) { send("DELETE", "/api/me/sessions/${enc(id)}") }

    /** A five-minute ticket for one camera's stream, snapshot or clip. Use as `?ticket=`. */
    fun ticket(cameraId: String): String =
        send("POST", "/api/cameras/${enc(cameraId)}/ticket", JSONObject())?.optString("ticket")?.ifEmpty { null }
            ?: throw HubFailure.Other(0, "The hub gave no ticket.")
}
