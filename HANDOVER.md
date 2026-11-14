# Lookabout — handover

Written 13 Nov 2026, updated 14 Nov 2026 (home hub). Read the root `README.md` first for layout and commands;
each of `firmware/esp32`, `firmware/rpi`, `ios`, `android` has its own README.

## Where things stand

| Piece | Folder | State |
|---|---|---|
| Web app | `src/` | Builds. Main screens checked in a browser (light and dark, phone/tablet/desktop). |
| ESP32-S3 + USB webcam firmware | `firmware/esp32/` | Compiles. **Never run on a board.** |
| Raspberry Pi camera node | `firmware/rpi/` | Server tested with a stand-in video source. **Never run on a Pi.** |
| Android app | `android/` | Builds. Start, viewer tabs and live video from a test stream checked on an emulator. |
| iOS app | `ios/` | Sources type-check. **Never built or run** (no iOS simulator runtime on this Mac). |
| Home hub | `hub/` | Service, pairing, camera bridge and viewer API work against a stand-in camera with the web viewer. **Never run on a Pi or as a container.** No recording or detection yet. |

What is real: the camera role on each platform (device camera, dim, pause),
themes, settings, cameras added by address (ESP32 / Pi stream shows in the
web and Android viewers), firmware packaging, Wi-Fi firmware update from the
web page (tested against a stand-in board), and on web the home hub: pairing,
hub cameras (WebRTC live view, snapshot), offline events, paired viewers.

What is sample data: the nursery room and sound levels; on web the house
cameras and events too while no hub is paired; all of it in the Android and
iOS apps (`src/lib/sampleData.js`, `SampleData` in the apps). Phone-to-phone
pairing and streaming, clips, and the Nest / Ring / Wyze / Tesla flows are
screens only.

## Decisions already made (don't reopen without the owner)

- Native apps for the stores: SwiftUI (`ios/`, XcodeGen) and Kotlin/Compose
  (`android/`), following `../murmur`. No Capacitor / React Native.
- First real use case: **ESP32-S3 with a USB webcam** (not an ESP32-CAM board).
- Every screen follows light/dark (System / Light / Dark). Only video tiles
  stay dark inside. This overrides the design, which pinned the viewer dark.
- Cry and motion detection should run **on the hub** as the main path;
  on-device detection only for a phone used as a camera with no hub.
- The hub runs as a **Docker container on the owner's Raspberry Pi**.
- The hub is written in **Python**, with go2rtc beside it for video (B9).
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

B1–B4 are built in `hub/` (see its README for the routes and how to run
it) and wired into the web app. Everything was tested against a stand-in
MJPEG camera on one machine; nothing has met a Pi, a container runtime, a
real RTSP camera or a USB webcam yet.

- [ ] **B1. Hub service skeleton.** `hub/`: Python service, `Dockerfile`
      (builds go2rtc from source), `docker-compose.yml` with host networking
      and a `hub-data` volume. Serves a status page on port 8787 and
      announces `_lookabout-hub._tcp`. **Left:** `docker compose up -d
      --build` on the Pi. The full image has never been built (the session
      that wrote it could not reach Debian's package mirror; the go2rtc
      stage built). Check the mDNS announcement from another device.
- [x] **B2. Camera bridge.** The hub runs go2rtc and registers ESP32 / Pi
      (MJPEG), RTSP and USB cameras with it; viewers get WebRTC, with MJPEG
      as the fallback and for small tiles of MJPEG cameras. Seen working: a
      stand-in board added through the hub plays in the web viewer.
      **Left:** try a real RTSP camera (sound included: the Opus path is
      untested) and a USB webcam (the hub asks for MJPEG at 1280×720, which
      not every webcam has; see `stream_url` in `hub/lookabout_hub/cameras.py`).
- [x] **B3. Hub pairing.** The hub page makes a one-time code (5 minutes,
      with a QR of `lookabout://hub?address=…&code=…` for the native apps
      to scan later); the web viewer sends it and gets a key. The hub keeps
      a hash, the viewer keeps the key in its settings. Removing a viewer
      under Paired devices deletes the key on the hub, and that viewer
      drops back to unpaired on its next request. `#/add/hub` is the real
      flow (`HubSetup` in `src/screens/Add.jsx`); the link form
      `#/add/hub?address=…&code=…` prefills it.
- [x] **B4. Hub API for viewers.** Cameras, status, events, viewers, all
      behind the pairing key (`src/lib/hub.js`, `src/lib/store.js`). With a
      hub paired the web Cameras, live, Events and Paired devices screens
      show the hub's data and no sample cameras. Events are "offline" only
      until B6/B7; clips need B5.
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
- [x] **B9. Hub language: Python** (owner's decision, 14 Nov 2026).
- [ ] **B10. Hub in the Android and iOS apps.** Pairing (scan the hub
      page's QR), hub cameras over WebRTC, events. Web only so far.
- [ ] **B11. Sound from hub cameras in the viewer.** Hub video plays muted;
      there is no listen control for a hub camera yet.

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

- [ ] **E1. Unwired buttons**: clip Save / Share / Delete,
      "Sign in with Google", Status page, Try again / Connection help.
      Snapshot is wired for cameras added by address and for hub cameras
      (`src/lib/snapshot.js`).
- [ ] **E2. Hub-dependent add flows.** USB on hub, RTSP and Eufy now add
      real cameras to the hub, and ESP32 / Pi cameras go through the hub
      when one is paired. Nest, Ring, Wyze and Tesla are still sample
      screens (greyed out as "Not in the hub yet" once a hub is paired);
      each needs its own integration in the hub.
- [ ] **E3. Deploy**: `.github/workflows/deploy.yml` builds on a push to
      `main` and publishes `dist` to GitHub Pages; the build uses a relative
      base so it works under `/lookabout/`. It was written here, not copied
      from `murmur` (that repo wasn't readable from the session), so compare
      the two. Its first run is the merge of pull request 2; it can only
      publish once Pages is switched on (Settings → Pages → Source: GitHub
      Actions), then re-run it from the Actions tab. `npm ci` already works
      in Actions (see E6). Done: a push to `main` publishes the web app.
- [ ] **E4. https vs plain-http boards**: a deployed https page can't show
      `http://` board streams or send them updates. Goes away once streams
      come through the hub; until then document "open over http on your LAN".
      The hub itself is plain http too, so the same applies to pairing with
      it: the hub needs https (or the hub serving the web app) to fix this.
- [ ] **E5. Design-system gaps**: Switch, Badge, Card, Input are local in
      `src/components/ui.jsx` because design-beacon 0.1.0 doesn't export
      them. Promote upstream or keep local.
- [x] **E6. Build check on pull requests.** `.github/workflows/build.yml`
      runs `npm ci` and `npm run build` on every PR (check name `web`). It
      went green on pull request 2, so Actions can read the design-beacon
      package. Not seen red on a broken build yet. Optional follow-up: make
      `web` a required check on `main` (Settings → Branches).
- [ ] **E7. `npm ci` in Claude cloud sessions.** It fails with 401 because
      the environment has no `NODE_AUTH_TOKEN`. Add one (a GitHub token with
      `read:packages`) in the environment's settings. Until then, clone the
      public `omniship-labs/design-beacon` repo and `npm install --no-save`
      from that folder; the package is plain source with no build step.
- [ ] **E8. Snapshot on a real board.** Tested only against a stand-in
      camera. After A3, press Snapshot while the stream is playing. Done: a
      JPEG of the current frame downloads from an ESP32 and from a Pi.
- [x] **E9. Snapshot for hub cameras.** The frame comes from the hub
      (`/api/cameras/<id>/snapshot.jpg`). Seen working with the stand-in
      camera.

### F. Security (before anyone outside the house uses it)

- [ ] **F1.** Board streams and `POST /api/update` have **no sign-in**:
      anyone on the LAN can watch or push firmware. Close with pairing keys.
- [ ] **F2.** The "Lookabout-Setup" Wi-Fi is open and the Wi-Fi password is
      sent over plain http to the board. Acceptable for setup on a bench;
      revisit.
- [ ] **F3.** Android allows cleartext traffic app-wide for LAN boards;
      narrow it once streams go through the hub.
- [ ] **F4.** Signed firmware images / rollback protection for updates.
- [ ] **F5.** The hub is plain http: anyone on the LAN can open its page
      and pair a viewer, and keys and video requests travel unencrypted
      (the key is in the address of MJPEG streams). Camera passwords sit
      unencrypted in the hub's data volume. Needs https on the hub and a
      way to approve pairing.

## What to pick up next

In order:

1. Run the hub on the Pi (B1) and point it at real cameras (B2).
2. Recording, motion and cry detection on the hub (B5–B7), which also
   unblock the clip buttons (E1).
3. Switch GitHub Pages on, then re-run the Deploy workflow (finishes E3).
4. Flash a real ESP32-S3 (A1–A7), then Snapshot on a real board (E8).
5. Add `NODE_AUTH_TOKEN` to the Claude cloud environment (E7).

## How to run each piece

```sh
# Web
NODE_AUTH_TOKEN=$(gh auth token) npm install
npm run dev

# ESP32 firmware, then package it for the web page and both apps
cd firmware/esp32 && pio run -e esp32-s3-uvc && cd ../..
npm run firmware:package

# Home hub (on the Pi; then open http://<pi>:8787)
cd hub && docker compose up -d --build
python3 -m unittest discover -s hub/tests     # hub tests, anywhere

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
