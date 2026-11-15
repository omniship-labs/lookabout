# Lookabout

Turn any camera into a baby monitor or CCTV. Free and open source (AGPL-3.0),
an [OmniShip Labs](https://omniship.dev) project. A device runs as either a
**camera** or a **viewer**.

This repo is a monorepo:

- `src/` — the web app (Vite + React + `@omniship-labs/design-beacon`): laptop
  as camera, desktop/tablet/phone viewer, typed pairing.
- [`firmware/esp32/`](firmware/esp32/) — ESP32-S3 + USB webcam camera (PlatformIO, ESP-IDF).
- [`firmware/rpi/`](firmware/rpi/) — Raspberry Pi camera node (Python, systemd).
- [`hub/`](hub/) — home hub (Python + go2rtc, Docker): brings ESP32 / Pi / RTSP / USB
  cameras to paired viewers over WebRTC.
- [`ios/`](ios/) — SwiftUI app (XcodeGen project).
- [`android/`](android/) — Kotlin/Compose app.

Work is tracked in [GitHub issues](https://github.com/omniship-labs/lookabout/issues)
(epics #7–#13). Contributor and agent rules, tests included, are in
[`AGENTS.md`](AGENTS.md).

## Status

As of 15 Nov 2026:

| Piece | Folder | State |
|---|---|---|
| Web app | `src/` | Builds. Main screens checked in a browser (light and dark, phone/tablet/desktop). Logic in `src/lib` has tests. The new hub pairing wizard hasn't been seen in a browser yet (#49). |
| ESP32-S3 + USB webcam firmware | `firmware/esp32/` | Builds for the ESP32-S3 with ESP-IDF 5.3. Web interface, settings and over-Wi-Fi updates tested in QEMU (`firmware/esp32/qemu`). **Never run on a board** (#14–#19). |
| Raspberry Pi camera node | `firmware/rpi/` | Has tests, with stand-in capture commands. **Never run on a Pi.** |
| Android app | `android/` | Builds. Start, viewer tabs and live video from a test stream checked on an emulator. No tests. |
| iOS app | `ios/` | Sources type-check. **Never built or run** (#30). No tests. |
| Home hub | `hub/` | Pairing, camera bridge, recording, motion and cry detection, clips and the viewer API work against stand-in cameras with the web viewer, and have tests. **Never run on a Pi or as a container** (#20). No alerts yet (#22). |
| Accounts | `docs/hub-auth.md` | Contract drafted, waiting on sign-off (#48). Nothing built beyond the wizard component (#49). |

What is real: the camera role on each platform (device camera, dim, pause),
themes, settings, cameras added by address (ESP32 / Pi stream shows in the
web and Android viewers), firmware packaging, Wi-Fi firmware update from the
web page (tested against a stand-in board, and the board side in QEMU), and on
web the home hub: pairing, hub cameras (WebRTC live view, snapshot), events
with clips (offline, motion, crying), motion zones, paired viewers.

What is sample data: the nursery room and sound levels; on web the house
cameras and events too while no hub is paired; all of it in the Android and
iOS apps (`src/lib/sampleData.js`, `SampleData` in the apps). Phone-to-phone
pairing and streaming, and the Nest / Ring / Wyze / Tesla flows are screens
only.

## Web app

```sh
NODE_AUTH_TOKEN=$(gh auth token) npm install   # design-beacon comes from GitHub Packages
npm run dev
npm run build
npm test        # web app logic tests (node:test, no browser)
npm run coverage  # the same, failing if coverage drops below its floor
```

Every pull request is checked by `.github/workflows/build.yml` (see [Tests and coverage](#tests-and-coverage)). A push to `main`
publishes `dist` to GitHub Pages through `.github/workflows/deploy.yml` (Pages
has to be switched on in the repo settings first).

```
src/
├─ App.jsx               routes (hash router) + launch screen
├─ index.css             Lookabout aliases on top of the design-beacon tokens
├─ components/
│  ├─ ui.jsx             primitives not in design-beacon yet (Switch, Segmented, Field, Pill…)
│  ├─ viewer.jsx         VideoTile, SoundMeter, EventRow, TabBar / rail / sidebar
│  ├─ brand.jsx          LensWordmark, AppIcon, LensGlyph
│  └─ icons.jsx
├─ screens/              one file per area: Start, Camera, Live, Cameras, Settings, Add, Pairing
└─ lib/
   ├─ sampleData.js      the design's sample content (stands in for live data)
   ├─ store.js           settings (localStorage), cameras, the paired hub
   ├─ hub.js             requests to the home hub (pairing, cameras, events, WebRTC)
   ├─ camera.js          this device's camera and mic
   ├─ snapshot.js        save a frame from a camera (by address or through the hub)
   └─ router.js, hooks.js
```

### What is real and what is sample

Real: the camera role (device camera and mic, dimming, pause/stop), themes,
settings, motion-zone editing, **cameras added by address** (ESP32 or
Raspberry Pi on the same network — their video shows in the viewer), and the
**home hub**: pair with it (Cameras → **+** → *Home hub*), and the Cameras
grid, live view, Events and Paired devices show what the hub has. Hub
cameras play over WebRTC, falling back to MJPEG.

Sample (from `src/lib/sampleData.js`): the nursery room, sound levels, and —
only while no hub is paired — the house cameras and events. The Nest, Ring,
Wyze and Tesla add flows are still sample screens. Phone-to-phone pairing
and streaming are not built yet.

Some design states only happen with live data. Add `?state=` to see them:
`#/cameras?state=offline`, `#/cameras?state=ring`,
`#/live/side?state=reconnecting`, `#/live/side?state=empty`,
`#/camera/live?state=battery`.

### Flashing and updating ESP32 cameras

`#/flash` (Settings → Camera firmware, or the ESP32 add screen):

- **Over USB** (first flash): Chrome or Edge on a computer, using Web Serial.
- **Over Wi-Fi** (updates): any browser, for cameras already added by address.

The firmware files live in `public/firmware/`. After changing the firmware:

```sh
cd firmware/esp32 && pio run -e esp32-s3-uvc && cd ../..
npm run firmware:package     # copies the build to the web page and both apps
```

### Adding an ESP32 or Pi camera

Cameras → **+** → *ESP32 camera* or *Raspberry Pi camera*, enter the board's
address, test, add. The boards serve plain http, so open the web app over
http on your own network (`npm run dev` is fine); an https page will block
the stream.

## Run each piece

```sh
# Web (needs NODE_AUTH_TOKEN for design-beacon, see AGENTS.md)
NODE_AUTH_TOKEN=$(gh auth token) npm install
npm run dev

# ESP32 firmware, then package it for the web page and both apps
cd firmware/esp32 && pio run -e esp32-s3-uvc && cd ../..
npm run firmware:package

# Home hub (on the Pi; then open http://<pi>:8787)
cd hub && docker compose up -d --build

# Pi camera node (on the Pi)
cd firmware/rpi && ./install.sh

# Android (no Gradle wrapper yet; use Android Studio or a local Gradle 8.13+)
cd android && gradle :app:assembleDebug

# iOS
cd ios && xcodegen generate && open Lookabout.xcodeproj
```

## Tests and coverage

Tests come with changes. Every pull request runs all of these, and fails if
coverage drops below a part's floor:

| Part | Tests | Run | Coverage floor |
|---|---|---|---|
| Web app logic | `tests/*.test.mjs` (`node:test`, no browser, no install needed) | `npm test`, or `npm run coverage` | `scripts/coverage.mjs` |
| Home hub | `hub/tests/` | `cd hub && python3 -m coverage run -m unittest discover -s tests && python3 -m coverage report` | `hub/.coveragerc` |
| Pi camera node | `firmware/rpi/tests/` | `cd firmware/rpi && python3 -m coverage run -m unittest discover -s tests && python3 -m coverage report` | `firmware/rpi/.coveragerc` |
| ESP32 firmware | `firmware/esp32/qemu/test_board.py`, the firmware running in QEMU | see [`firmware/esp32/qemu/`](firmware/esp32/qemu/) | (C, not measured) |

- Web logic that can run without a browser goes in `src/lib/` with no React
  or JSX imports, and screens call it. A new `src/lib` file with no tests fails
  the coverage check until it has tests, or is listed in `UNTESTED` in
  `scripts/coverage.mjs` with the reason. That list only shrinks.
- Raise a floor when tests add coverage (the web script says when it's 3+
  points over); never lower one to get a change through.
- Floors when they were set (15 Nov 2026): web 83/96/82 (lines, branches,
  functions, of the files tests load), hub 70, Pi node 79 (lines and branches).
- Not tested yet: the screens and components (JSX; checked in a browser),
  the Android and iOS apps (no test targets), `store.js`, `flash.js` and other
  React or browser-only parts of `src/lib`, the hub's mDNS and the ffmpeg
  commands its workers run, and on the ESP32 the Wi-Fi radio, the USB webcam
  and USB flashing, which need a board.
