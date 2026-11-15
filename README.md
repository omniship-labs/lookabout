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

## Web app

```sh
NODE_AUTH_TOKEN=$(gh auth token) npm install   # design-beacon comes from GitHub Packages
npm run dev
npm run build
npm test        # web app logic tests (node:test, no browser)
npm run coverage  # the same, failing if coverage drops below its floor
```

Every pull request is built by `.github/workflows/build.yml` (which also runs the hub's tests). A push to `main`
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
