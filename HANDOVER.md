# Lookabout — handover

Written 13 Nov 2026. Read the root `README.md` first for layout and commands;
each of `firmware/esp32`, `firmware/rpi`, `ios`, `android` has its own README.

## Where things stand

| Piece | Folder | State |
|---|---|---|
| Web app | `src/` | Builds. Main screens checked in a browser (light and dark, phone/tablet/desktop). |
| ESP32-S3 + USB webcam firmware | `firmware/esp32/` | Compiles. **Never run on a board.** |
| Raspberry Pi camera node | `firmware/rpi/` | Server tested with a stand-in video source. **Never run on a Pi.** |
| Android app | `android/` | Builds. Start, viewer tabs and live video from a test stream checked on an emulator. |
| iOS app | `ios/` | Sources type-check. **Never built or run** (no iOS simulator runtime on this Mac). |
| Home hub | — | **Does not exist.** |

What is real: the camera role on each platform (device camera, dim, pause),
themes, settings, cameras added by address (ESP32 / Pi stream shows in the
web and Android viewers), firmware packaging, Wi-Fi firmware update from the
web page (tested against a stand-in board).

What is sample data: the nursery room, house cameras, events, clips, sound
levels (`src/lib/sampleData.js`, `SampleData` in the apps). Pairing,
phone-to-phone streaming and the hub flows are screens only.

## Decisions already made (don't reopen without the owner)

- Native apps for the stores: SwiftUI (`ios/`, XcodeGen) and Kotlin/Compose
  (`android/`), following `../murmur`. No Capacitor / React Native.
- First real use case: **ESP32-S3 with a USB webcam** (not an ESP32-CAM board).
- Every screen follows light/dark (System / Light / Dark). Only video tiles
  stay dark inside. This overrides the design, which pinned the viewer dark.
- Cry and motion detection should run **on the hub** as the main path;
  on-device detection only for a phone used as a camera with no hub.
- The hub runs as a **Docker container on the owner's Raspberry Pi**.
- Sibling repos (`../murmur`, `../envdock`, `../home`) are the convention
  reference. Web UI uses `@omniship-labs/design-beacon` tokens, never raw hex.

## Task list

Ordered by what unblocks the most. Each task says what "done" means.

### A. Prove the ESP32 path on hardware (blocks everything camera-side)

- [ ] **A1. Flash the board from the web page.** `npm run dev`, open
      `#/flash` in Chrome, Flash over USB. Done: board boots, opens the
      "Lookabout-Setup" Wi-Fi.
- [ ] **A2. Wi-Fi setup.** Enter Wi-Fi details at `http://192.168.4.1`. Done:
      serial log prints the camera address.
- [ ] **A3. Webcam streaming.** Plug in the webcam (powered hub likely
      needed). Done: `http://<address>/stream` shows video. Expect to tune
      the format list in `camera.c` (`k_formats`); the S3's USB is full-speed
      so only small MJPEG modes work, and some webcams won't.
- [ ] **A4. Add it in the viewer** (web, then Android, then iOS). Done: live
      video in the Cameras grid.
- [ ] **A5. Wi-Fi firmware update against the real board** from web, Android
      and iOS. Done: version changes after restart; pulling power mid-update
      leaves the old firmware running.
- [ ] **A6. Android USB flashing.** `android/.../net/Firmware.kt` implements
      the ESP32 bootloader protocol from documentation and is the least
      certain code in the repo. Done: a blank board flashed from a phone.
- [ ] **A7. mDNS discovery.** Confirm the apps list the board under "Found
      on your network" (`_lookabout._tcp`). Older Android versions may not
      resolve `.local` names; fall back to the IP from discovery if so.

### B. Home hub in Docker on the Pi (the owner's next priority)

Nothing is built. Suggested shape, to be confirmed while building:

- [ ] **B1. Hub service skeleton.** New `hub/` folder: a small service plus
      a `Dockerfile` and `docker-compose.yml` for arm64, host networking
      (needed for mDNS and LAN cameras), a volume for config and recordings.
      Done: `docker compose up` on the Pi serves a status page and advertises
      `_lookabout-hub._tcp`.
- [ ] **B2. Camera bridge.** Run go2rtc (MIT) inside the container; the hub
      registers cameras with it (ESP32 / Pi MJPEG, RTSP, USB webcams on the
      Pi) and hands viewers a WebRTC stream. Done: an ESP32 camera plays in
      the web viewer through the hub instead of by direct address.
- [ ] **B3. Hub pairing.** The hub shows a pairing code (and QR) on its
      page; a viewer scans or types it, they exchange keys, and the hub
      stores the viewer. Replace the sample flow in `#/add/hub`
      (`Guided` in `src/screens/Add.jsx`) and `hubPaired` in
      `src/lib/store.js`. Done: pairing survives a restart on both sides;
      removing a viewer in Paired devices revokes it on the hub.
- [ ] **B4. Hub API for viewers.** Cameras list, status, events, clips,
      authenticated with the pairing key. Replace `sampleData` reads in the
      Cameras and Events screens (web first). Done: the viewer shows the
      hub's real cameras and no sample ones when a hub is paired.
- [ ] **B5. Recording and clips.** Continuous recording with retention
      ("Keep clips for"), clip export for events. Done: Events list and clip
      player play real clips.
- [ ] **B6. Motion detection on the hub.** Frame comparison inside the drawn
      zones; zones saved from the Zones screen. Done: walking through a zone
      creates an event with a clip.
- [ ] **B7. Cry detection on the hub.** An open audio classifier (e.g.
      YAMNet) on cameras that have sound; the 20-second rule from the spec.
      Note the ESP32 camera has no microphone, so this needs a Pi with a
      mic or a phone camera. Done: a played cry recording raises an event.
- [ ] **B8. Alerts.** Push to paired viewers (APNs / FCM) for cry, motion,
      camera offline. Needs developer accounts (see D).
- [ ] **B9. Decide the hub's language/runtime** before B1. Python matches
      `firmware/rpi`; Go matches go2rtc. Owner's call.

### C. Phone-to-phone (no hub) path

- [ ] **C1. Signalling service** for WebRTC offers/answers (tiny, stateless).
- [ ] **C2. Real pairing**: QR + word code on the camera, scan/type on the
      viewer, keys stored on device. Screens exist on web
      (`src/screens/Pairing.jsx`, `Camera.jsx`); the QR is a placeholder.
- [ ] **C3. WebRTC streaming** camera → viewer on web, iOS, Android,
      including hold-to-talk audio back.
- [ ] **C4. Background operation**: iOS background audio session, Android
      foreground service, so a camera keeps streaming with the screen off.

### D. Native apps to store quality

- [ ] **D1. Run the iOS app.** Install an iOS simulator runtime (Xcode →
      Settings → Components), `cd ios && xcodegen generate`, build, fix
      whatever only shows at runtime. Check cry detection on a real iPhone.
- [ ] **D2. Screen parity with web**: zones, clip player, paired devices,
      pairing, lullaby state, offline/reconnecting states. Brand flows
      (Nest, Ring, Wyze, Tesla) can wait for the hub.
- [ ] **D3. Fonts**: bundle Space Grotesk, IBM Plex Sans, IBM Plex Mono (all
      OFL) in both apps; system fonts stand in today.
- [ ] **D4. Android**: check in a Gradle wrapper; add a foreground service;
      test on a phone; light-mode pass.
- [ ] **D5. Store setup**: Apple developer team + signing, App Store Connect
      record, Play Console record, release keystore, privacy answers,
      screenshots. Bundle/app ID is `dev.omniship.lookabout`. Trademark
      check on the name is still open (from the design spec).
- [ ] **D6. Review notes**: justify iOS background audio (Guideline 2.5.4)
      and file export compliance once encryption ships.

### E. Web app loose ends

- [ ] **E1. Unwired buttons**: Snapshot, clip Save / Share / Delete,
      "Sign in with Google", Status page, Try again / Connection help.
- [ ] **E2. Hub-dependent add flows** (USB on hub, RTSP, Eufy, Nest, Ring,
      Wyze, Tesla) are forms that add a sample camera. Wire to the hub (B).
- [ ] **E3. Deploy**: no GitHub Pages workflow yet (see `../murmur`'s
      `deploy.yml`). The repo is not a git repository yet either.
- [ ] **E4. https vs plain-http boards**: a deployed https page can't show
      `http://` board streams or send them updates. Goes away once streams
      come through the hub; until then document "open over http on your LAN".
- [ ] **E5. Design-system gaps**: Switch, Badge, Card, Input are local in
      `src/components/ui.jsx` because design-beacon 0.1.0 doesn't export
      them. Promote upstream or keep local.

### F. Security (before anyone outside the house uses it)

- [ ] **F1.** Board streams and `POST /api/update` have **no sign-in**:
      anyone on the LAN can watch or push firmware. Close with pairing keys.
- [ ] **F2.** The "Lookabout-Setup" Wi-Fi is open and the Wi-Fi password is
      sent over plain http to the board. Acceptable for setup on a bench;
      revisit.
- [ ] **F3.** Android allows cleartext traffic app-wide for LAN boards;
      narrow it once streams go through the hub.
- [ ] **F4.** Signed firmware images / rollback protection for updates.

## How to run each piece

```sh
# Web
NODE_AUTH_TOKEN=$(gh auth token) npm install
npm run dev

# ESP32 firmware, then package it for the web page and both apps
cd firmware/esp32 && pio run -e esp32-s3-uvc && cd ../..
npm run firmware:package

# Pi camera node (on the Pi)
cd firmware/rpi && ./install.sh

# Android (no wrapper yet; use Android Studio or a local Gradle 8.13+)
cd android && gradle :app:assembleDebug

# iOS
cd ios && xcodegen generate && open Lookabout.xcodeproj
```

Design states that need live data can be forced on web with `?state=`
(`offline`, `ring`, `reconnecting`, `empty`, `battery`); see the root README.

## Things that will trip you up

- `npm install` needs `NODE_AUTH_TOKEN` for the org's GitHub Packages registry.
- The firmware build output is copied into `public/firmware/`, the iOS
  resources and the Android assets by `npm run firmware:package`. If you
  change the firmware and skip that step, the apps flash the old build.
- The board needs 4 MB of flash or more (two app slots).
- `android/local.properties` points at this machine's SDK path; it is
  ignored by `.gitignore` and must be recreated elsewhere.
- The design source is the canvas at
  https://claude.ai/code/artifact/a9e8f3d8-d216-4d03-a0f0-ceb8ae436083
  (its "Handoff spec" page lists states, edge cases and open issues).
