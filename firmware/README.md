# Lookabout firmware

Small boards that act as always-on cameras. Both serve the same interface on
your home network, so the apps add them the same way:

| Path | What |
|---|---|
| `GET /stream` | live video (multipart MJPEG) |
| `GET /snapshot.jpg` | one frame |
| `GET /api/status` | JSON: name, camera present, size, viewers |

Both also advertise `_lookabout._tcp` over mDNS so the apps can find them.

| Target | Hardware | Port | Sound |
|---|---|---|---|
| [`esp32/`](esp32/) | ESP32-S3 + USB webcam | 80 | no |
| [`rpi/`](rpi/) | Raspberry Pi + camera module or USB webcam | 8080 | not yet |

The stream is unencrypted and has no sign-in: keep these boards on a network
you trust. End-to-end encryption arrives with pairing and the home hub.
