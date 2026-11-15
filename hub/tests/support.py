"""Shared by the hub tests: a stand-in video bridge and a hub served on a free port."""

import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from lookabout_hub.bridge import BridgeError  # noqa: E402
from lookabout_hub.accounts import Accounts  # noqa: E402
from lookabout_hub.monitor import Monitor  # noqa: E402
from lookabout_hub.pairing import Pairing  # noqa: E402
from lookabout_hub.server import Hub, make_server  # noqa: E402
from lookabout_hub.store import Store  # noqa: E402



class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):      # a redirect is an answer to look at, not to follow
        return None


OPENER = urllib.request.build_opener(_NoRedirect)
PASSWORD = "correct horse battery"   # 21 characters, so a strong credential
JPEG = b"\xff\xd8fake\xff\xd9"


class FakeBridge:
    available = True

    def __init__(self):
        self.live = {}

    def add(self, camera, cameras):
        self.live[camera["id"]] = camera

    def remove(self, camera_id, cameras):
        self.live.pop(camera_id, None)

    def frame(self, camera_id):
        return JPEG

    def test(self, camera):
        if "dead" in camera["address"]:
            raise BridgeError("No video came from the camera.")
        return JPEG

    def webrtc(self, camera_id, offer):
        return b"answer-for:" + offer


class HubCase(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.store = Store(os.path.join(self.dir.name, "hub.db"))
        self.up = {}
        self.now = [5000.0]
        self.monitor = Monitor(self.store, check=lambda c: self.up.get(c["id"], True), clock=lambda: self.now[0])
        self.bridge = FakeBridge()
        self.clock = [1_700_000_000.0]
        self.accounts = Accounts(self.store, clock=lambda: self.clock[0], log=lambda text: None)
        self.hub = Hub(self.store, Pairing(), self.bridge, self.monitor, "Test hub", 0, self.dir.name,
                       accounts=self.accounts)
        self.server = make_server(self.hub, host="127.0.0.1")
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.store.close()
        self.dir.cleanup()

    def send(self, method, path, body=None, token=None, headers=None, raw=False):
        """(status, body, response headers). The body is parsed JSON unless `raw`."""
        data = body if isinstance(body, bytes) else (json.dumps(body).encode() if body is not None else None)
        request = urllib.request.Request(self.base + path, data=data, method=method, headers=headers or {})
        if token:
            request.add_header("Authorization", f"Bearer {token}")
        try:
            with OPENER.open(request, timeout=5) as response:
                payload, status, got = response.read(), response.status, response.headers
        except urllib.error.HTTPError as err:
            payload, status, got = err.read(), err.code, err.headers
        if not raw and status in (301, 302, 303):
            payload = b'{}'
        return status, payload if raw else json.loads(payload), got

    def call(self, method, path, body=None, token=None, headers=None, raw=False):
        status, payload, _ = self.send(method, path, body, token, headers, raw)
        return status, payload

    def member(self, email="sam@example.com"):
        """A member by email. (Ordering by time isn't reliable here: the test clock stands still.)"""
        return next(m for m in self.accounts.members() if m["email"] == email)

    def signin(self, email="sam@example.com", password=PASSWORD):
        """A bearer token for a member. The first call makes the first admin."""
        if self.hub.accounts.setup_needed():
            status, made = self.call("POST", "/api/setup/first-admin",
                                     {"setup_code": self.hub.accounts.setup_code(), "name": "Sam",
                                      "email": email, "password": password})
            self.assertEqual(status, 201, made)
        status, got = self.call("POST", "/api/auth/login/local?app=1", {"email": email, "password": password})
        self.assertEqual(status, 200, got)
        return got["token"]

    def invite(self, admin, email, role="member", grants=(), password=PASSWORD):
        """Invites someone, has them accept, and returns (member id, token)."""
        status, made = self.call("POST", "/api/household/invites",
                                 {"email": email, "role": role, "grants": list(grants)}, token=admin)
        self.assertEqual(status, 201, made)
        invite = made["invite_link"].split("invite=")[1]
        status, joined = self.call("POST", "/api/auth/join?app=1", {"invite": invite, "name": email.split("@")[0],
                                                                    "password": password})
        self.assertEqual(status, 201, joined)
        return made["id"], joined["token"]

    def camera(self, token, address="10.0.0.9", name="Garage", groups=()):
        status, cam = self.call("POST", "/api/cameras", {"kind": "mjpeg", "name": name, "address": address,
                                                         "groups": list(groups)}, token=token)
        self.assertEqual(status, 201, cam)
        return cam
