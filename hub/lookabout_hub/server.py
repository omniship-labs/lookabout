"""The hub's HTTP interface.

Open to anyone on the network:

    GET  /                      the hub's page (status and pairing code)
    GET  /api/hub               name, version, counts
    POST /api/pairing/code      make a pairing code (the hub page only)
    POST /api/pair              {code, name} -> {token, viewer, hub}

Needs a paired viewer's key, as "Authorization: Bearer <token>" or, where a
browser can't set headers (<img>, downloads), as "?token=<token>":

    GET    /api/cameras                     cameras and whether each is reachable
    POST   /api/cameras                     add one {name, kind, address, ...}
    POST   /api/cameras/test                try one without adding it -> a JPEG frame
    PATCH  /api/cameras/<id>                rename
    DELETE /api/cameras/<id>
    GET    /api/cameras/<id>/snapshot.jpg   one frame
    GET    /api/cameras/<id>/stream.mjpeg   live video as MJPEG
    POST   /api/cameras/<id>/webrtc         live video: SDP offer in, SDP answer out
    GET    /api/usb                         webcams plugged into the hub
    GET    /api/cameras/<id>/zones          motion zones {zones, sensitivity}
    PUT    /api/cameras/<id>/zones
    GET    /api/events?since=&kind=&limit=
    DELETE /api/events/<id>                 the event and its clip
    GET    /api/clips/<name>                a clip (.mp4) or its thumbnail (.jpg)
    GET    /api/settings                    keep_days, recording, motion, cry, cry_sensitivity
    PATCH  /api/settings
    GET    /api/viewers
    PATCH  /api/viewers/<id>                rename
    DELETE /api/viewers/<id>                unpair: its key stops working
"""

import json
import os
import shutil
import socket
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, urlsplit

from . import VERSION
from .bridge import BridgeError
from .cameras import BadCamera, clean_camera, public_camera, usb_cameras
from .discovery import local_addresses
from .page import PAGE

MAX_BODY = 256 * 1024


class Hub:
    """The parts of the hub, bundled for the request handler."""

    def __init__(self, store, pairing, bridge, monitor, name, port, data_dir, clips=None):
        self.store, self.pairing, self.bridge, self.monitor = store, pairing, bridge, monitor
        self.name, self.port, self.data_dir = name, port, data_dir
        self.clips = clips            # recordings and event clips
        self.watchers = None          # recording, motion and cry workers, set once the hub is built
        self.classifier = None        # cry classifier, or None when this machine can't run it
        self.classifier_problem = "not loaded"

    def address(self):
        found = local_addresses()
        return f"http://{found[0] if found else socket.gethostname()}:{self.port}"

    def info(self):
        return {
            "id": self.store.hub_id(),
            "name": self.name,
            "version": VERSION,
            "cameras": len(self.store.cameras()),
            "viewers": len(self.store.viewers()),
            "bridge": self.bridge.available,
            "recording": bool(self.watchers) and self.store.settings()["recording"],
            "cry_detection": self.classifier is not None,
            "free_bytes": shutil.disk_usage(self.data_dir).free,
        }


class Reply(Exception):
    """Ends a request early with a status and a message for the person."""

    def __init__(self, status, message):
        super().__init__(message)
        self.status, self.message = status, message


def pairing_qr(payload):
    try:
        import segno
    except ImportError:
        return ""
    import io
    out = io.BytesIO()
    segno.make(payload, error="m").save(out, kind="svg", xmldecl=False, svgns=True, border=2, scale=4)
    return out.getvalue().decode()


def event_json(event):
    return {
        "id": event["id"],
        "kind": event["kind"],
        "camera_id": event["camera_id"],
        "camera": event["camera_name"],
        "started": event["started"],
        "ended": event["ended"],
        "detail": event["detail"],
        "clip": event["clip"],
        "thumb": f"{event['id']}.jpg" if event["clip"] else None,
    }


def clean_zones(data):
    """Checks zones sent by a viewer. Corners are fractions (0..1) of the frame."""
    zones, sensitivity = data.get("zones"), data.get("sensitivity", 60)
    if not isinstance(zones, list) or len(zones) > 12 or not isinstance(sensitivity, (int, float)):
        raise Reply(400, "Those zones can't be saved.")
    cleaned = []
    for i, zone in enumerate(zones):
        points = zone.get("points") if isinstance(zone, dict) else None
        if not isinstance(points, list) or not 3 <= len(points) <= 12:
            raise Reply(400, "A zone needs at least three corners.")
        try:
            points = [[min(max(float(x), 0.0), 1.0), min(max(float(y), 0.0), 1.0)] for x, y in points]
        except (TypeError, ValueError):
            raise Reply(400, "Those zones can't be saved.") from None
        cleaned.append({
            "id": str(zone.get("id") or f"zone-{i + 1}")[:24],
            "name": str(zone.get("name") or f"Zone {i + 1}").strip()[:24],
            "action": "record only" if zone.get("action") == "record only" else "alert + record",
            "tone": "info" if zone.get("tone") == "info" else "accent",
            "points": points,
        })
    return cleaned, int(min(max(sensitivity, 0), 100))


def make_handler(hub):
    store, bridge = hub.store, hub.bridge

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "LookaboutHub/" + VERSION

        def log_message(self, *args):  # keep the container log quiet
            pass

        # --- plumbing ---------------------------------------------------

        def _cors(self):
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-store")

        def _send(self, status, content_type, body):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self._cors()
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def _json(self, data, status=200):
            self._send(status, "application/json", json.dumps(data).encode())

        def _read_body(self):
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = -1
            if length < 0 or length > MAX_BODY:
                self.close_connection = True  # the unread body would be taken for the next request
                raise Reply(413, "That request is too large.")
            return self.rfile.read(length) if length else b""

        def _body(self):
            return self._raw

        def _data(self):
            try:
                data = json.loads(self._body() or b"{}")
            except ValueError:
                raise Reply(400, "The request wasn't valid JSON.") from None
            if not isinstance(data, dict):
                raise Reply(400, "The request wasn't valid JSON.")
            return data

        def _viewer(self):
            header = self.headers.get("Authorization") or ""
            token = header[7:].strip() if header.lower().startswith("bearer ") else ""
            if not token:
                token = (self.query.get("token") or [""])[0]
            viewer = store.viewer_for_token(token)
            if not viewer:
                raise Reply(401, "This viewer isn't paired with the hub.")
            return viewer

        def _camera(self, camera_id):
            camera = store.camera(camera_id)
            if not camera:
                raise Reply(404, "The hub has no such camera.")
            return camera

        def _handle(self):
            parts = urlsplit(self.path)
            self.query = parse_qs(parts.query)
            path = [p for p in parts.path.split("/") if p]
            try:
                self._raw = self._read_body()
                self._route(self.command, path)
            except Reply as reply:
                self._json({"error": reply.message}, reply.status)
            except BadCamera as err:
                self._json({"error": str(err)}, 400)
            except BridgeError as err:
                self._json({"error": str(err)}, 502)
            except (BrokenPipeError, ConnectionResetError, socket.timeout):
                self.close_connection = True

        do_GET = do_POST = do_PATCH = do_PUT = do_DELETE = _handle

        def do_OPTIONS(self):
            self.send_response(204)
            self._cors()
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, Range")
            # Lets a page served from elsewhere (the hosted web app) reach a hub on the home network.
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Access-Control-Max-Age", "600")
            self.send_header("Content-Length", "0")
            self.end_headers()

        # --- routes -----------------------------------------------------

        def _route(self, method, path):
            if method == "GET" and not path:
                return self._send(200, "text/html; charset=utf-8", PAGE.encode())
            if not path or path[0] != "api":
                raise Reply(404, "Not found.")
            route = (method, *path[1:])

            if route == ("GET", "hub"):
                return self._json(hub.info())
            if route == ("POST", "pairing", "code"):
                return self._pairing_code()
            if route == ("POST", "pair"):
                return self._pair()

            viewer = self._viewer()
            match route:
                case ("GET", "cameras"):
                    self._json({"cameras": [
                        {**public_camera(c), "motion": bool(store.open_event("motion", c["id"]))}
                        for c in store.cameras()]})
                case ("POST", "cameras"):
                    self._add_camera()
                case ("POST", "cameras", "test"):
                    self._send(200, "image/jpeg", bridge.test(clean_camera({"name": "Test", **self._data()})))
                case ("PATCH", "cameras", camera_id):
                    self._camera(camera_id)
                    store.rename_camera(camera_id, self._name())
                    self._json(public_camera(store.camera(camera_id)))
                case ("DELETE", "cameras", camera_id):
                    self._camera(camera_id)
                    store.remove_camera(camera_id)
                    hub.monitor.forget(camera_id)
                    bridge.remove(camera_id, store.cameras())
                    self._watch()
                    self._json({"removed": camera_id})
                case ("GET", "cameras", camera_id, "zones"):
                    self._camera(camera_id)
                    self._json(store.zones(camera_id))
                case ("PUT", "cameras", camera_id, "zones"):
                    self._camera(camera_id)
                    store.set_zones(camera_id, *clean_zones(self._data()))
                    if hub.watchers:
                        hub.watchers.refresh(camera_id)
                    self._json(store.zones(camera_id))
                case ("DELETE", "events", event_id):
                    event = store.event(int(event_id)) if event_id.isdigit() else None
                    if not event:
                        raise Reply(404, "The hub has no such event.")
                    if hub.clips:
                        hub.clips.remove(event)
                    store.remove_event(event["id"])
                    self._json({"removed": event["id"]})
                case ("GET", "clips", name):
                    self._file(hub.clips.path(name) if hub.clips else None)
                case ("GET", "settings"):
                    self._json(store.settings())
                case ("PATCH", "settings"):
                    settings = store.update_settings(self._data())
                    if settings is None:
                        raise Reply(400, "That setting can't be saved.")
                    if hub.watchers:
                        hub.watchers.refresh()
                    self._json(settings)
                case ("GET", "cameras", camera_id, "snapshot.jpg"):
                    self._camera(camera_id)
                    self._send(200, "image/jpeg", bridge.frame(camera_id))
                case ("GET", "cameras", camera_id, "stream.mjpeg"):
                    self._camera(camera_id)
                    self._mjpeg(camera_id)
                case ("POST", "cameras", camera_id, "webrtc"):
                    self._camera(camera_id)
                    self._send(201, "application/sdp", bridge.webrtc(camera_id, self._body()))
                case ("GET", "usb"):
                    taken = {c["address"] for c in store.cameras() if c["kind"] == "usb"}
                    self._json({"cameras": [{**c, "added": c["address"] in taken} for c in usb_cameras()]})
                case ("GET", "events"):
                    self._events()
                case ("GET", "viewers"):
                    self._json({"viewers": [{**v, "you": v["id"] == viewer["id"]} for v in store.viewers()]})
                case ("PATCH", "viewers", viewer_id):
                    if not store.rename_viewer(viewer_id, self._name()):
                        raise Reply(404, "The hub has no such viewer.")
                    self._json({"renamed": viewer_id})
                case ("DELETE", "viewers", viewer_id):
                    if not store.remove_viewer(viewer_id):
                        raise Reply(404, "The hub has no such viewer.")
                    self._json({"removed": viewer_id})
                case _:
                    raise Reply(404, "Not found.")

        def _watch(self):
            if hub.watchers:
                hub.watchers.sync()

        def _file(self, path):
            """Sends a clip or thumbnail, honouring Range so video can be scrubbed."""
            if not path:
                raise Reply(404, "The hub no longer has that clip.")
            size = os.path.getsize(path)
            first, last = 0, size - 1
            ranged = (self.headers.get("Range") or "").strip()
            if ranged.startswith("bytes=") and "," not in ranged:
                low, _, high = ranged[6:].partition("-")
                try:
                    if low:
                        first, last = int(low), min(int(high), last) if high else last
                    else:
                        first = max(0, size - int(high))
                except ValueError:
                    first, last = 0, size - 1
                if first > last or first >= size:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{size}")
                    self.send_header("Content-Length", "0")
                    self._cors()
                    self.end_headers()
                    return
                self.send_response(206)
                self.send_header("Content-Range", f"bytes {first}-{last}/{size}")
            else:
                self.send_response(200)
            self.send_header("Content-Type", "video/mp4" if path.endswith(".mp4") else "image/jpeg")
            self.send_header("Content-Length", str(last - first + 1))
            self.send_header("Accept-Ranges", "bytes")
            self._cors()
            self.end_headers()
            with open(path, "rb") as f:
                f.seek(first)
                left = last - first + 1
                while left > 0:
                    chunk = f.read(min(65536, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)

        def _name(self):
            name = str(self._data().get("name") or "").strip()[:40]
            if not name:
                raise Reply(400, "Enter a name.")
            return name

        def _pairing_code(self):
            # Only the hub's own page may ask: a code another website could
            # fetch for itself would prove nothing.
            origin = self.headers.get("Origin")
            if origin and urlsplit(origin).netloc != self.headers.get("Host"):
                raise Reply(403, "Open the hub's own page to see a pairing code.")
            self._body()
            code, seconds = hub.pairing.new_code()
            address = hub.address()
            payload = f"lookabout://hub?address={quote(address, safe='')}&code={code}"
            self._json({"code": code, "expires_in": seconds, "address": address, "qr": pairing_qr(payload)})

        def _pair(self):
            data = self._data()
            if not hub.pairing.redeem(data.get("code", "")):
                raise Reply(403, "That code is wrong or has run out. Show a new one on the hub page.")
            name = str(data.get("name") or "").strip()[:40] or "Viewer"
            viewer, token = store.add_viewer(name, str(data.get("platform") or "")[:20])
            self._json({"token": token, "viewer": viewer,
                        "hub": {"id": store.hub_id(), "name": hub.name, "version": VERSION}})

        def _add_camera(self):
            fields = clean_camera(self._data())
            if any(c["kind"] == fields["kind"] and c["address"] == fields["address"] for c in store.cameras()):
                raise Reply(409, "The hub already has this camera.")
            camera = store.add_camera(fields)
            try:
                bridge.add(camera, store.cameras())
            except BridgeError:
                if bridge.available:  # without go2rtc the camera is still listed, just without video
                    store.remove_camera(camera["id"])
                    raise
            self._watch()
            self._json(public_camera(camera), 201)

        def _events(self):
            def number(key, default):
                try:
                    return float((self.query.get(key) or [default])[0])
                except ValueError:
                    raise Reply(400, f"{key} should be a number.") from None
            kind = (self.query.get("kind") or [None])[0]
            limit = int(min(max(number("limit", 200), 1), 1000))
            events = store.events(since=number("since", 0), kind=kind, limit=limit)
            self._json({"events": [event_json(e) for e in events], "now": time.time()})

        def _mjpeg(self, camera_id):
            with bridge.mjpeg(camera_id) as upstream:
                self.send_response(200)
                self.send_header("Content-Type", upstream.headers.get("Content-Type", "multipart/x-mixed-replace"))
                self._cors()
                self.send_header("Connection", "close")
                self.end_headers()
                self.close_connection = True
                while True:
                    chunk = upstream.read1(65536)
                    if not chunk:
                        break
                    self.wfile.write(chunk)

    return Handler


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def make_server(hub, host="0.0.0.0"):
    return Server((host, hub.port), make_handler(hub))
