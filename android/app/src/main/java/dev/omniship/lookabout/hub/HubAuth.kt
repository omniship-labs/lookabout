package dev.omniship.lookabout.hub

import org.json.JSONObject
import java.net.URI
import java.net.URLDecoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

// Sign-in logic for the home hub (docs/hub-auth.md). No Android UI, storage or
// network in this file, so it can get a JVM test target later.

/** PKCE (RFC 7636, S256) for the browser sign-in that ends on `lookabout://hub/signed-in`. */
data class Pkce(val verifier: String, val challenge: String) {
    companion object {
        /** A fresh verifier: 32 random bytes as 43 characters of base64url. */
        fun make(random: SecureRandom = SecureRandom()): Pkce {
            val bytes = ByteArray(32).also(random::nextBytes)
            return from(base64url(bytes))
        }

        fun from(verifier: String) = Pkce(verifier, challengeFor(verifier))

        fun challengeFor(verifier: String): String =
            base64url(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.UTF_8)))

        fun base64url(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }
}

/** What a `lookabout://` link asks the app to do. */
sealed interface HubLink {
    /** `lookabout://hub?address=…&code=…`: the QR an admin makes. Pairs this device. */
    data class Pair(val address: String, val code: String) : HubLink

    /** `lookabout://hub/signed-in?code=…`: the end of a browser sign-in. */
    data class SignedIn(val code: String) : HubLink

    /** `lookabout://hub/signed-in?error=…` (the hub may say why). */
    data class SignInFailed(val message: String) : HubLink

    companion object {
        fun parse(link: String?): HubLink? {
            val uri = runCatching { URI(link ?: return null) }.getOrNull() ?: return null
            if (!uri.scheme.equals("lookabout", true) || !uri.host.equals("hub", true)) return null
            val query = queryOf(uri.rawQuery)
            return when (uri.path.orEmpty().trim('/')) {
                "" -> {
                    val address = query["address"] ?: return null
                    val code = query["code"] ?: return null
                    Pair(address, code)
                }
                "signed-in" -> query["code"]?.let(::SignedIn)
                    ?: query["error"]?.let { SignInFailed(query["message"] ?: "That sign-in didn’t work.") }
                else -> null
            }
        }

        private fun queryOf(raw: String?): Map<String, String> =
            raw.orEmpty().split('&').mapNotNull {
                val i = it.indexOf('=')
                if (i <= 0) return@mapNotNull null
                val value = URLDecoder.decode(it.substring(i + 1), "UTF-8")
                if (value.isEmpty()) null else URLDecoder.decode(it.substring(0, i), "UTF-8") to value
            }.toMap()
    }
}

object HubAddress {
    const val DEFAULT_PORT = 8787

    /** "lookabout.local" or "192.168.1.5" → "http://host:8787"; an address with a port or https is kept as typed. */
    fun normalize(text: String): String? {
        var value = text.trim()
        if (value.isEmpty()) return null
        if (!value.startsWith("http://", true) && !value.startsWith("https://", true)) value = "http://$value"
        val uri = runCatching { URI(value) }.getOrNull() ?: return null
        val host = uri.host?.takeIf { it.isNotEmpty() } ?: return null
        val port = if (uri.port == -1 && uri.scheme.equals("http", true)) DEFAULT_PORT else uri.port
        return buildString {
            append(uri.scheme.lowercase()).append("://").append(host)
            if (port != -1) append(':').append(port)
        }
    }
}

/** The hub's stable error `code`s the app switches on. */
sealed class HubFailure(val text: String) : Exception(text) {
    object Unreachable : HubFailure("The hub isn’t answering. Check its address and that this device is on the same network.")
    /** 401: the session ended (or the login was wrong); go back to sign-in. */
    object NotSignedIn : HubFailure("That didn’t work. Check the details and try again.")
    object NotFound : HubFailure("The hub has no such thing, or you can’t see it.")
    object ManageOnly : HubFailure("You can view this camera but not change it.")
    object AdminOnly : HubFailure("Only an admin can do that.")
    object SetupRequired : HubFailure("This hub hasn’t been set up yet. Finish setup on its page first.")
    class TooManyTries(val retryAfter: Int?) : HubFailure(
        retryAfter?.let { "Too many tries. Wait ${maxOf(1, (it + 59) / 60)} min and try again." } ?: "Too many tries. Wait a bit and try again.",
    )
    class Other(val status: Int, message: String) : HubFailure(message)

    companion object {
        fun from(status: Int, body: String?, retryAfter: String? = null): HubFailure {
            val json = runCatching { JSONObject(body ?: "") }.getOrNull()
            val code = json?.optString("code")
            val message = json?.optString("error")?.takeIf { it.isNotEmpty() } ?: "The hub answered $status."
            return when {
                status == 401 -> NotSignedIn
                status == 423 -> SetupRequired
                status == 429 -> TooManyTries(retryAfter?.toIntOrNull())
                status == 403 && code == "admin_only" -> AdminOnly
                status == 403 && code == "manage_only" -> ManageOnly
                status == 404 -> NotFound
                else -> Other(status, message)
            }
        }
    }
}

enum class Access { VIEW, MANAGE }

/** The hub's `GET /api/me`, enough to decide what to show. The hub checks everything itself. */
data class HubMe(
    val memberId: String,
    val name: String,
    val email: String?,
    val role: String,
    val householdName: String,
    /** null = every camera (admin). Otherwise camera id → level. */
    val cameras: Map<String, Access>?,
) {
    val isAdmin get() = role == "admin"

    fun access(cameraId: String): Access? = if (cameras == null) Access.MANAGE else cameras[cameraId]
    fun canSee(cameraId: String) = access(cameraId) != null

    /** Delete, Zones and Rename are only offered with `manage`. */
    fun canManage(cameraId: String) = access(cameraId) == Access.MANAGE

    fun <T> visible(items: List<T>, id: (T) -> String): List<T> = items.filter { canSee(id(it)) }

    companion object {
        fun parse(json: JSONObject?): HubMe? {
            val member = json?.optJSONObject("member") ?: return null
            val id = member.optString("id").ifEmpty { return null }
            val cameras = when (val raw = json.opt("cameras")) {
                "all" -> null
                is JSONObject -> raw.keys().asSequence().mapNotNull { key ->
                    when (raw.optString(key)) {
                        "view" -> key to Access.VIEW
                        "manage" -> key to Access.MANAGE
                        else -> null
                    }
                }.toMap()
                else -> emptyMap() // anything unexpected shows nothing rather than everything
            }
            return HubMe(
                memberId = id,
                name = member.optString("name"),
                email = member.optString("email").ifEmpty { null },
                role = member.optString("role"),
                householdName = json.optJSONObject("household")?.optString("name")?.ifEmpty { null } ?: "Home",
                cameras = cameras,
            )
        }
    }
}

/** The saved sign-in, without the token (that is encrypted with a Keystore key). */
data class HubSignIn(val address: String, val hubId: String, val hubName: String)
