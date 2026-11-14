# Lookabout firmware — ESP32-S3 + USB webcam

The S3 is a USB host: it reads a standard (UVC) webcam as MJPEG and serves it
over Wi-Fi.

## Hardware

- An **ESP32-S3** board with its native USB port broken out (DevKitC-1 and
  similar). Classic ESP32, C3 and C6 have no USB host and won't work.
- A USB webcam that offers **MJPEG at 640×480 or smaller**. The S3's USB port
  is full-speed (12 Mbit/s), so HD-only webcams won't stream.
- **Power for the webcam.** Most dev boards don't put 5 V on the USB port in
  host mode. Use a powered USB hub, or an OTG adapter with power injection.
- Plug the webcam into the port marked **USB** and your computer into the
  port marked **UART** (that's where logs come out).

## Flash without a toolchain

- **From the web page**: open Lookabout in Chrome or Edge on a computer, go to
  Settings → Camera firmware, and press *Flash over USB*.
- **From an Android phone**: plug the board into the phone, then in the app
  go to Cameras → **+** → *Flash over USB*.
- **Updates** after that go over Wi-Fi from the web page or either app
  (`POST /api/update`). iPhones can update over Wi-Fi but can't do the first
  flash: iOS has no USB serial access.

The board needs 4 MB of flash or more (two app slots, so a failed update
leaves the old firmware in place). Updates have no sign-in: anyone on your
network can send one, the same trust level as the stream.

## Build and flash

```sh
pio run -e esp32-s3-uvc -t upload      # boards without PSRAM (N8, N16)
pio run -e esp32-s3-uvc-psram -t upload  # boards with 8 MB PSRAM (N8R8, N16R8)
pio device monitor
```

## Set up

1. On first boot the board opens a Wi-Fi network called **Lookabout-Setup**.
   Join it and open `http://192.168.4.1`.
2. Enter your home Wi-Fi name and password. The board restarts and joins it.
3. The log prints its address (`http://lookabout-cam.local` or an IP).
4. In Lookabout: Cameras → **+** → *ESP32 camera*, enter that address.

If it can't join your Wi-Fi after a few tries, the setup network comes back.

## Status

Compiles; not yet run on hardware. Video only (no microphone), up to 4
viewers at once. The Wi-Fi update client in the web page is tested against
a stand-in board; the board side of it, and USB flashing, are untested.
