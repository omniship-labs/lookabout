package dev.omniship.lookabout

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import dev.omniship.lookabout.hub.HubSession
import dev.omniship.lookabout.model.AppStore
import dev.omniship.lookabout.model.Appearance
import dev.omniship.lookabout.model.Role
import dev.omniship.lookabout.ui.screens.CameraFlow
import dev.omniship.lookabout.ui.screens.StartScreen
import dev.omniship.lookabout.ui.screens.ViewerScreen
import dev.omniship.lookabout.ui.theme.LookaboutTheme

/** A device runs as either a camera or a viewer. */
class MainActivity : ComponentActivity() {
    /** The latest `lookabout://` link (a QR's pairing link, or the end of a browser sign-in). */
    private var link by mutableStateOf<String?>(null)

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        link = intent.dataString
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        link = intent?.dataString
        setContent {
            val store = remember { AppStore(applicationContext) }
            val hub = remember { HubSession(applicationContext) }
            LaunchedEffect(link) {
                link?.let { hub.handle(it); link = null }
            }
            val dark = when (store.settings.appearance) {
                Appearance.SYSTEM -> isSystemInDarkTheme()
                Appearance.LIGHT -> false
                Appearance.DARK -> true
            }
            LookaboutTheme(dark = dark) {
                when (store.settings.role) {
                    null -> StartScreen(store)
                    Role.CAMERA -> CameraFlow(store)
                    Role.VIEWER -> ViewerScreen(store, hub)
                }
            }
        }
    }
}
