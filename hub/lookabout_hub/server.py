"""The hub's HTTP interface. docs/hub-auth.md is the contract for who may call what.

Open to anyone who can reach the hub:

    GET  /                          the hub's page (status; the setup code on first run)
    GET  /api/hub                   name, version (counts too, unless remote access is on)
    GET  /api/auth/providers        how people can sign in
    POST /api/auth/login/local      {email, password} -> cookie, or {token, me} with ?app=1
    POST /api/auth/join             {invite, name, password}: accept an invite link
    GET  /api/setup/state           whether the first admin is missing (+ the code, from the home network)
    POST /api/setup/first-admin     {setup_code, name, email, password}
    POST /api/pair                  {code, name} -> {token, member, hub}

Needs a session (cookie, or "Authorization: Bearer <token>"); each route says what it needs of the
member, see `_route`. Streams, snapshots and clips also take a short-lived `?ticket=`.
"""

import ipaddress
import json
import mimetypes
import os
import shutil
import socket
import time
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, urlsplit

from . import VERSION
from .accounts import Accounts, Problem, public_member
from .bridge import BridgeError
from .cameras import BadCamera, clean_camera, public_camera, usb_cameras
from .discovery import local_addresses
from .oidc import Federation, SignInError, safe_return
from .setup import Setup
from .vault import Vault
from . import webauthn
from .page import PAGE

MAX_BODY = 256 * 1024


class Hub:
    """The parts of the hub, bundled for the request handler."""

    def __init__(self, store, pairing, bridge, monitor, name, port, data_dir, clips=None, accounts=None, federation=None,
                 web_dir=None):
        self.store, self.pairing, self.bridge, self.monitor = store, pairing, bridge, monitor
        self.web_dir = web_dir if web_dir and os.path.isfile(os.path.join(web_dir, "index.html")) else None   # the built web app
        self.accounts = accounts or Accounts(store)
        self.federation = federation or Federation(self.accounts, Vault(os.path.join(data_dir, "keys")))
        self.setup = Setup(self)                 # the setup wizards' checks and progress
        self.federation.gate = lambda provider: self.setup.missing(provider)
        self.listening = None                    # (host, port) once the server is bound, for the hub's own self-checks
        self.mdns_name = None                    # the name announced on the network, if any
        self.name, self.port, self.data_dir = name, port, data_dir
        self.clips = clips            # recordings and event clips
        self.watchers = None          # recording, motion and cry workers, set once the hub is built
        self.classifier = None        # cry classifier, or None when this machine can't run it
        self.classifier_problem = "not loaded"

    def address(self):
        found = local_addresses()
        return f"http://{found[0] if found else socket.gethostname()}:{self.port}"

    def info(self, brief=False):
        head = {"id": self.store.hub_id(), "name": self.name, "version": VERSION,
                "setup_required": self.accounts.setup_needed()}
        if brief:
            return head
        return {
            **head,
            "cameras": len(self.store.cameras()),
            "viewers": len(self.accounts.sessions()),
            "bridge": self.bridge.available,
            "recording": bool(self.watchers) and self.store.settings()["recording"],
            "cry_detection": self.classifier is not None,
            "free_bytes": shutil.disk_usage(self.data_dir).free,
        }


Reply = Problem   # the name the routes use


class Who:
    """The caller of one request: a member (with a session), or a pairing key from before accounts."""

    def __init__(self, accounts, member=None, session=None, via=""):
        self.accounts, self.member, self.session, self.via = accounts, member, session, via
        self.legacy = member is None
        self._levels = None

    @property
    def admin(self):
        return bool(self.member) and self.member["role"] == "admin"

    def levels(self):
        """"all" (admins), or {camera id: view|manage}."""
        if self._levels is None:
            self._levels = "all" if self.legacy else self.accounts.levels(self.member)
        return self._levels

    def level(self, camera_id):
        """"manage", "view" or None for one camera. Pairing keys from before accounts only view."""
        if self.legacy:
            return "view"
        levels = self.levels()
        return "manage" if levels == "all" else levels.get(camera_id)


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

        # No Access-Control-Allow-* headers at all: no other website may read from the hub (docs/hub-auth.md, Q7).

        def _send(self, status, content_type, body, headers=()):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            for name, value in (*headers, *self._cookies):
                self.send_header(name, value)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def _json(self, data, status=200, headers=()):
            self._send(status, "application/json", json.dumps(data).encode(), headers)

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

        def _address(self):
            """Who is calling. Behind the tunnel on this machine the real address is in X-Forwarded-For."""
            peer = self.client_address[0]
            forwarded = (self.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
            return forwarded if forwarded and peer in ("127.0.0.1", "::1") else peer

        def _on_home_network(self):
            try:
                ip = ipaddress.ip_address(self.client_address[0])
            except ValueError:
                return False
            return ip.is_private or ip.is_loopback

        def _origin_ok(self, origin):
            """The hub's own origins: whatever address this page was opened on, and the public address if set."""
            if urlsplit(origin).netloc == self.headers.get("Host"):
                return True
            public = store.meta("public_url")
            return bool(public) and origin.rstrip("/") == public.rstrip("/")

        def _session_cookie(self, token, max_age):
            secure = "; Secure" if self.headers.get("X-Forwarded-Proto") == "https" else ""
            self._cookies.append(("Set-Cookie", f"lk_session={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}{secure}"))

        def _who(self, ticket_camera=None, optional=False):
            """Who is calling, from a bearer token, the session cookie or (for one camera) a ticket."""
            accounts = hub.accounts
            header = self.headers.get("Authorization") or ""
            bearer = header[7:].strip() if header.lower().startswith("bearer ") else ""
            jar = cookies.SimpleCookie(self.headers.get("Cookie") or "")
            cookie = jar["lk_session"].value if "lk_session" in jar else ""
            found, via = None, ""
            if bearer:
                found, via = accounts.session_for(bearer), "bearer"
                if not found and accounts.legacy_only() and store.viewer_for_token(bearer):
                    return Who(accounts, via="key")
            elif cookie:
                found, via = accounts.session_for(cookie), "cookie"
                if found and self.command in ("POST", "PUT", "PATCH", "DELETE"):
                    origin = self.headers.get("Origin")
                    if not origin or not self._origin_ok(origin):
                        raise Reply(403, "That request didn't come from the hub's own page.", "bad_origin")
            elif ticket_camera and (self.query.get("ticket") or [""])[0]:
                member = accounts.ticket_member(self.query["ticket"][0], ticket_camera)
                if member:
                    return Who(accounts, member, via="ticket")
            elif accounts.legacy_only():
                token = (self.query.get("token") or [""])[0]   # the old ?token=, for keys from before accounts only
                if token and store.viewer_for_token(token):
                    return Who(accounts, via="key")
            if found:
                return Who(accounts, found[1], found[0], via)
            if optional:
                return None
            if accounts.setup_needed():
                raise Reply(423, "Set up the hub's first admin first.")
            raise Reply(401, "Sign in to use the hub.")

        def _admin(self, who):
            if who.legacy:
                raise Reply(423, "Set up the hub's first admin to make changes.")
            if not who.admin:
                raise Reply(403, "Only an admin can do that.", "admin_only")

        def _member(self, who):
            if who.legacy:
                raise Reply(423, "Set up the hub's first admin to do that.")

        def _camera(self, who, camera_id, manage=False):
            """A camera the caller may see (and, with `manage`, manage). Anything else is 404, so the API
            doesn't say which cameras exist."""
            camera = store.camera(camera_id)
            level = who.level(camera_id) if camera else None
            if not level:
                raise Reply(404, "The hub has no such camera.")
            if manage:
                self._member(who)
                if level != "manage":
                    raise Reply(403, "You can watch this camera but not change it.", "manage_only")
            return camera

        def _clip_camera(self, name):
            """The camera a clip file belongs to (files are named after their event), or None."""
            stem = name.rsplit(".", 1)[0]
            event = store.event(int(stem)) if stem.isdigit() else None
            return event["camera_id"] if event else None

        def _handle(self):
            parts = urlsplit(self.path)
            self.query = parse_qs(parts.query)
            self._cookies = []
            path = [p for p in parts.path.split("/") if p]
            try:
                self._raw = self._read_body()
                origin = self.headers.get("Origin")
                # Apple posts its answer from its own site; state, nonce and the state cookie guard that route.
                if (origin and self.command in ("POST", "PUT", "PATCH", "DELETE") and not self._origin_ok(origin)
                        and path != ["api", "auth", "callback", "apple"]):
                    raise Reply(403, "That request didn't come from the hub's own page.", "bad_origin")
                self._route(self.command, path)
            except Reply as reply:
                body = {"error": reply.message, "code": reply.code}
                self._json(body, reply.status, [("Retry-After", str(reply.retry_after))] if reply.retry_after else ())
            except BadCamera as err:
                self._json({"error": str(err), "code": "bad_request"}, 400)
            except BridgeError as err:
                self._json({"error": str(err), "code": "bad_gateway"}, 502)
            except (BrokenPipeError, ConnectionResetError, socket.timeout):
                self.close_connection = True

        do_GET = do_POST = do_PATCH = do_PUT = do_DELETE = _handle

        def do_OPTIONS(self):
            # Nothing is allowed cross-origin, so there is nothing to answer a preflight with.
            self._cookies = []
            self._send(405, "application/json", b'{"error":"Not allowed.","code":"bad_origin"}')

        # --- routes -----------------------------------------------------

        def _route(self, method, path):
            if method == "GET" and path == ["status"] or (method == "GET" and not path and not hub.web_dir):
                return self._send(200, "text/html; charset=utf-8", PAGE.encode())
            if method == "GET" and (not path or path[0] != "api") and hub.web_dir:
                return self._web_file(path)
            if not path or path[0] != "api":
                raise Reply(404, "Not found.")
            route = (method, *path[1:])
            accounts = hub.accounts

            match route:    # open to anyone who can reach the hub
                case ("GET", "hub"):
                    who = self._who(optional=True)
                    return self._json(hub.info(brief=accounts.remote() and who is None))
                case ("GET", "auth", "providers"):
                    return self._json({"hub": {"id": store.hub_id(), "name": hub.name},
                                       "setup_required": accounts.setup_needed(),
                                       "providers": hub.federation.list_for_sign_in()})
                case ("POST", "auth", "login", "local"):
                    return self._login()
                case ("POST", "auth", "passkey", "options"):
                    return self._passkey_sign_in_options()
                case ("POST", "auth", "login", "passkey"):
                    return self._login_passkey()
                case ("POST", "auth", "login", ("google" | "apple") as provider):
                    return self._provider_login(provider, None)
                case ("GET", "auth", "callback", ("google") as provider):
                    return self._callback(provider, {k: v[0] for k, v in self.query.items()})
                case ("POST", "auth", "callback", ("apple") as provider):
                    return self._callback(provider, {k: v[0] for k, v in parse_qs(self._raw.decode("utf-8", "replace")).items()})
                case ("POST", "auth", "token"):
                    return self._app_token()
                case ("POST", "auth", "join"):
                    return self._join()
                case ("GET", "setup", "state"):
                    needed = accounts.setup_needed()
                    code = accounts.setup_code() if needed and self._on_home_network() else None
                    return self._json({"setup_required": needed, "setup_code": code,
                                       "devices": len(store.viewers()) if needed else 0})
                case ("POST", "setup", "first-admin"):
                    return self._first_admin()
                case ("POST", "pair"):
                    return self._pair()

            if len(route) >= 3 and route[1] == "setup" and route[2] not in ("state", "first-admin"):
                return self._setup_route(route)
            if route == ("GET", "setup"):
                return self._setup_route(route)

            who = self._who(self._ticket_camera(route))
            match route:
                case ("GET", "admin", "health"):
                    self._admin(who)
                    return self._json(hub.setup.health())
                case ("POST", "admin", "remote", "off"):
                    self._admin(who)
                    hub.setup.turn_off_remote(who.member)
                    return self._json({"remote": False})
                case ("POST", "auth", "logout"):
                    self._member(who)
                    accounts.end_session(who.session["id"])
                    self._session_cookie("", 0)
                    return self._json({"signed_out": True})
                case ("GET", "me"):
                    self._member(who)
                    return self._json(self._me(who))
                case ("PATCH", "me"):
                    self._member(who)
                    accounts.set_name(who.member["id"], self._data().get("name"))
                    return self._json(self._me(who))
                case ("PUT", "me", "password"):
                    self._member(who)
                    data = self._data()
                    accounts.change_password(accounts.member(who.member["id"]), data.get("current"), data.get("new"))
                    accounts.audit(who.member["id"], "password-changed")
                    return self._json({"changed": True})
                case ("GET", "me", "sessions"):
                    self._member(who)
                    return self._json({"sessions": [self._session_json(s, who) for s in accounts.sessions(who.member["id"])]})
                case ("DELETE", "me", "sessions", session_id):
                    self._member(who)
                    if not accounts.end_session(session_id, who.member["id"]):
                        raise Reply(404, "There is no such device.")
                    return self._json({"removed": session_id})
                case ("GET", "me", "passkeys"):
                    self._member(who)
                    return self._json({"passkeys": accounts.passkeys(who.member["id"]), "this_address": self._rp_id()})
                case ("POST", "me", "passkeys", "options"):
                    self._member(who)
                    return self._passkey_register_options(who)
                case ("POST", "me", "passkeys"):
                    self._member(who)
                    return self._passkey_register(who)
                case ("DELETE", "me", "passkeys", credential_id):
                    self._member(who)
                    accounts.remove_passkey(who.member["id"], credential_id, hub.federation.local()["password"])
                    return self._json({"removed": credential_id})
                case ("POST", "me", "link", ("google" | "apple") as provider):
                    self._member(who)
                    if not hub.federation.enabled(provider):
                        self._admin(who)               # before it is switched on, only an admin may try it (the wizard's test)
                    return self._provider_login(provider, who.member["id"])
                case ("DELETE", "me", "link", ("google" | "apple") as provider):
                    self._member(who)
                    accounts.unlink(who.member["id"], provider, hub.federation.local()["password"])
                    return self._json({"removed": provider})
                case ("GET", "admin", "auth", "providers"):
                    self._admin(who)
                    return self._json(hub.federation.settings())
                case ("PUT", "admin", "auth", "providers"):
                    self._admin(who)
                    settings = hub.federation.update(self._data())
                    accounts.audit(who.member["id"], "providers-changed")
                    return self._json(settings)
                case ("GET", "household"):
                    self._member(who)
                    return self._json(self._household(who))
                case ("POST", "household", "invites"):
                    return self._invite(who)
                case ("DELETE", "household", "invites", member_id):
                    self._admin(who)
                    accounts.cancel_invite(member_id)
                    return self._json({"removed": member_id})
                case ("PATCH", "household", "members", member_id):
                    self._admin(who)
                    member = accounts.update_member(member_id, self._data())
                    accounts.audit(who.member["id"], "member-changed", member_id)
                    return self._json({**public_member(member), "grants": accounts.grants(member_id)})
                case ("DELETE", "household", "members", member_id):
                    self._admin(who)
                    accounts.remove_member(member_id)
                    accounts.audit(who.member["id"], "member-removed", member_id)
                    return self._json({"removed": member_id})
                case ("POST", "household", "groups"):
                    self._admin(who)
                    data = self._data()
                    group = accounts.add_group(data.get("name"), data.get("cameras"))
                    accounts.audit(who.member["id"], "group-added", group["id"])
                    return self._json(group, 201)
                case ("PATCH", "household", "groups", group_id):
                    self._admin(who)
                    group = accounts.update_group(group_id, self._data())
                    accounts.audit(who.member["id"], "group-changed", group_id)
                    return self._json(group)
                case ("DELETE", "household", "groups", group_id):
                    self._admin(who)
                    accounts.remove_group(group_id)
                    accounts.audit(who.member["id"], "group-removed", group_id)
                    return self._json({"removed": group_id})
                case ("GET", "household", "sessions"):
                    self._admin(who)
                    return self._json({"sessions": [self._session_json(s, who) for s in accounts.sessions()]})
                case ("DELETE", "household", "sessions", session_id):
                    self._admin(who)
                    if not accounts.end_session(session_id):
                        raise Reply(404, "There is no such device.")
                    accounts.audit(who.member["id"], "session-ended", session_id)
                    return self._json({"removed": session_id})
                case ("POST", "groups", group_id, "shares"):
                    self._member(who)
                    self._manage_group(who, group_id)
                    accounts.share(group_id, self._data().get("member"), who.member)
                    return self._json({"shared": group_id}, 201)
                case ("DELETE", "groups", group_id, "shares", member_id):
                    self._member(who)
                    self._manage_group(who, group_id)
                    accounts.unshare(group_id, member_id, who.member)
                    return self._json({"removed": member_id})
                case ("GET", "admin", "audit"):
                    self._admin(who)
                    return self._json({"audit": accounts.audit_log()})
                case ("POST", "pairing", "code"):
                    return self._pairing_code(who)
                case ("GET", "cameras"):
                    levels = who.levels()
                    visible = [c for c in store.cameras() if levels == "all" or c["id"] in levels]
                    self._json({"cameras": [
                        {**public_camera(c), "access": who.level(c["id"]), "motion": bool(store.open_event("motion", c["id"]))}
                        for c in visible]})
                case ("POST", "cameras"):
                    self._admin(who)
                    self._add_camera(who)
                case ("POST", "cameras", "test"):
                    self._admin(who)
                    self._send(200, "image/jpeg", bridge.test(clean_camera({"name": "Test", **self._data()})))
                case ("PATCH", "cameras", camera_id):
                    self._camera(who, camera_id, manage=True)
                    store.rename_camera(camera_id, self._name())
                    self._json(public_camera(store.camera(camera_id)))
                case ("DELETE", "cameras", camera_id):
                    self._admin(who)
                    self._camera(who, camera_id)
                    store.remove_camera(camera_id)
                    hub.monitor.forget(camera_id)
                    bridge.remove(camera_id, store.cameras())
                    self._watch()
                    accounts.audit(who.member["id"], "camera-removed", camera_id)
                    self._json({"removed": camera_id})
                case ("GET", "cameras", camera_id, "zones"):
                    self._camera(who, camera_id)
                    self._json(store.zones(camera_id))
                case ("PUT", "cameras", camera_id, "zones"):
                    self._camera(who, camera_id, manage=True)
                    store.set_zones(camera_id, *clean_zones(self._data()))
                    if hub.watchers:
                        hub.watchers.refresh(camera_id)
                    self._json(store.zones(camera_id))
                case ("POST", "cameras", camera_id, "ticket"):
                    self._member(who)
                    self._camera(who, camera_id)
                    ticket, expires = accounts.ticket(who.member["id"], camera_id)
                    self._json({"ticket": ticket, "expires": expires})
                case ("DELETE", "events", event_id):
                    event = store.event(int(event_id)) if event_id.isdigit() else None
                    if event and store.camera(event["camera_id"]):
                        self._camera(who, event["camera_id"], manage=True)
                    elif event:
                        self._admin(who)      # an event of a camera that is gone is for admins only
                    if not event:
                        raise Reply(404, "The hub has no such event.")
                    if hub.clips:
                        hub.clips.remove(event)
                    store.remove_event(event["id"])
                    self._json({"removed": event["id"]})
                case ("GET", "clips", name):
                    camera_id = self._clip_camera(name)
                    if camera_id is None or not (who.admin or (store.camera(camera_id) and who.level(camera_id))):
                        raise Reply(404, "The hub no longer has that clip.")
                    self._file(hub.clips.path(name) if hub.clips else None)
                case ("GET", "settings"):
                    self._json(store.settings())
                case ("PATCH", "settings"):
                    self._admin(who)
                    settings = store.update_settings(self._data())
                    if settings is None:
                        raise Reply(400, "That setting can't be saved.")
                    if hub.watchers:
                        hub.watchers.refresh()
                    self._json(settings)
                case ("GET", "cameras", camera_id, "snapshot.jpg"):
                    self._camera(who, camera_id)
                    self._send(200, "image/jpeg", bridge.frame(camera_id))
                case ("GET", "cameras", camera_id, "stream.mjpeg"):
                    self._camera(who, camera_id)
                    self._mjpeg(camera_id)
                case ("POST", "cameras", camera_id, "webrtc"):
                    self._camera(who, camera_id)
                    self._send(201, "application/sdp", bridge.webrtc(camera_id, self._body()))
                case ("GET", "usb"):
                    self._admin(who)
                    taken = {c["address"] for c in store.cameras() if c["kind"] == "usb"}
                    self._json({"cameras": [{**c, "added": c["address"] in taken} for c in usb_cameras()]})
                case ("GET", "events"):
                    self._events(who)
                case _:
                    raise Reply(404, "Not found.")

        def _web_file(self, path):
            """The built web app, from the hub's own address (so it needs no CORS). Never outside its folder."""
            root = os.path.realpath(hub.web_dir)
            target = os.path.realpath(os.path.join(root, *path)) if path else os.path.join(root, "index.html")
            if os.path.isdir(target):
                target = os.path.join(target, "index.html")
            if not target.startswith(root + os.sep) or not os.path.isfile(target):
                raise Reply(404, "Not found.")
            kind = mimetypes.guess_type(target)[0] or "application/octet-stream"
            if kind.startswith("text/") or kind in ("application/javascript", "application/json"):
                kind += "; charset=utf-8"
            with open(target, "rb") as f:
                body = f.read()
            self._send(200, kind, body, [("X-Content-Type-Options", "nosniff")])

        def _ticket_camera(self, route):
            """The camera a ?ticket= may be used for on this route: streams, snapshots and clips only."""
            match route:
                case ("GET", "cameras", camera_id, "snapshot.jpg" | "stream.mjpeg"):
                    return camera_id
                case ("GET", "clips", name):
                    return self._clip_camera(name)
            return None

        def _setup_route(self, route):
            """The setup wizards. Admins only, except the hub-install flow before the first admin exists (home network only)."""
            flow = route[2] if len(route) > 2 else None
            open_here = flow == "hub-install" and hub.accounts.setup_needed() and self._on_home_network()
            who = None if open_here else self._who()
            if who is not None:
                self._admin(who)
            member = who.member if who else None
            setup = hub.setup
            match route:
                case ("GET", "setup"):
                    return self._json(setup.summary())
                case ("GET", "setup", name):
                    return self._json(setup.flow(name))
                case ("GET", "setup", name, step, "plan"):
                    return self._json(setup.plan(name, step))
                case ("POST", "setup", name, step, "verify"):
                    return self._json(setup.verify(name, step, self._data(), member))
                case ("PUT", "setup", name, step):
                    return self._json(setup.confirm(name, step, self._data().get("state"), member))
            raise Reply(404, "Not found.")

        def _manage_group(self, who, group_id):
            """Admins, or members who manage the group, may share it. Anyone else gets a 404."""
            if not hub.accounts.group(group_id):
                raise Reply(404, "The hub has no such group.")
            if who.admin:
                return
            mine = {g["id"]: g["level"] for g in hub.accounts.group_levels(who.member)}
            if mine.get(group_id) is None:
                raise Reply(404, "The hub has no such group.")
            if mine[group_id] != "manage":
                raise Reply(403, "You can watch this group but not share it.", "manage_only")

        def _me(self, who):
            accounts, member = hub.accounts, who.member
            row = accounts.member(member["id"])
            return {
                "member": public_member(row),
                "household": {"id": store.hub_id(), "name": hub.name},
                "session": {k: who.session[k] for k in ("id", "kind", "device", "expires")},
                "cameras": who.levels(),
                "groups": accounts.group_levels(row),
                "sign_in": {"password": bool(row["password_hash"]), "passkeys": len(accounts.passkeys(member["id"])),
                            "google": accounts.identities(member["id"]).get("google"),
                            "apple": accounts.identities(member["id"]).get("apple"), "address": self._rp_id()},
            }

        def _session_json(self, session, who):
            return {**session, "you": bool(who.session) and session["id"] == who.session["id"]}

        def _household(self, who):
            accounts = hub.accounts
            head = {"id": store.hub_id(), "name": hub.name}
            if not who.admin:
                mine = accounts.group_levels(who.member)
                return {"household": head,
                        "members": [{"id": m["id"], "name": m["name"], "role": m["role"]}
                                    for m in accounts.members() if m["status"] == "active"],
                        "groups": [{"id": g["id"], "name": g["name"], "level": g["level"]} for g in mine]}
            members = []
            for m in accounts.members():
                item = {**public_member(m), "status": m["status"], "last_seen": m["last_seen"],
                        "grants": accounts.grants(m["id"])}
                if m["status"] == "invited":
                    item["invited"] = m["invited"]
                members.append(item)
            return {"household": head, "members": members, "groups": accounts.groups()}

        def _signed_in(self, member, token, app, status=200):
            """Answers a successful sign-in: the cookie for a browser, the token for an app."""
            me = public_member(member)
            if app:
                return self._json({"token": token, "me": me}, status)
            self._session_cookie(token, int(hub.accounts._lifetime()))
            self._json({"me": me}, status)

        def _login(self):
            data, app = self._data(), (self.query.get("app") or [""])[0] == "1"
            if not hub.federation.local()["password"]:
                raise Reply(403, "Passwords are turned off on this hub. Use a passkey or another sign-in.", "password_off")
            member, token = hub.accounts.login(data.get("email"), data.get("password"), self._address(),
                                               "app" if app else "browser", str(data.get("device") or "")[:60])
            self._signed_in(member, token, app)

        def _rp_id(self):
            """The address passkeys are made for: the name or address this page was opened on, without the port."""
            return urlsplit("//" + (self.headers.get("Host") or "")).hostname or ""

        def _passkey_sign_in_options(self):
            if not hub.federation.local()["passkey"]:
                raise Reply(403, "Passkeys are turned off on this hub.", "passkey_off")
            rp_id = self._rp_id()
            challenge = hub.accounts.new_challenge("login", None, rp_id)
            self._json({"options": {"challenge": challenge, "rpId": rp_id, "timeout": 60000,
                                    "userVerification": "preferred", "allowCredentials": []}})

        def _passkey_parts(self, *names):
            """The credential from the request: its id and the base64url fields asked for, as bytes."""
            credential = self._data().get("credential")
            response = credential.get("response") if isinstance(credential, dict) else None
            if not isinstance(response, dict) or not isinstance(credential.get("id"), str):
                raise Reply(400, "That passkey answer wasn't valid.")
            try:
                return credential["id"], [webauthn.b64u_decode(response.get(n) or "") for n in names]
            except webauthn.PasskeyError as err:
                raise Reply(400, str(err)) from None

        def _login_passkey(self):
            app = (self.query.get("app") or [""])[0] == "1"
            if not hub.federation.local()["passkey"]:
                raise Reply(403, "Passkeys are turned off on this hub.", "passkey_off")
            address = self._address()
            hub.accounts.check_lock(("passkey", address))
            credential_id, (client_data, auth_data, signature) = self._passkey_parts(
                "clientDataJSON", "authenticatorData", "signature")
            try:
                challenge = json.loads(client_data).get("challenge", "")
                taken = hub.accounts.take_challenge(challenge, "login")
                saved = hub.accounts.passkey(credential_id)
                member = hub.accounts.member(saved["member_id"]) if saved else None
                if not taken or not member or member["status"] != "active" or saved["rp_id"] != taken[1]:
                    raise webauthn.PasskeyError("That passkey isn't known on this hub, or the request ran out.")
                counter = webauthn.verify_assertion(client_data, auth_data, signature, challenge, self._origin_ok,
                                                    saved["public_key"], saved["counter"], taken[1])
            except (webauthn.PasskeyError, ValueError, AttributeError) as err:
                hub.accounts.note_failure(("passkey", address))
                hub.accounts.audit("", "sign-in-failed", f"passkey from {address}")
                raise Reply(401, str(err) if isinstance(err, webauthn.PasskeyError) else "That passkey answer wasn't valid.",
                            "bad_sign_in") from None
            hub.accounts.use_passkey(saved["id"], counter)
            token = hub.accounts.create_session(member["id"], "app" if app else "browser", str(self._data().get("device") or "")[:60])
            hub.accounts.audit(member["id"], "sign-in", f"passkey from {address}")
            self._signed_in(member, token, app)

        def _passkey_register_options(self, who):
            accounts, rp_id = hub.accounts, self._rp_id()
            member = accounts.member(who.member["id"])
            challenge = accounts.new_challenge("register", member["id"], rp_id)
            self._json({"options": {
                "challenge": challenge, "rp": {"id": rp_id, "name": hub.name}, "timeout": 60000, "attestation": "none",
                "user": {"id": webauthn.b64u_encode(member["id"].encode()), "name": member["email"],
                         "displayName": member["name"] or member["email"]},
                "pubKeyCredParams": [{"type": "public-key", "alg": alg} for alg in webauthn.ALGORITHMS],
                "authenticatorSelection": {"residentKey": "required", "requireResidentKey": True, "userVerification": "preferred"},
                "excludeCredentials": [{"type": "public-key", "id": p["id"]} for p in accounts.passkeys(member["id"])
                                       if p["rp_id"] == rp_id]}})

        def _passkey_register(self, who):
            accounts = hub.accounts
            data = self._data()
            credential_id, (client_data, attestation) = self._passkey_parts("clientDataJSON", "attestationObject")
            try:
                challenge = json.loads(client_data).get("challenge", "")
                taken = accounts.take_challenge(challenge, "register")
                if not taken or taken[0] != who.member["id"]:
                    raise webauthn.PasskeyError("That passkey request ran out. Try again.")
                made = webauthn.verify_registration(client_data, attestation, challenge, self._origin_ok)
                if made["rp_id"] != taken[1] or made["credential_id"] != credential_id:
                    raise webauthn.PasskeyError("That passkey was made for a different address.")
            except (webauthn.PasskeyError, ValueError, AttributeError) as err:
                raise Reply(400, str(err) if isinstance(err, webauthn.PasskeyError) else "That passkey answer wasn't valid.",
                            "bad_passkey") from None
            accounts.add_passkey(who.member["id"], made, data.get("name"))
            self._json({"passkeys": accounts.passkeys(who.member["id"])}, 201)

        def _provider_login(self, provider, link_member):
            """Starts Google or Apple sign-in (or linking one to the signed-in member): answers where to send the browser."""
            data = self._data()
            if data.get("app") and not data.get("code_challenge"):
                raise Reply(400, "An app sign-in needs a code challenge.")
            url, state = hub.federation.begin(provider, data.get("return_to"), "link" if link_member else "login", link_member,
                                              str(data.get("code_challenge") or "") if data.get("app") else None)
            # Apple answers with a POST from its own site, so its cookie has to cross sites (it needs https, as Apple does).
            same_site = "None; Secure" if provider == "apple" else "Lax"
            self._cookies.append(("Set-Cookie", f"lk_oauth={state}; Path=/api/auth/callback; HttpOnly; SameSite={same_site}; Max-Age=600"))
            self._json({"redirect": url})

        def _callback(self, provider, params):
            jar = cookies.SimpleCookie(self.headers.get("Cookie") or "")
            self._cookies.append(("Set-Cookie", "lk_oauth=; Path=/api/auth/callback; HttpOnly; Max-Age=0"))
            try:
                done = hub.federation.finish(provider, params, jar["lk_oauth"].value if "lk_oauth" in jar else "")
            except SignInError as err:
                return self._redirect(f"/#/signin?error={err.code}&message={quote(err.message)}")
            member = done["member"]
            if done["purpose"] == "link":
                return self._redirect(done["return_to"])
            if done["app_challenge"]:
                return self._redirect("lookabout://hub/signed-in?code=" + hub.federation.app_code(member["id"], done["app_challenge"]))
            self._session_cookie(hub.accounts.create_session(member["id"], "browser", provider.capitalize()),
                                 int(hub.accounts._lifetime()))
            self._redirect(safe_return(done["return_to"]))

        def _redirect(self, location):
            self._send(302, "text/plain", b"", [("Location", location)])

        def _app_token(self):
            data = self._data()
            member_id = hub.federation.swap_code(data.get("code"), data.get("code_verifier"))
            member = hub.accounts.member(member_id)
            token = hub.accounts.create_session(member_id, "app", str(data.get("device") or "")[:60])
            hub.accounts.audit(member_id, "sign-in", "app code")
            self._json({"token": token, "me": public_member(member)})

        def _join(self):
            data, app = self._data(), (self.query.get("app") or [""])[0] == "1"
            member, token = hub.accounts.accept_invite(data.get("invite"), data.get("name"), data.get("password"),
                                                       self._address(), str(data.get("device") or "")[:60],
                                                       "app" if app else "browser")
            if app:
                return self._json({"token": token, "me": public_member(member)}, 201)
            self._session_cookie(token, int(hub.accounts._lifetime()))
            self._json({"me": public_member(member)}, 201)

        def _first_admin(self):
            data = self._data()
            member = hub.accounts.first_admin(data.get("setup_code"), data.get("name"), data.get("email"),
                                              data.get("password"))
            token = hub.accounts.create_session(member["id"], "browser", str(data.get("device") or "")[:60])
            self._session_cookie(token, int(hub.accounts._lifetime()))
            self._json({"me": public_member(member)}, 201)

        def _invite(self, who):
            self._admin(who)
            data = self._data()
            member, token = hub.accounts.invite(data.get("email"), data.get("role") or "member",
                                                data.get("grants") or [], who.member["id"])
            host = self.headers.get("Host") or f"{socket.gethostname()}:{hub.port}"
            base = (store.meta("public_url") or f"http://{host}").rstrip("/")
            self._json({**public_member(member), "status": member["status"], "grants": hub.accounts.grants(member["id"]),
                        "invite_link": f"{base}/#/join?invite={token}",
                        "expires": member["invite_expires"]}, 201)

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
                    self.end_headers()
                    return
                self.send_response(206)
                self.send_header("Content-Range", f"bytes {first}-{last}/{size}")
            else:
                self.send_response(200)
            self.send_header("Content-Type", "video/mp4" if path.endswith(".mp4") else "image/jpeg")
            self.send_header("Content-Length", str(last - first + 1))
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Cache-Control", "no-store")
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

        def _pairing_code(self, who):
            """An admin makes a code for one member; the member's phone or app trades it for a session."""
            self._admin(who)
            target = hub.accounts.member(str(self._data().get("member") or who.member["id"]))
            if not target or target["status"] != "active":
                raise Reply(404, "The hub has no such member.")
            code, seconds = hub.pairing.new_code(target["id"])
            address = hub.address()
            payload = f"lookabout://hub?address={quote(address, safe='')}&code={code}"
            self._json({"code": code, "expires_in": seconds, "address": address, "qr": pairing_qr(payload),
                        "member": target["id"]})

        def _pair(self):
            data = self._data()
            ok, member_id = hub.pairing.claim(data.get("code", ""))
            member = hub.accounts.member(member_id) if ok and member_id else None
            if not member:
                raise Reply(403, "That code is wrong or has run out. Ask an admin for a new one.", "bad_code")
            device = str(data.get("name") or "").strip()[:40] or "App"
            token = hub.accounts.create_session(member["id"], "app", device)
            hub.accounts.audit(member["id"], "paired", device)
            self._json({"token": token, "member": public_member(member),
                        "hub": {"id": store.hub_id(), "name": hub.name, "version": VERSION}})

        def _add_camera(self, who):
            data = self._data()
            fields = clean_camera(data)
            groups = data.get("groups") or []     # which groups the camera joins; none, so only admins see it
            if not isinstance(groups, list) or any(not hub.accounts.group(g) for g in groups):
                raise Reply(400, "Those groups aren't all on the hub.")
            if any(c["kind"] == fields["kind"] and c["address"] == fields["address"] for c in store.cameras()):
                raise Reply(409, "The hub already has this camera.")
            camera = store.add_camera(fields)
            for group_id in groups:
                hub.accounts.set_group_cameras(group_id, sorted({*hub.accounts.group_cameras(group_id), camera["id"]}))
            hub.accounts.audit(who.member["id"], "camera-added", camera["id"])
            try:
                bridge.add(camera, store.cameras())
            except BridgeError:
                if bridge.available:  # without go2rtc the camera is still listed, just without video
                    store.remove_camera(camera["id"])
                    raise
            self._watch()
            self._json(public_camera(camera), 201)

        def _events(self, who):
            def number(key, default):
                try:
                    return float((self.query.get(key) or [default])[0])
                except ValueError:
                    raise Reply(400, f"{key} should be a number.") from None
            kind = (self.query.get("kind") or [None])[0]
            limit = int(min(max(number("limit", 200), 1), 1000))
            levels = who.levels()
            events = store.events(since=number("since", 0), kind=kind, limit=limit,
                                  cameras=None if levels == "all" else list(levels))
            self._json({"events": [event_json(e) for e in events], "now": time.time()})

        def _mjpeg(self, camera_id):
            with bridge.mjpeg(camera_id) as upstream:
                self.send_response(200)
                self.send_header("Content-Type", upstream.headers.get("Content-Type", "multipart/x-mixed-replace"))
                self.send_header("Cache-Control", "no-store")
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
    server = Server((host, hub.port), make_handler(hub))
    hub.listening = server.server_address
    return server
