# Working on Lookabout

For people and coding agents working in this repo. Read the root `README.md`
for the layout and commands; each of `firmware/esp32`, `firmware/rpi`, `hub`,
`ios` and `android` has its own README.

## Where the work is tracked

GitHub issues, grouped under the epics #7 (A, ESP32 on hardware), #8 (B, home
hub), #9 (C, phone to phone), #10 (D, native apps), #11 (E, web loose ends),
#12 (F, security) and #13 (G, accounts and remote access). When a pull request
moves a task along, say so on its issue: what's done, what's left, and what
was only tested in an emulator or with stand-ins. (This replaces the old
HANDOVER.md, removed on 15 Nov 2026.)

## Tests are required

Every change comes with tests, and the PR check (`.github/workflows/build.yml`)
must stay green. Don't skip, disable or loosen a test to get a change through.

| Part | Put tests in | Run |
|---|---|---|
| Web app logic | `tests/*.test.mjs` (`node:test`) | `npm test`; `npm run coverage` for the floor |
| Home hub | `hub/tests/` | `cd hub && python3 -m coverage run -m unittest discover -s tests && python3 -m coverage report` |
| Pi camera node | `firmware/rpi/tests/` | `cd firmware/rpi && python3 -m coverage run -m unittest discover -s tests && python3 -m coverage report` |
| ESP32 firmware | `firmware/esp32/qemu/test_board.py` (the firmware running in QEMU) | see `firmware/esp32/qemu/README.md` |

- **Web:** logic that can run without a browser goes in `src/lib/` with no
  React or JSX imports, and screens call it. That way it runs in plain Node,
  even where `npm install` doesn't work. A new `src/lib` file with no tests
  fails the coverage check until it has tests, or is added to `UNTESTED` in
  `scripts/coverage.mjs` with a reason. That list only shrinks.
- **ESP32:** keep hardware-only code (Wi-Fi radio, USB host) behind
  `CONFIG_LOOKABOUT_EMULATOR` with the shared logic outside it, so the
  emulator runs the real code path. Never flash the emulator build on a board.
- **Coverage floors only go up.** Raise a floor when tests add coverage (the
  web script says when it's 3+ points over); never lower one to get a change
  through. Floors live in `scripts/coverage.mjs`, `hub/.coveragerc` and
  `firmware/rpi/.coveragerc`.
- **Things a test can't reach** (screens in a browser, a real board, a Pi, a
  phone) are checked by hand. Until someone has, say plainly in the PR and on
  the issue that it hasn't been seen working.
- Not tested yet, and why: the screens and components (JSX; checked in a
  browser), the Android and iOS apps (no test targets), `store.js`, `flash.js`
  and other React or browser-only parts of `src/lib`, the hub's mDNS and the
  ffmpeg commands its workers run, and on the ESP32 the Wi-Fi radio, the USB
  webcam and USB flashing, which need a board.

## Decisions already made (don't reopen without the owner)

- Native apps for the stores: SwiftUI (`ios/`, XcodeGen) and Kotlin/Compose
  (`android/`). No Capacitor / React Native.
- First real camera: **ESP32-S3 with a USB webcam** (not an ESP32-CAM board).
- Every screen follows light/dark (System / Light / Dark). Only video tiles
  stay dark inside.
- Cry and motion detection run **on the hub**; on-device detection only for a
  phone used as a camera with no hub.
- The hub is **Python** with go2rtc for video, run as a **Docker container on
  the owner's Raspberry Pi**.
- Web UI uses `@omniship-labs/design-beacon` tokens, never raw hex. Sibling
  repos (`../murmur`, `../envdock`, `../home`) are the convention reference.
- **Accounts and access live in the hub**, not on the public Pages site,
  which has no accounts and no video. The contract, with the owner's answers
  (camera groups with view/manage, sessions, passkeys, no CORS), is
  `docs/hub-auth.md`.

## Things that will trip you up

- `npm install` needs `NODE_AUTH_TOKEN` (a GitHub token with `read:packages`)
  for the org's GitHub Packages registry (issue #41). The tests in `tests/`
  need no install.
- After changing the ESP32 firmware, run `npm run firmware:package`: it copies
  the build into `public/firmware/`, the iOS resources and the Android assets.
  Skip it and the apps flash the old build.
- The firmware keeps its app in `src/` (PlatformIO's layout). Plain ESP-IDF
  needs `-DEXTRA_COMPONENT_DIRS=$PWD/src`, as CI and `qemu/build.sh` pass.
- The board needs 4 MB of flash or more (two app slots for updates).
- `android/local.properties` points at a local SDK path; it's ignored by git
  and must be recreated on each machine.
- Design states that need live data can be forced on web with `?state=`
  (`offline`, `ring`, `reconnecting`, `empty`, `battery`).
- The design source is the canvas at
  https://claude.ai/code/artifact/a9e8f3d8-d216-4d03-a0f0-ceb8ae436083
  (its "Handoff spec" page lists states, edge cases and open issues).
