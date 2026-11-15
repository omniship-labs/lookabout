# Lookabout — handover

> **Deprecated (15 Nov 2026).** Tasks are now tracked as GitHub issues: see the epics [#7](https://github.com/omniship-labs/lookabout/issues/7) (A), [#8](https://github.com/omniship-labs/lookabout/issues/8) (B), [#9](https://github.com/omniship-labs/lookabout/issues/9) (C), [#10](https://github.com/omniship-labs/lookabout/issues/10) (D), [#11](https://github.com/omniship-labs/lookabout/issues/11) (E), [#12](https://github.com/omniship-labs/lookabout/issues/12) (F) and [#13](https://github.com/omniship-labs/lookabout/issues/13) (G). The task list and "What to pick up next" below are no longer updated; the issue links beside each task are the source of truth. The rest (state, decisions, how to run, gotchas) is a snapshot as of 14 Nov 2026.

Written 13 Nov 2026, updated 14 Nov 2026 (home hub built: section B; accounts plan added: section G). Read the root `README.md` first for layout and commands;
each of `firmware/esp32`, `firmware/rpi`, `ios`, `android` has its own README.

## Where things stand

| Piece | Folder | State |
|---|---|---|
| Web app | `src/` | Builds. Main screens checked in a browser (light and dark, phone/tablet/desktop). |
| ESP32-S3 + USB webcam firmware | `firmware/esp32/` | Compiles. **Never run on a board.** |
| Raspberry Pi camera node | `firmware/rpi/` | Server tested with a stand-in video source. **Never run on a Pi.** |
| Android app | `android/` | Builds. Start, viewer tabs and live video from a test stream checked on an emulator. |
| iOS app | `ios/` | Sources type-check. **Never built or run** (no iOS simulator runtime on this Mac). |
| Home hub | `hub/` | Pairing, camera bridge, recording, motion and cry detection, clips and the viewer API work against stand-in cameras with the web viewer. **Never run on a Pi or as a container.** No alerts yet. |

What is real: the camera role on each platform (device camera, dim, pause),
themes, settings, cameras added by address (ESP32 / Pi stream shows in the
web and Android viewers), firmware packaging, Wi-Fi firmware update from the
web page (tested against a stand-in board), and on web the home hub: pairing,
hub cameras (WebRTC live view, snapshot), events with clips (offline, motion, crying), motion zones, paired viewers.

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
- **Accounts and access (decided 14 Nov 2026, plan only, nothing built):** the
  public Pages site has no accounts and no video. It explains the project,
  flashes boards and guides hub setup. Sign-in, households, roles and
  per-camera access live in the **hub**, which serves the same React app as the
  owner's own dashboard at their own URL. A client-only login on Pages can't
  gate anything (the site has no backend; board streams are plain http). See
  section G.

## Task list

Ordered by what unblocks the most. Each task says what "done" means.

### A. Prove the ESP32 path on hardware (blocks everything camera-side) (epic #7)

- [ ] **A1 (#14). Flash the board from the web page.** `npm run dev`, open
      `#/flash` in Chrome, Flash over USB. Done: board boots, opens the
      "Lookabout-Setup" Wi-Fi.
- [ ] **A2 (#15). Wi-Fi setup.** Enter Wi-Fi details at `http://192.168.4.1`. Done:
      serial log prints the camera address.
- [ ] **A3 (#16). Webcam streaming.** Plug in the webcam (powered hub likely
      needed). Done: `http://<address>/stream` shows video. Expect to tune
      the format list in `camera.c` (`k_formats`); the S3's USB is full-speed
      so only small MJPEG modes work, and some webcams won't.
- [ ] **A4 (#17). Add it in the viewer** (web, then Android, then iOS). Done: live
      video in the Cameras grid.
- [ ] **A5 (#18). Wi-Fi firmware update against the real board** from web, Android
      and iOS. Done: version changes after restart; pulling power mid-update
      leaves the old firmware running.
- [ ] **A6 (#29). Android USB flashing.** `android/.../net/Firmware.kt` implements
      the ESP32 bootloader protocol from documentation and is the least
      certain code in the repo. Done: a blank board flashed from a phone.
- [ ] **A7 (#19). mDNS discovery.** Confirm the apps list the board under "Found
      on your network" (`_lookabout._tcp`). Older Android versions may not
      resolve `.local` names; fall back to the IP from discovery if so.

### B. Home hub in Docker on the Pi (the owner's next priority) (epic #8)

B1–B7 are built in `hub/` (see its README for the routes and how to run
it) and wired into the web app. Everything was tested against a stand-in
MJPEG camera on one machine; nothing has met a Pi, a container runtime, a
real RTSP camera or a USB webcam yet.

- [ ] **B1 (#20). Hub service skeleton.** `hub/`: Python service, `Dockerfile`
      (builds go2rtc from source), `docker-compose.yml` with host networking
      and a `hub-data` volume. Serves a status page on port 8787 and
      announces `_lookabout-hub._tcp`. **Left:** `docker compose up -d
      --build` on the Pi. The full image has never been built (the session
      that wrote it could not reach Debian's package mirror; the go2rtc
      stage built). Check the mDNS announcement from another device.
- [x] **B2 (#58). Camera bridge.** The hub runs go2rtc and registers ESP32 / Pi
      (MJPEG), RTSP and USB cameras with it; viewers get WebRTC, with MJPEG
      as the fallback and for small tiles of MJPEG cameras. Seen working: a
      stand-in board added through the hub plays in the web viewer.
      **Left:** try a real RTSP camera (sound included: the Opus path is
      untested) and a USB webcam (the hub asks for MJPEG at 1280×720, which
      not every webcam has; see `stream_url` in `hub/lookabout_hub/cameras.py`).
- [x] **B3 (#59). Hub pairing.** The hub page makes a one-time code (5 minutes,
      with a QR of `lookabout://hub?address=…&code=…` for the native apps
      to scan later); the web viewer sends it and gets a key. The hub keeps
      a hash, the viewer keeps the key in its settings. Removing a viewer
      under Paired devices deletes the key on the hub, and that viewer
      drops back to unpaired on its next request. `#/add/hub` is the real
      flow (`HubSetup` in `src/screens/Add.jsx`); the link form
      `#/add/hub?address=…&code=…` prefills it.
- [x] **B4 (#60). Hub API for viewers.** Cameras, status, events, viewers, all
      behind the pairing key (`src/lib/hub.js`, `src/lib/store.js`). With a
      hub paired the web Cameras, live, Events and Paired devices screens
      show the hub's data and no sample cameras.
- [x] **B5 (#61). Recording and clips.** Continuous recording per camera in
      one-minute pieces, retention by "Keep clips for" (setting synced from
      the web Settings screen) and by free disk, a clip with a thumbnail cut
      for each event, played / saved / deleted from the web clip screen.
      Seen working with stand-in cameras. **Left:** watch disk use and CPU on
      a Pi with real cameras; Share needs a browser that can share files.
- [x] **B6 (#62). Motion detection on the hub.** Frame differencing inside the
      zones saved from the web Zones screen (per camera, with a still from
      the camera under them, and a sensitivity). A walking box in the "Door"
      zone made events with clips; an empty zone stayed quiet. **Left:** tune
      on real scenes (wind, shadows, lights, night mode), and the Zones
      "action" (alert + record vs record only) is stored but not used until
      alerts (B8) exist.
- [x] **B7 (#63). Cry detection on the hub.** YAMNet through LiteRT on cameras
      that send sound (RTSP); 20 seconds of crying make an event. A real cry
      recording through an RTSP stand-in raised events and a dog bark did
      not. ESP32 boards and USB webcams have no sound, so this needs an RTSP
      camera or a Pi with a mic (a Pi mic isn't wired into the hub yet).
      **Left:** real cameras and real crying; the "fan and white noise"
      claim on the Settings screen is not tested.
- [ ] **B8 (#22). Alerts.** Push to paired viewers (APNs / FCM) for cry, motion,
      camera offline. Needs developer accounts (see D).
- [x] **B9 (#64). Hub language: Python** (owner's decision, 14 Nov 2026).
- [ ] **B10 (#23). Hub in the Android and iOS apps.** Pairing (scan the hub
      page's QR), hub cameras over WebRTC, events. Web only so far.
- [ ] **B11 (#24). Sound from hub cameras in the viewer.** Hub video plays muted;
      there is no listen control for a hub camera yet.

### C. Phone-to-phone (no hub) path (epic #9)

- [ ] **C1 (#25). Signalling service** for WebRTC offers/answers (tiny, stateless).
- [ ] **C2 (#26). Real pairing**: QR + word code on the camera, scan/type on the
      viewer, keys stored on device. Screens exist on web
      (`src/screens/Pairing.jsx`, `Camera.jsx`); the QR is a placeholder.
- [ ] **C3 (#27). WebRTC streaming** camera → viewer on web, iOS, Android,
      including hold-to-talk audio back.
- [ ] **C4 (#28). Background operation**: iOS background audio session, Android
      foreground service, so a camera keeps streaming with the screen off.

### D. Native apps to store quality (epic #10)

- [ ] **D1 (#30). Run the iOS app.** Install an iOS simulator runtime (Xcode →
      Settings → Components), `cd ios && xcodegen generate`, build, fix
      whatever only shows at runtime. Check cry detection on a real iPhone.
- [ ] **D2 (#31). Screen parity with web**: zones, clip player, paired devices,
      pairing, lullaby state, offline/reconnecting states. Brand flows
      (Nest, Ring, Wyze, Tesla) can wait for the hub.
- [ ] **D3 (#32). Fonts**: bundle Space Grotesk, IBM Plex Sans, IBM Plex Mono (all
      OFL) in both apps; system fonts stand in today.
- [ ] **D4 (#33). Android**: check in a Gradle wrapper; add a foreground service;
      test on a phone; light-mode pass.
- [ ] **D5 (#34). Store setup**: Apple developer team + signing, App Store Connect
      record, Play Console record, release keystore, privacy answers,
      screenshots. Bundle/app ID is `dev.omniship.lookabout`. Trademark
      check on the name is still open (from the design spec).
- [ ] **D6 (#35). Review notes**: justify iOS background audio (Guideline 2.5.4)
      and file export compliance once encryption ships.

### E. Web app loose ends (epic #11)

- [ ] **E1 (#36). Unwired buttons**: "Sign in with Google", Status page, Try again / Connection help.
      Snapshot is wired for cameras added by address and for hub cameras
      (`src/lib/snapshot.js`).
- [ ] **E2 (#37). Hub-dependent add flows.** USB on hub, RTSP and Eufy now add
      real cameras to the hub, and ESP32 / Pi cameras go through the hub
      when one is paired. Nest, Ring, Wyze and Tesla are still sample
      screens (greyed out as "Not in the hub yet" once a hub is paired);
      each needs its own integration in the hub.
- [ ] **E3 (#38). Deploy**: `.github/workflows/deploy.yml` builds on a push to
      `main` and publishes `dist` to GitHub Pages; the build uses a relative
      base so it works under `/lookabout/`. It was written here, not copied
      from `murmur` (that repo wasn't readable from the session), so compare
      the two. Its first run is the merge of pull request 2; it can only
      publish once Pages is switched on (Settings → Pages → Source: GitHub
      Actions), then re-run it from the Actions tab. `npm ci` already works
      in Actions (see E6). Done: a push to `main` publishes the web app.
- [ ] **E4 (#39). https vs plain-http boards**: a deployed https page can't show
      `http://` board streams or send them updates. Goes away once streams
      come through the hub; until then document "open over http on your LAN".
      The hub itself is plain http too, so the same applies to pairing with
      it: the hub needs https (or the hub serving the web app) to fix this.
- [ ] **E5 (#40). Design-system gaps**: Switch, Badge, Card, Input are local in
      `src/components/ui.jsx` because design-beacon 0.1.0 doesn't export
      them. Promote upstream or keep local.
- [x] **E6 (#65). Build check on pull requests.** `.github/workflows/build.yml`
      runs `npm ci` and `npm run build` on every PR (check name `web`). It
      went green on pull request 2, so Actions can read the design-beacon
      package. Not seen red on a broken build yet. Optional follow-up: make
      `web` a required check on `main` (Settings → Branches).
- [ ] **E7 (#41). `npm ci` in Claude cloud sessions.** It fails with 401 because
      the environment has no `NODE_AUTH_TOKEN`. Add one (a GitHub token with
      `read:packages`) in the environment's settings. Until then, clone the
      public `omniship-labs/design-beacon` repo and `npm install --no-save`
      from that folder; the package is plain source with no build step.
- [ ] **E8 (#42). Snapshot on a real board.** Tested only against a stand-in
      camera. After A3, press Snapshot while the stream is playing. Done: a
      JPEG of the current frame downloads from an ESP32 and from a Pi.
- [x] **E9 (#66). Snapshot for hub cameras.** The frame comes from the hub
      (`/api/cameras/<id>/snapshot.jpg`). Seen working with the stand-in
      camera.

### G. Accounts, hub install and remote access (planned, not started) (epic #13)

Goal: "I don't want everyone to see everything." Decisions so far:

- Household with roles: members are **admin** or **viewer**; each camera has
  an access list; admins see all. Invite by email, active on first matching
  sign-in.
- Sign-in methods: **local accounts** (passkey or password) as the default so a
  LAN-only hub works, plus **Google and Apple** as optional providers where each
  owner brings their own keys through a guided wizard. No shared OmniShip login
  service (it would break "nothing is uploaded").
- Remote access is **opt-in, off by default**. Offer **Cloudflare Tunnel** and
  **Tailscale** equally (wizard asks "sharing with family or just me?").
  Remote video falls back to https (MSE/HLS) in v1; **TURN is later**. Port
  forwarding is docs only.
- Hub install in v1: **Docker compose generator plus an `install.sh`**; an SD
  card image is later. Apple sign-in is **in v1** alongside Google.
- Hub runtime (B9) is **Python** (decided 14 Nov 2026, built in `hub/`); keep
  the API contract language-neutral.
- Hub-to-internet checks in wizards are allowed, but each check names the host
  it contacts and sends only what it needs, shown before it runs.

Tasks, in build order:

- [ ] **G1 (#48). Contract doc** `docs/hub-auth.md`: `POST /auth/login/{provider}`,
      `GET /me`, `GET /household`, `POST /household/invites`,
      `PATCH /household/members/{id}`, `GET/PUT /admin/auth/providers`,
      `GET /cameras` (filtered by caller), stream/snapshot/clip authorisation,
      and the wizard verify endpoints
      (`POST /setup/{flow}/{step}/verify`). Done: reviewed by the owner.
- [ ] **G2 (#49). Wizard component** (web): a shared step UI. Each step has a guide
      (numbered substeps, copy buttons, deep links), the thing to do, an
      automated check or manual confirm, a state (`todo`, `checking`,
      `passed`, `failed`), a plain-language failure reason with Retry, and
      progress saved on the hub. Later steps stay locked until the previous
      one passes. Done: used by the hub-setup flow.
- [ ] **G3 (#50). Hub-mode sign-in and gating** (web): sign-in screen showing only
      the providers the owner enabled; route guard (viewer routes need a
      session; Zones, Devices, Add camera and Household need admin); one
      `useVisibleCameras()` hook replacing direct reads of `s.cameras` in
      `Cameras.jsx`, `Live.jsx` (`houseCam`, the `/live` nursery room, tablet
      list) and `viewer.jsx` (online count); events and clips filtered by
      visible cameras; a "No access" state for a direct `/live/<id>` link to a
      camera the user can't see. Until the hub exists, a clearly labelled
      **preview** provider signs in as sample members. It is **not** security.
      Done: signing in as a viewer shows only their cameras, in light and
      dark, at phone and desktop widths.
- [ ] **G4 (#51). Account and Household screens** (web): Settings gets an Account
      section (signed in as, role, Household, Sign out). Household lists
      members with role pills; admins open a member to change role, tick
      cameras, or remove; an Invite field adds a pending member. Replace the
      "Second phone" viewers sample in `Devices` once the hub is real.
- [ ] **G5 (#52). Pages landing flow** (web): when not served by a hub, `Start`
      becomes two cards, "Flash a camera" (existing `#/flash`) and "Set up
      your hub". The hub card is the install wizard (G6) and an "Open my hub"
      field that remembers the hub URL. Document E4: live viewing happens on
      the hub's own address.
- [ ] **G6 (#53). Hub install wizard and installer.** Pages generates a
      `docker-compose.yml` and a one-line command from a few answers (Pi
      model, recordings location, remote access yes/no). `install.sh` (kept in
      the repo, pinned to a release URL, short and readable) checks arm64,
      disk and Docker, installs Docker if missing, creates the data folder,
      starts the hub and prints its address. Needs the hub image (B1) on GHCR
      and a hub status endpoint (version, free disk, mDNS advertised, volume
      writable). An https Pages site can't call `http://lookabout.local`
      (mixed content), so step verification runs on the hub's own first-run
      page, with a manual confirm on Pages. Hub first run shows a one-time
      setup code; entering it creates the first admin. Done: a fresh Pi goes
      from nothing to a signed-in admin using only the wizard.
- [ ] **G7 (#54). Remote access wizard** (hub dashboard): Cloudflare Tunnel
      (`cloudflared` sidecar) and Tailscale paths. Checks: domain on
      Cloudflare, tunnel connected, public URL serves a valid certificate, hub
      reaches itself from outside, and an unauthenticated request to the public
      camera API gets 401 and no video. Refuses to enable until an admin with a
      strong credential exists and per-camera auth is enforced on every stream
      path. While on, the dashboard shows an "exposed to internet" banner.
      Needs rate limiting and lockout, secure cookies, CSRF and origin checks,
      and a sign-in audit log. Video falls back to https (MSE/HLS).
- [ ] **G8 (#55). Google sign-in wizard.** Blocker if there's no public https URL
      (Google rejects `.local` and private IPs as redirect URIs). Steps: show
      the redirect URL with copy, link to the Google Cloud console, paste
      client ID and secret, format check, fetch Google's discovery document,
      "Test sign-in" shows the verified email returned. Secrets are encrypted
      on the hub volume and never sent back to the browser.
- [ ] **G9 (#56). Apple sign-in wizard.** Needs a paid Apple Developer account per
      owner, a Services ID, Team ID, Key ID and a `.p8` key, on a real https
      domain. The hub signs the client secret itself and regenerates it before
      it expires (Apple allows at most 6 months). Checks: values parse, Apple's
      token endpoint accepts the secret, test sign-in shows the identity,
      expiry is shown. Mark "advanced" in the UI. Also: App Store guideline 4.8
      requires Sign in with Apple (or an equivalent) in the iOS app if Google
      sign-in is offered; fold into D5/D6.
- [ ] **G10 (#57). Setup health panel** on the hub dashboard: every wizard flow with
      a green or red state, re-run checks on demand, so an expired key or a
      dropped tunnel shows which step failed.

Dependencies: G1 to G5 can be built and checked without the hub. G6 needs B1;
G7 to G10 need the hub and G1. Building anything in the web app needs
`npm install` to work in the session (see E7).

### F. Security (before anyone outside the house uses it) (epic #12)

- [ ] **F1 (#43).** Board streams and `POST /api/update` have **no sign-in**:
      anyone on the LAN can watch or push firmware. Close with pairing keys.
      This is now also a **hard blocker for G7**: remote access must not be
      switchable on until the hub authorises every stream and API path per
      camera. Boards stay LAN-only; only the hub is ever exposed, and it
      proxies them.
- [ ] **F2 (#44).** The "Lookabout-Setup" Wi-Fi is open and the Wi-Fi password is
      sent over plain http to the board. Acceptable for setup on a bench;
      revisit.
- [ ] **F3 (#45).** Android allows cleartext traffic app-wide for LAN boards;
      narrow it once streams go through the hub.
- [ ] **F4 (#46).** Signed firmware images / rollback protection for updates.
- [ ] **F5 (#47).** The hub is plain http: anyone on the LAN can open its page
      and pair a viewer, and keys and video requests travel unencrypted
      (the key is in the address of MJPEG streams). Camera passwords sit
      unencrypted in the hub's data volume. Needs https on the hub and a
      way to approve pairing.

## What to pick up next

In order:

1. Run the hub on the Pi (B1) and point it at real cameras (B2).
2. Alerts (B8), then tune detection on real cameras.
3. Switch GitHub Pages on, then re-run the Deploy workflow (finishes E3).
4. Flash a real ESP32-S3 (A1–A7), then Snapshot on a real board (E8).
5. Add `NODE_AUTH_TOKEN` to the Claude cloud environment (E7).
6. Accounts and camera gating (section G). Start with G1 (contract doc) and G2
   (wizard component). The hub's present pairing keys (B3) are what G replaces
   with accounts.

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
