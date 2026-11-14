# Lookabout firmware — Raspberry Pi

A small Python service (standard library only) that serves a Pi camera
module or a USB webcam to Lookabout viewers on your network.

## Install

Copy this folder to the Pi, then:

```sh
./install.sh
```

It installs `ffmpeg` (USB webcams) and `rpicam-apps` (camera modules), sets
up a `lookabout-camera` systemd service and prints the camera's address,
e.g. `http://raspberrypi.local:8080`. Add that in Lookabout: Cameras → **+**
→ *Raspberry Pi camera*.

## Run by hand

```sh
python3 -m lookabout_rpi                       # auto-detect
python3 -m lookabout_rpi --source usb --device /dev/video0
python3 -m lookabout_rpi --width 1280 --height 720 --fps 15 --port 8080
```

Pi 3B+ or newer. Pi Zero 2 W works at 720p.

## Status

The server and frame handling are tested with a stand-in video source; not
yet run on a Pi with a real camera. Video only for now.
