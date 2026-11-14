package dev.omniship.lookabout

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.remember
import dev.omniship.lookabout.model.AppStore
import dev.omniship.lookabout.model.Appearance
import dev.omniship.lookabout.model.Role
import dev.omniship.lookabout.ui.screens.CameraFlow
import dev.omniship.lookabout.ui.screens.StartScreen
import dev.omniship.lookabout.ui.screens.ViewerScreen
import dev.omniship.lookabout.ui.theme.LookaboutTheme

/** A device runs as either a camera or a viewer. */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            val store = remember { AppStore(applicationContext) }
            val dark = when (store.settings.appearance) {
                Appearance.SYSTEM -> isSystemInDarkTheme()
                Appearance.LIGHT -> false
                Appearance.DARK -> true
            }
            LookaboutTheme(dark = dark) {
                when (store.settings.role) {
                    null -> StartScreen(store)
                    Role.CAMERA -> CameraFlow(store)
                    Role.VIEWER -> ViewerScreen(store)
                }
            }
        }
    }
}
