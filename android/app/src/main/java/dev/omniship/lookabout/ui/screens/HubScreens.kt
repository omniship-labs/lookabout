package dev.omniship.lookabout.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import dev.omniship.lookabout.hub.HubClient
import dev.omniship.lookabout.hub.HubSession
import dev.omniship.lookabout.ui.Eyebrow
import dev.omniship.lookabout.ui.OutlineButton
import dev.omniship.lookabout.ui.Pill
import dev.omniship.lookabout.ui.PrimaryButton
import dev.omniship.lookabout.ui.Radius
import dev.omniship.lookabout.ui.card
import dev.omniship.lookabout.ui.theme.LocalTokens
import dev.omniship.lookabout.ui.theme.Palette
import dev.omniship.lookabout.ui.theme.Side
import dev.omniship.lookabout.ui.theme.Type
import kotlinx.coroutines.launch

/** Settings → Home hub: sign in, or who you're signed in as and which devices are signed in. */
@Composable
fun HubScreen(hub: HubSession, close: () -> Unit) {
    val t = LocalTokens.current
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = Side)
            .padding(top = 12.dp, bottom = 20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            "‹  Home hub",
            Modifier.clickable(onClick = close).padding(vertical = 10.dp).semantics { contentDescription = "Back" },
            style = Type.display(22), color = t.textStrong,
        )
        if (hub.isSignedIn) SignedIn(hub) else SignIn(hub)
        hub.error?.let { Text(it, style = Type.sans(13), color = Palette.Danger) }
    }
}

@Composable
private fun SignIn(hub: HubSession) {
    val t = LocalTokens.current
    val scope = rememberCoroutineScope()
    var address by rememberSaveable { mutableStateOf("") }
    var code by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }

    // A QR or lookabout:// link fills in the address and code.
    LaunchedEffect(hub.pendingLink) {
        hub.pendingLink?.let { address = it.address; code = it.code; hub.pendingLink = null }
    }

    hub.endedMessage?.let { Text(it, style = Type.sans(14), color = Palette.Warning) }

    OutlinedTextField(
        value = address, onValueChange = { address = it; hub.error = null },
        label = { Text("Hub address") }, placeholder = { Text("lookabout.local") },
        singleLine = true, modifier = Modifier.fillMaxWidth(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
    )

    Eyebrow("PAIRING CODE")
    Text("An admin makes one for you on the hub’s page, or scan its QR code.", style = Type.sans(13), color = t.textMuted)
    OutlinedTextField(
        value = code, onValueChange = { code = it }, label = { Text("Code") },
        singleLine = true, modifier = Modifier.fillMaxWidth(),
    )
    PrimaryButton("Pair this device", enabled = address.isNotBlank() && code.isNotBlank() && !hub.busy) {
        scope.launch { hub.pair(address, code) }
    }

    Eyebrow("EMAIL AND PASSWORD")
    OutlinedTextField(
        value = email, onValueChange = { email = it }, label = { Text("Email") },
        singleLine = true, modifier = Modifier.fillMaxWidth(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
    )
    OutlinedTextField(
        value = password, onValueChange = { password = it }, label = { Text("Password") },
        singleLine = true, modifier = Modifier.fillMaxWidth(),
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
    )
    PrimaryButton("Sign in", enabled = address.isNotBlank() && email.isNotBlank() && password.isNotEmpty() && !hub.busy) {
        scope.launch { hub.signIn(address, email, password) }
    }

    Eyebrow("OR CONTINUE WITH")
    OutlineButton("Continue with Google") { if (address.isNotBlank() && !hub.busy) scope.launch { hub.browserSignIn(address, "google") } }
    OutlineButton("Continue with Apple") { if (address.isNotBlank() && !hub.busy) scope.launch { hub.browserSignIn(address, "apple") } }
}

@Composable
private fun SignedIn(hub: HubSession) {
    val t = LocalTokens.current
    val scope = rememberCoroutineScope()
    val devices = remember { mutableStateListOf<HubClient.Device>() }

    suspend fun load() {
        hub.call { it.devices() }?.let { devices.clear(); devices.addAll(it) }
    }
    LaunchedEffect(Unit) { hub.refresh(); load() }

    hub.me?.let { me ->
        Column(Modifier.fillMaxWidth().card(Radius.Md).padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(me.name, style = Type.sans(16, FontWeight.SemiBold), color = t.textStrong)
            Text(me.householdName, style = Type.sans(13), color = t.textMuted)
            Text(
                if (me.isAdmin) "Admin · every camera" else "${me.cameras?.size ?: 0} cameras shared with you",
                style = Type.sans(13), color = t.textMuted,
            )
        }
    }

    Eyebrow("SIGNED-IN DEVICES")
    Column(Modifier.fillMaxWidth().card(Radius.Md).padding(horizontal = 14.dp)) {
        devices.forEach { device ->
            Row(Modifier.fillMaxWidth().heightIn(min = 52.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(device.name, Modifier.weight(1f), style = Type.sans(14, FontWeight.Medium), color = t.textStrong)
                if (device.current) {
                    Pill("THIS DEVICE", small = true)
                } else {
                    Text(
                        "End",
                        Modifier.clickable { scope.launch { hub.call { it.endDevice(device.id) }; load() } }.padding(8.dp),
                        style = Type.sans(14, FontWeight.Medium), color = Palette.Danger,
                    )
                }
            }
        }
    }

    OutlineButton("Sign out") { scope.launch { hub.signOut() } }
    Text(hub.signIn?.address.orEmpty(), style = Type.mono(12), color = t.textMuted)
}
