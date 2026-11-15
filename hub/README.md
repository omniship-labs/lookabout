# Lookabout home hub

Optional box that sits on your home network (a Raspberry Pi 4/5, home server
or NAS) and brings cameras you already own into Lookabout:

- ESP32 and Raspberry Pi camera nodes (`firmware/`),
- any RTSP camera (Reolink, Tapo, Amcrest, Eufy with NAS mode, …),
- USB webcams plugged into the hub itself.

It reads each camera with [go2rtc](https://github.com/AlexxIT/go2rtc) (MIT),
hands paired viewers a WebRTC stream, records continuously, raises events for
motion inside zones you draw and for crying, and cuts a clip for each event.
Python with numpy, LiteRT and YAMNet (Apache-2.0) for the cry classifier.

| What | How |
|---|---|
| Recording | one-minute H.264 pieces per camera, deleted after "Keep clips for" (default 14 days) and sooner if under 1 GB is free |
| Motion | 4 frames a second per camera, compared with half a second earlier, only inside the drawn zones (none drawn: whole picture). An event ends 8 s after the last motion and lasts at most 2 min. Zones and sensitivity are saved per camera |
| Crying | sound from RTSP cameras through YAMNet; 20 s of crying makes an event (short pauses for breath don't reset it). ESP32 and Pi camera nodes and USB webcams send no sound, so no cry detection there |
| Clips | 8 s before to 4 s after an event, as MP4 with a thumbnail. Starts on a keyframe, so up to one keyframe gap of the lead-in is lost |

## Install on a Raspberry Pi

Needs a 64-bit Raspberry Pi OS and Docker (`curl -fsSL https://get.docker.com | sh`).
Copy this folder to the Pi, then:

```sh
docker compose up -d --build
```

The first build takes several minutes on a Pi (it compiles go2rtc). Then open
`http://<pi-address>:8787`. That page shows what the hub is doing and makes
pairing codes.

To pair: in Lookabout open Cameras → **+** → *Home hub* (or Settings → Home
hub), enter the hub's address, press **Show a pairing code** on the hub page
and type the code. The viewer gets a key; the hub keeps only a hash of it.
Removing the viewer under Paired devices makes the key stop working.

Settings live in `docker-compose.yml`:

| Setting | Meaning |
|---|---|
| `LOOKABOUT_HUB_NAME` | Name shown in Lookabout |
| `LOOKABOUT_HUB_PORT` | Port of the hub page and API (default 8787) |
| `devices:` | USB webcams to hand to the hub, e.g. `/dev/video0:/dev/video0` |

Ports used on the host: 8787 (page and API), 8555 TCP+UDP (live video).
go2rtc's own ports (1984, 8554) listen on the machine itself only.
Everything the hub stores is in the `hub-data` volume.

## Run without Docker

```sh
pip install -r requirements.txt
python3 -m lookabout_hub --data ./data --model yamnet.tflite   # needs go2rtc and ffmpeg on PATH
python3 -m unittest discover -s tests             # needs numpy; clip tests also ffmpeg
```

Without go2rtc the hub still starts (pairing and the camera list work) but
can't show video, record or detect anything. Without the model file or
LiteRT it runs without cry detection and says so in its log.

## Interface

`lookabout_hub/server.py` lists every route. In short: `/api/hub`,
`/api/pairing/code` and `/api/pair` are open; everything else needs the
viewer's key as `Authorization: Bearer <token>` (or `?token=` where a
browser can't set headers, such as `<img>`).

## Status

Tested with two stand-in cameras and the web app in Chrome: an MJPEG board
(the Pi node fed by a test pattern with a box that walks through a zone) and
an RTSP camera with sound (a real baby-cry recording from ESC-50, 40 s on and
50 s off). Pairing, WebRTC and MJPEG video, offline detection, recording,
motion events (only inside the zone), cry events (a dog bark scores 0, the
cry 0.4–0.98), clips that play and seek in Chrome, thumbnails, save, delete,
zones and settings saved on the hub. **Not yet run on a Pi, as a Docker
container, or against a real RTSP camera, USB webcam, microphone or a real
baby.** Of the image, only the go2rtc build stage has been built. Detection
thresholds are untuned: expect to adjust sensitivity on real scenes.

Known limits:

- Plain http. Anyone on the home network can open the hub page and pair,
  and keys travel unencrypted. Keep it off the internet.
- A web app opened over https can't talk to a plain-http hub (browsers block
  it). Open the web app over http on your network for now.
- MJPEG cameras are converted to H.264 for WebRTC in software, about one
  CPU core per camera being watched on a Pi 4.
- No alerts (push) yet.
- Recording copies the camera's video; cameras that send H.265 are
  converted to H.264 (CPU heavy on a Pi). MJPEG boards are converted too.
- Motion can't tell a person from a shadow or a moving tree; cry detection
  can't tell crying from a similar sound (a cat, a toy).
- Deleting a clip deletes it for every viewer.
