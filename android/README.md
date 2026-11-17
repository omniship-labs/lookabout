# Lookabout — Android

Kotlin + Jetpack Compose (same setup as `murmur/android`).

```sh
cd android
gradle :app:assembleDebug        # Gradle 8.13+, JDK 17+, Android SDK 36
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

There is no Gradle wrapper checked in yet; open the folder in Android Studio
or use a local Gradle.

## Tests

```sh
cd android
gradle :app:testDebugUnitTest      # unit tests (app/src/test)
```

They cover the pure hub sign-in logic (PKCE, links, errors, `/api/me` access); CI runs them.

## Layout

```
app/src/main/java/dev/omniship/lookabout/
  MainActivity.kt            a device is a camera or a viewer
  model/AppStore.kt          settings (SharedPreferences), cameras, the design's sample data
  hub/HubAuth.kt             pure sign-in logic: PKCE, lookabout:// links, hub errors, /api/me access (no Android, no network)
  hub/HubClient.kt           the hub's sign-in, /api/me, devices and ticket calls (bearer header only)
  hub/TokenVault.kt          the token, encrypted with an Android Keystore AES-GCM key
  hub/HubSession.kt          sign-in flows, Custom Tabs, 401 → back to sign-in
  ui/screens/HubScreens.kt   Settings → Home hub: sign in, who you are, devices, sign out
  net/MjpegStream.kt         ESP32 / Pi video on the home network + NSD discovery
  ui/theme/Theme.kt          OmniShip Labs tokens (light/dark)
  ui/Components.kt           wordmark, video tile, sound meter, pills, buttons
  ui/screens/CameraScreens.kt  start, camera setup/streaming/denied (CameraX self-view)
  ui/screens/ViewerScreens.kt  Live, Cameras, Events, Alerts & settings, add camera
```

## What works

- **Camera role**: permissions, self-view, pause/stop, dim after 10 s, battery state.
- **Viewer role**: Live, Cameras, Events, Alerts tabs. Cameras on your Wi-Fi
  (ESP32, Raspberry Pi) are found over NSD or added by address and show live video.
- **Firmware**: updates over Wi-Fi from a camera's screen, and **USB flashing**
  of a board plugged into the phone (Cameras → + → Flash over USB). The USB
  flasher speaks the ESP32 bootloader protocol directly (`net/Firmware.kt`)
  and has not been run against a board yet.
- **Home hub sign-in** (Settings → Home hub; contract in `docs/hub-auth.md`, issue #69): pairing code
  (or `lookabout://hub?address=…&code=…` from an admin's QR), email and password, and Google or Apple
  in a Custom Tab (PKCE). The token is kept encrypted with a Keystore key. A 401 sends you back to
  sign-in; sign out and ending other devices work. Passkeys are not offered in the app (they are tied
  to the hub's address and need a Digital Asset Links file on it); use a pairing code or Google/Apple.
- Everything else the viewer shows is the design's sample content.

## Not yet

- Cry detection (planned: on-device audio classifier), motion detection.
- Hub cameras, events and video in the app (#23; `HubMe.canSee`/`canManage` and `HubClient.ticket` are ready for it), peer-to-peer streaming, push alerts.
- Streaming with the app in the background (needs a foreground service).
- The design's fonts; release signing and Play Console setup
  (application ID `dev.omniship.lookabout`).

## Status

Builds, and runs on an API 36 emulator: start, viewer tabs, and live video
from a test camera stream were checked there. Not yet run on a phone.
