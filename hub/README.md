# Lookabout home hub

Optional box that sits on your home network (a Raspberry Pi 4/5, home server
or NAS) and brings cameras you already own into Lookabout:

- ESP32 and Raspberry Pi camera nodes (`firmware/`),
- any RTSP camera (Reolink, Tapo, Amcrest, Eufy with NAS mode, …),
- USB webcams plugged into the hub itself.

It reads each camera with [go2rtc](https://github.com/AlexxIT/go2rtc) (MIT),
hands paired viewers a WebRTC stream, and records when a camera drops off
the network. Python, standard library plus two small packages.

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
python3 -m lookabout_hub --data ./data            # needs go2rtc and ffmpeg on PATH
python3 -m unittest discover -s tests             # tests need neither
```

Without go2rtc the hub still starts (pairing, camera list and events work)
but can't show video.

## Interface

`lookabout_hub/server.py` lists every route. In short: `/api/hub`,
`/api/pairing/code` and `/api/pair` are open; everything else needs the
viewer's key as `Authorization: Bearer <token>` (or `?token=` where a
browser can't set headers, such as `<img>`).

## Status

Tested with a stand-in MJPEG camera (the Pi node fed by a test pattern) and
the web app in Chrome: pairing, adding the camera, snapshot, MJPEG and
WebRTC video, offline detection, unpairing. **Not yet run on a Pi, as a
Docker container, or against a real RTSP camera or USB webcam.** Of the
image, only the go2rtc build stage has been built.

Known limits:

- Plain http. Anyone on the home network can open the hub page and pair,
  and keys travel unencrypted. Keep it off the internet.
- A web app opened over https can't talk to a plain-http hub (browsers block
  it). Open the web app over http on your network for now.
- MJPEG cameras are converted to H.264 for WebRTC in software, about one
  CPU core per camera being watched on a Pi 4.
- No recording, motion or cry detection, or alerts yet.
