# Lookabout — Android

Kotlin + Jetpack Compose (same setup as `murmur/android`).

```sh
cd android
gradle :app:assembleDebug        # Gradle 8.13+, JDK 17+, Android SDK 36
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

There is no Gradle wrapper checked in yet; open the folder in Android Studio
or use a local Gradle.

## Layout

```
app/src/main/java/dev/omniship/lookabout/
  MainActivity.kt            a device is a camera or a viewer
  model/AppStore.kt          settings (SharedPreferences), cameras, the design's sample data
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
- Everything else the viewer shows is the design's sample content.

## Not yet

- Cry detection (planned: on-device audio classifier), motion detection.
- Pairing, peer-to-peer streaming, the home hub, push alerts.
- Streaming with the app in the background (needs a foreground service).
- The design's fonts; release signing and Play Console setup
  (application ID `dev.omniship.lookabout`).

## Status

Builds, and runs on an API 36 emulator: start, viewer tabs, and live video
from a test camera stream were checked there. Not yet run on a phone.
