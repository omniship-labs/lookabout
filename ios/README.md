# Lookabout — iOS

Native SwiftUI app, project generated with [XcodeGen](https://github.com/yonaskolb/XcodeGen)
(same setup as `murmur/ios`).

```sh
brew install xcodegen   # once
cd ios
xcodegen generate
open Lookabout.xcodeproj
```

Standard screens use stock SwiftUI (`Form`, `Picker`, `Toggle`, `TabView`,
`NavigationStack`); only what Lookabout introduces is drawn by hand
(wordmark, video tiles, sound meter, follow-sound pill, hold-to-talk).

## Layout

```
project.yml                  XcodeGen spec: target, Info.plist keys, background mode
Lookabout/
  App/LookaboutApp.swift      @main; a device is a camera or a viewer
  Theme/Theme.swift           OmniShip Labs tokens (light/dark), button styles
  Model/AppStore.swift        settings (UserDefaults), cameras, the design's sample data
  Camera/
    CameraSession.swift       AVFoundation capture + self-view
    CryDetector.swift         on-device cry detection (SoundAnalysis)
  Hub/HubAuth.swift           pure sign-in logic: PKCE, lookabout:// links, hub errors, /api/me access (no UI, no network)
  Hub/HubClient.swift         the hub's sign-in, /api/me, devices and ticket calls (bearer header only)
  Hub/HubSession.swift        Keychain token, sign-in flows, 401 → back to sign-in
  Hub/HubViews.swift          Settings → Home hub: sign in, who you are, devices, sign out
  Net/MJPEGStream.swift       ESP32 / Pi video on the home network + Bonjour discovery
  Views/                      Start, camera setup/streaming/denied, viewer tabs, add camera, settings
```

## What works

- **Camera role**: device camera, self-view, pause/stop, dim after 10 s,
  battery state, and **cry detection** with Apple's built-in on-device sound
  classifier (alert after 20 s of crying, as a local notification for now).
- **Viewer role**: Live, Cameras, Events, Alerts tabs. Cameras on your Wi-Fi
  (ESP32, Raspberry Pi) are found over Bonjour or added by address and show
  live video.
- **Firmware updates over Wi-Fi** for ESP32 cameras, from the camera's screen,
  using the image packaged by `npm run firmware:package`. iOS can't flash over
  USB (no USB serial access); do the first flash from the web page or Android.
- **Home hub sign-in** (Settings → Home hub; contract in `docs/hub-auth.md`, issue #69): pairing code
  (or `lookabout://hub?address=…&code=…` from an admin's QR), email and password, and Google or Apple
  in a browser sheet (`ASWebAuthenticationSession`, PKCE). The token is kept in the Keychain. A 401
  sends you back to sign-in; sign out and ending other devices work. Passkeys are not offered in the
  app: a passkey is tied to the hub's address and a self-hosted hub can't publish the associated-domains
  file iOS needs, so use a pairing code or Google/Apple.
- Everything else the viewer shows is the design's sample content.

## Not yet

- Hub cameras, events and video in the app (#23; `HubMe.canSee`/`canManage` and `HubClient.ticket` are ready for it), peer-to-peer streaming, push alerts to viewers.
- Motion detection and zones, lullaby, night light, clips.
- The design's fonts (Space Grotesk, IBM Plex): system fonts stand in until
  the font files are bundled.
- Signing and App Store Connect setup (team, bundle ID `dev.omniship.lookabout`).

## Status

The sources type-check against the iOS 26.5 SDK. The app has not been run:
this Mac has no iOS simulator runtime installed (Xcode > Settings >
Components).
