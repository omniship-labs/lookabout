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
`http://<pi-address>:8787` from the home network. A new hub shows a **setup
code** there (and prints it in `docker compose logs hub`). In Lookabout choose
Home hub, enter the hub's address and the code, and make the first admin
account (name, email, password of 10+ characters; 14+ counts as strong).

After that everyone signs in with an account:

- An admin invites people (Household) and passes on the invite link; the hub
  sends no email. The invitee opens it and chooses a password.
- Admins group cameras ("Nursery") and give members `view` or `manage` per
  group. A camera in no group is for admins only. Managers can delete events
  and clips, edit zones, rename cameras and share the group with other members
  (view only).
- A phone or app can sign in with a pairing code: an admin makes one for a
  member (`POST /api/pairing/code {member}`) and the app trades it at
  `POST /api/pair` for a session of that member.
- Sessions last 30 days (7 while remote access is on) and are listed, and can
  be ended, under Paired devices.

Hubs that were paired before accounts keep working **read-only** until the
first admin is made; making the first admin ends every old pairing key, and
each device signs in once.

- Passkeys (one per address) and, once an admin has set up their own Google or Apple
  keys under `PUT /api/admin/auth/providers`, "Continue with Google / Apple" for invited
  people. Provider secrets are encrypted with a key file in `keys/` on the volume.

Not built yet: the setup wizard endpoints and remote access (see
`docs/hub-auth.md` and epic #13). Passkeys, Google and Apple are tested against
stand-ins only.

Settings live in `docker-compose.yml`:

| Setting | Meaning |
|---|---|
| `LOOKABOUT_HUB_NAME` | Name shown in Lookabout |
| `LOOKABOUT_HUB_PORT` | Port of the hub page and API (default 8787) |
| `devices:` | USB webcams to hand to the hub, e.g. `/dev/video0:/dev/video0` |

Ports used on the host: 8787 (page and API), 8555 TCP+UDP (live video).
go2rtc's own ports (1984, 8554) listen on the machine itself only.
Everything the hub stores is in the `hub-data` volume.

## The web app

The hub serves the Lookabout web app from its own address (it sends no CORS headers, so a page
from anywhere else can't talk to it). Build it and put it next to the compose file:

```sh
npm run hub:web          # builds the web app into hub/web (needs NODE_AUTH_TOKEN, see the root README)
docker compose up -d     # ./web is mounted read-only at /app/web
```

Open `http://<pi-address>:8787`: the app is the front page and the status page moves to `/status`.
Without a `web` folder the status page stays at `/`. In development, `LOOKABOUT_HUB=http://<hub>:8787 npm run dev`
proxies `/api` to a hub so the dev page and the hub share an origin.

## Run without Docker

```sh
pip install -r requirements.txt
python3 -m lookabout_hub --data ./data --model yamnet.tflite   # needs go2rtc and ffmpeg on PATH
python3 -m unittest discover -s tests             # needs numpy; clip tests also ffmpeg (sign-in tests take ~40 s: scrypt)
```

Without go2rtc the hub still starts (pairing and the camera list work) but
can't show video, record or detect anything. Without the model file or
LiteRT it runs without cry detection and says so in its log.

## Interface

`lookabout_hub/server.py` lists every route and `docs/hub-auth.md` says who
may call each. In short: `/api/hub`, `/api/auth/providers`,
`/api/auth/login/local`, `/api/auth/join`, `/api/setup/state`,
`/api/setup/first-admin` and `/api/pair` are open; everything else needs a
session, as the `lk_session` cookie or `Authorization: Bearer <token>`.
Streams, snapshots and clips also take `?ticket=` (from
`POST /api/cameras/<id>/ticket`, five minutes, one camera) where a browser
can't set headers. A session in a URL (`?token=`) is no longer accepted. The
hub sends no CORS headers: the web app has to be served from the hub itself
(or, in development, through Vite's proxy).

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

Accounts and camera groups (G3) are tested against the HTTP interface with stand-in cameras,
one case per route of the contract's table. **The web and native apps don't use them yet**:
they still pair the old way, so against this hub they can't sign in until G3's app side and
G4 land.

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
