package dev.omniship.lookabout.hub

import android.content.Context
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/** Which hub this device is signed in to, and as whom. One per app (see MainActivity). */
class HubSession(private val context: Context) {
    private val prefs = context.getSharedPreferences("lookabout-hub", Context.MODE_PRIVATE)
    private val vault = TokenVault(context)

    var signIn by mutableStateOf<HubSignIn?>(null); private set
    var me by mutableStateOf<HubMe?>(null); private set
    var busy by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null)
    /** A QR or link asked to pair with this hub; the sign-in screen fills it in. */
    var pendingLink by mutableStateOf<HubLink.Pair?>(null)
    /** Set when a 401 ended the session, so the screen can say so. */
    var endedMessage by mutableStateOf<String?>(null); private set

    /** Held in memory only, between opening the Custom Tab and its redirect coming back. */
    private var pending: Pair<Pkce, String>? = null

    val isSignedIn get() = signIn != null
    val deviceName: String get() = android.os.Build.MODEL ?: "Android"

    init {
        val saved = prefs.getString("hub", null)?.let { runCatching { JSONObject(it) }.getOrNull() }
        if (saved != null && vault.load() != null) {
            signIn = HubSignIn(saved.optString("address"), saved.optString("id"), saved.optString("name"))
        }
    }

    private fun store(granted: HubClient.Granted, address: String) {
        vault.save(granted.token)
        val saved = HubSignIn(address, granted.hubId, granted.hubName)
        signIn = saved
        me = granted.me
        endedMessage = null
        prefs.edit().putString("hub", JSONObject().put("address", address).put("id", saved.hubId).put("name", saved.hubName).toString()).apply()
    }

    private fun clear() {
        vault.clear()
        prefs.edit().remove("hub").apply()
        signIn = null
        me = null
    }

    /**
     * Run a hub call off the main thread. A 401 means the session ended (30 days, or
     * removed under Paired devices), so the sign-in is dropped and the person goes
     * back to sign-in. Returns null on any failure (the message is in [error]).
     */
    suspend fun <T> call(work: (HubClient) -> T): T? {
        val current = signIn ?: return null
        return try {
            withContext(Dispatchers.IO) { work(HubClient(current.address, vault.load())) }
        } catch (e: HubFailure) {
            if (e === HubFailure.NotSignedIn) {
                clear()
                endedMessage = "Your session ended. Sign in again."
            } else {
                error = e.text
            }
            null
        }
    }

    /** `GET /api/me`: what this member may see and do. */
    suspend fun refresh() {
        call { it.me() }?.let { me = it }
    }

    // Ways to sign in

    private suspend fun attempt(address: String, wrongLogin: String? = null, work: (HubClient) -> HubClient.Granted) {
        val base = HubAddress.normalize(address) ?: run { error = "Enter the hub’s address, like lookabout.local."; return }
        busy = true; error = null
        try {
            store(withContext(Dispatchers.IO) { work(HubClient(base)) }, base)
        } catch (e: HubFailure) {
            error = if (e === HubFailure.NotSignedIn && wrongLogin != null) wrongLogin else e.text
        } finally {
            busy = false
        }
    }

    suspend fun pair(address: String, code: String) =
        attempt(address, "That code is wrong or has run out. Ask an admin for a new one.") { it.pair(code.trim(), deviceName) }

    suspend fun signIn(address: String, email: String, password: String) =
        attempt(address, "That email or password isn’t right.") { it.signIn(email.trim(), password, deviceName) }

    /** Google or Apple, in a Custom Tab that ends on `lookabout://hub/signed-in?code=…` (see [handle]). */
    suspend fun browserSignIn(address: String, provider: String) {
        val base = HubAddress.normalize(address) ?: run { error = "Enter the hub’s address, like lookabout.local."; return }
        busy = true; error = null
        try {
            val pkce = Pkce.make()
            val url = withContext(Dispatchers.IO) { HubClient(base).providerRedirect(provider, pkce.challenge) }
            pending = pkce to base
            CustomTabsIntent.Builder().build().apply {
                intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            }.launchUrl(context, Uri.parse(url))
        } catch (e: HubFailure) {
            error = e.text
        } finally {
            busy = false
        }
    }

    /** Called with every `lookabout://` link the activity receives. */
    suspend fun handle(link: String?) {
        when (val parsed = HubLink.parse(link)) {
            is HubLink.Pair -> pendingLink = parsed
            is HubLink.SignedIn -> {
                val (pkce, base) = pending ?: run { error = "Start the sign-in again."; return }
                pending = null
                busy = true; error = null
                try {
                    store(withContext(Dispatchers.IO) { HubClient(base).exchange(parsed.code, pkce.verifier, deviceName) }, base)
                } catch (e: HubFailure) {
                    error = e.text
                } finally {
                    busy = false
                }
            }
            is HubLink.SignInFailed -> { pending = null; error = parsed.message }
            null -> Unit
        }
    }

    suspend fun signOut() {
        // Best effort: the token is dropped either way, and a 401 here is not "your session ended".
        runCatching { signIn?.let { s -> withContext(Dispatchers.IO) { HubClient(s.address, vault.load()).signOut() } } }
        clear()
        endedMessage = null
    }
}
