# ESP32 firmware in the emulator

Runs the camera firmware in [Espressif's QEMU](https://github.com/espressif/qemu)
and drives it over HTTP, so the board's web interface and firmware updates are
tested without a board. The `esp32` job in `.github/workflows/build.yml` runs
this on every pull request.

## What is emulated, and what isn't

The emulator build (`sdkconfig.qemu`, `CONFIG_LOOKABOUT_EMULATOR`) changes two
things and nothing else:

| On a board | In the emulator |
|---|---|
| Wi-Fi, and the Lookabout-Setup hotspot | QEMU's emulated Ethernet (`open_eth`). "Setup mode" means no Wi-Fi saved yet; saving it restarts the board as usual |
| USB webcam (ESP32-S3 USB host) | a 160×120 test picture, 10 frames a second, each with a "frame 0000042" JPEG comment, through the same frame check as webcam frames |

It runs on QEMU's **classic ESP32** machine, whose network emulation is the
reliable one; nothing under test depends on the chip. So these tests don't
cover the Wi-Fi radio, the USB webcam, the S3 itself, or flashing over USB.
Those still need a board (issues #14–#18 and #29).

What they do cover (`test_board.py`): status, the setup page, snapshot, the
MJPEG stream, the four-viewer limit, Wi-Fi details and name saved and kept
across the restart, and updates: a file that isn't firmware or is too big is
refused, an upload cut off or a power cut halfway keeps the old firmware, and
a real update boots the new version.

## Run it

Needs ESP-IDF 5.3+ and its QEMU:

```sh
. $IDF_PATH/export.sh
python3 $IDF_PATH/tools/idf_tools.py install qemu-xtensa   # once
firmware/esp32/qemu/build.sh          # two images: emu-a (flashed) and emu-b (the update)
python3 firmware/esp32/qemu/test_board.py
```

Each board's serial log is written to `qemu/out/logs/`. Never flash the
emulator build onto a real board: it has no Wi-Fi.
