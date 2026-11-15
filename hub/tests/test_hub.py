"""Hub tests. Standard library only:  python3 -m unittest discover -s tests

go2rtc is replaced by a stand-in, so these cover the hub's own behaviour
(pairing, keys, camera checks, health, the HTTP interface), not video.
"""

import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from lookabout_hub.bridge import BridgeError, sources  # noqa: E402
from lookabout_hub.cameras import BadCamera, clean_camera, stream_url, usb_cameras  # noqa: E402
from lookabout_hub.monitor import Monitor  # noqa: E402
from lookabout_hub.pairing import Pairing  # noqa: E402
from lookabout_hub.server import Hub, make_server  # noqa: E402
from lookabout_hub.store import Store  # noqa: E402

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


class PairingTest(unittest.TestCase):
    def test_code_works_once(self):
        pairing = Pairing()
        code, _ = pairing.new_code()
        self.assertRegex(code, r"^[A-Z2-9]{4}-[A-Z2-9]{4}$")
        self.assertTrue(pairing.redeem(code.lower().replace("-", " ")))
        self.assertFalse(pairing.redeem(code))

    def test_code_runs_out(self):
        now = [1000.0]
        pairing = Pairing(clock=lambda: now[0])
        code, seconds = pairing.new_code()
        now[0] += seconds + 1
        self.assertFalse(pairing.redeem(code))

    def test_wrong_tries_cancel_the_code(self):
        pairing = Pairing()
        code, _ = pairing.new_code()
        for _ in range(5):
            self.assertFalse(pairing.redeem("AAAA-AAAA"))
        self.assertFalse(pairing.redeem(code))

    def test_no_code_until_asked(self):
        self.assertFalse(Pairing().redeem(""))


class CameraTest(unittest.TestCase):
    def test_board_address(self):
        cam = clean_camera({"kind": "mjpeg", "name": " Garage ", "address": "192.168.1.20/"})
        self.assertEqual((cam["name"], cam["address"]), ("Garage", "http://192.168.1.20"))
        self.assertEqual(stream_url(cam), "http://192.168.1.20/stream")

    def test_rtsp_sign_in_is_kept_out_of_the_address(self):
        cam = clean_camera({"kind": "rtsp", "name": "Door", "address": "rtsp://me:p%40ss@10.0.0.5:554/live0"})
        self.assertEqual(cam["address"], "rtsp://10.0.0.5:554/live0")
        self.assertEqual((cam["username"], cam["password"]), ("me", "p%40ss"))
        cam = clean_camera({"kind": "rtsp", "name": "Door", "address": "rtsp://10.0.0.5/live0",
                            "username": "me", "password": "p@ss/word"})
        self.assertEqual(stream_url(cam), "rtsp://me:p%40ss%2Fword@10.0.0.5/live0")

    def test_addresses_that_could_run_things_are_refused(self):
        for bad in (
            {"kind": "mjpeg", "address": "exec:rm -rf /"},
            {"kind": "mjpeg", "address": "http://cam/stream#video=h264"},
            {"kind": "mjpeg", "address": "ffmpeg:device?video=0"},
            {"kind": "rtsp", "address": "http://10.0.0.5/"},
            {"kind": "rtsp", "address": "rtsp://10.0.0.5:port/"},
            {"kind": "usb", "address": "/dev/video0 -f lavfi"},
            {"kind": "usb", "address": "/etc/passwd"},
            {"kind": "other", "address": "x"},
        ):
            with self.assertRaises(BadCamera, msg=bad):
                clean_camera({"name": "x", **bad})

    def test_sources(self):
        cam = {"id": "cam-1", **clean_camera({"kind": "mjpeg", "name": "x", "address": "10.0.0.9"})}
        self.assertEqual(sources(cam), ["http://10.0.0.9/stream", "ffmpeg:cam-1#video=h264"])

    def test_usb_listing(self):
        with tempfile.TemporaryDirectory() as root:
            sys_root, dev_root = os.path.join(root, "sys"), os.path.join(root, "dev")
            os.makedirs(dev_root)
            for node, index, bus in (("video0", "0", "usb1/1-1/1-1.2/1-1.2:1.0"), ("video1", "1", "usb1/1-1/1-1.2/1-1.2:1.0"),
                                     ("video10", "0", "platform/soc/codec")):
                real = os.path.join(root, "devices", bus)
                os.makedirs(real, exist_ok=True)
                os.makedirs(os.path.join(sys_root, node))
                os.symlink(real, os.path.join(sys_root, node, "device"))
                for name, value in (("index", index), ("name", "HD Webcam C920: HD Webcam")):
                    with open(os.path.join(sys_root, node, name), "w") as f:
                        f.write(value + "\n")
                open(os.path.join(dev_root, node), "w").close()
            self.assertEqual(usb_cameras(sys_root, dev_root),
                             [{"address": os.path.join(dev_root, "video0"), "name": "HD Webcam C920", "port": "1-1.2"}])


class HubTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.store = Store(os.path.join(self.dir.name, "hub.db"))
        self.up = {}
        self.now = [5000.0]
        self.monitor = Monitor(self.store, check=lambda c: self.up.get(c["id"], True), clock=lambda: self.now[0])
        self.bridge = FakeBridge()
        self.hub = Hub(self.store, Pairing(), self.bridge, self.monitor, "Test hub", 0, self.dir.name)
        self.server = make_server(self.hub, host="127.0.0.1")
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.store.close()
        self.dir.cleanup()

    def call(self, method, path, body=None, token=None, headers=None, raw=False):
        data = body if isinstance(body, bytes) else (json.dumps(body).encode() if body is not None else None)
        request = urllib.request.Request(self.base + path, data=data, method=method, headers=headers or {})
        if token:
            request.add_header("Authorization", f"Bearer {token}")
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                payload, status = response.read(), response.status
        except urllib.error.HTTPError as err:
            payload, status = err.read(), err.code
        return status, payload if raw else json.loads(payload)

    def pair(self, name="Phone"):
        _, made = self.call("POST", "/api/pairing/code")
        status, paired = self.call("POST", "/api/pair", {"code": made["code"], "name": name})
        self.assertEqual(status, 200)
        return paired

    def test_page_and_info_are_open(self):
        status, page = self.call("GET", "/", raw=True)
        self.assertEqual(status, 200)
        self.assertIn(b"Lookabout hub", page)
        status, info = self.call("GET", "/api/hub")
        self.assertEqual((status, info["name"], info["viewers"]), (200, "Test hub", 0))

    def test_everything_else_needs_a_key(self):
        for method, path in (("GET", "/api/cameras"), ("POST", "/api/cameras"), ("GET", "/api/events"),
                             ("GET", "/api/viewers"), ("GET", "/api/usb"), ("GET", "/api/cameras/x/snapshot.jpg"),
                             ("POST", "/api/cameras/x/webrtc"), ("DELETE", "/api/viewers/x")):
            status, _ = self.call(method, path, body={} if method == "POST" else None)
            self.assertEqual(status, 401, path)
        status, _ = self.call("GET", "/api/cameras", token="made-up")
        self.assertEqual(status, 401)

    def test_pairing_code_only_from_the_hub_page(self):
        status, _ = self.call("POST", "/api/pairing/code", headers={"Origin": "https://elsewhere.example"})
        self.assertEqual(status, 403)
        status, made = self.call("POST", "/api/pairing/code", headers={"Origin": self.base})
        self.assertEqual(status, 200)
        self.assertIn("lookabout", made["address"] + "lookabout")

    def test_pair_then_unpair(self):
        status, _ = self.call("POST", "/api/pair", {"code": "AAAA-AAAA", "name": "x"})
        self.assertEqual(status, 403)
        owner, second = self.pair("Owner phone"), self.pair("Second phone")
        self.assertEqual((owner["viewer"]["role"], second["viewer"]["role"]), ("owner", "viewer"))
        _, listed = self.call("GET", "/api/viewers", token=owner["token"])
        self.assertEqual([(v["name"], v["you"]) for v in listed["viewers"]],
                         [("Owner phone", True), ("Second phone", False)])
        self.assertNotIn("token", json.dumps(listed))
        status, _ = self.call("DELETE", f"/api/viewers/{second['viewer']['id']}", token=owner["token"])
        self.assertEqual(status, 200)
        status, _ = self.call("GET", "/api/cameras", token=second["token"])
        self.assertEqual(status, 401)

    def test_pairing_survives_a_restart(self):
        token = self.pair()["token"]
        reopened = Store(os.path.join(self.dir.name, "hub.db"))
        self.assertIsNotNone(reopened.viewer_for_token(token))
        self.assertEqual(reopened.hub_id(), self.store.hub_id())
        reopened.close()

    def test_cameras(self):
        token = self.pair()["token"]
        status, cam = self.call("POST", "/api/cameras", {"kind": "rtsp", "name": "Front door",
                                                         "address": "rtsp://10.0.0.5/live0",
                                                         "username": "me", "password": "secret"}, token=token)
        self.assertEqual(status, 201)
        self.assertIn(cam["id"], self.bridge.live)
        status, _ = self.call("POST", "/api/cameras", {"kind": "rtsp", "name": "Again",
                                                       "address": "rtsp://10.0.0.5/live0"}, token=token)
        self.assertEqual(status, 409)
        status, bad = self.call("POST", "/api/cameras", {"kind": "mjpeg", "name": "x", "address": "exec:boom"}, token=token)
        self.assertEqual(status, 400)
        self.assertIn("error", bad)

        _, listed = self.call("GET", "/api/cameras", token=token)
        self.assertEqual([c["name"] for c in listed["cameras"]], ["Front door"])
        self.assertNotIn("secret", json.dumps(listed))

        status, frame = self.call("GET", f"/api/cameras/{cam['id']}/snapshot.jpg?token={token}", raw=True)
        self.assertEqual((status, frame), (200, JPEG))
        status, answer = self.call("POST", f"/api/cameras/{cam['id']}/webrtc", b"offer", token=token, raw=True)
        self.assertEqual((status, answer), (201, b"answer-for:offer"))
        status, _ = self.call("GET", "/api/cameras/nope/snapshot.jpg", token=token)
        self.assertEqual(status, 404)

        status, renamed = self.call("PATCH", f"/api/cameras/{cam['id']}", {"name": "Porch"}, token=token)
        self.assertEqual((status, renamed["name"]), (200, "Porch"))
        status, _ = self.call("DELETE", f"/api/cameras/{cam['id']}", token=token)
        self.assertEqual(status, 200)
        self.assertEqual(self.bridge.live, {})
        self.assertEqual(self.call("GET", "/api/cameras", token=token)[1]["cameras"], [])

    def test_trying_a_camera(self):
        token = self.pair()["token"]
        status, frame = self.call("POST", "/api/cameras/test", {"kind": "mjpeg", "address": "10.0.0.9"}, token=token, raw=True)
        self.assertEqual((status, frame), (200, JPEG))
        status, problem = self.call("POST", "/api/cameras/test", {"kind": "mjpeg", "address": "dead.local"}, token=token)
        self.assertEqual(status, 502)
        self.assertIn("No video", problem["error"])
        self.assertEqual(self.store.cameras(), [])

    def test_offline_and_back(self):
        token = self.pair()["token"]
        _, cam = self.call("POST", "/api/cameras", {"kind": "mjpeg", "name": "Garage", "address": "10.0.0.9"}, token=token)
        self.up[cam["id"]] = False
        self.monitor.check_all()  # one miss is not enough
        self.assertEqual(self.store.camera(cam["id"])["status"], "online")
        self.monitor.check_all()
        _, listed = self.call("GET", "/api/cameras", token=token)
        self.assertEqual((listed["cameras"][0]["status"], listed["cameras"][0]["since"]), ("offline", 5000.0))
        self.now[0] += 360
        self.up[cam["id"]] = True
        self.monitor.check_all()
        self.assertEqual(self.store.camera(cam["id"])["status"], "online")
        _, got = self.call("GET", "/api/events?kind=offline", token=token)
        event = got["events"][0]
        self.assertEqual((event["camera"], event["started"], event["ended"]), ("Garage", 5000.0, 5360.0))
        self.assertEqual(self.call("GET", "/api/events?kind=motion", token=token)[1]["events"], [])

    def test_removing_an_offline_camera_ends_its_event(self):
        token = self.pair()["token"]
        _, cam = self.call("POST", "/api/cameras", {"kind": "mjpeg", "name": "Garage", "address": "10.0.0.9"}, token=token)
        self.up[cam["id"]] = False
        self.monitor.check_all()
        self.monitor.check_all()
        self.call("DELETE", f"/api/cameras/{cam['id']}", token=token)
        event = self.call("GET", "/api/events", token=token)[1]["events"][0]
        self.assertIsNotNone(event["ended"])
        self.assertEqual(event["detail"], "Camera removed")

    def test_bad_requests(self):
        token = self.pair()["token"]
        self.assertEqual(self.call("POST", "/api/cameras", b"{not json", token=token)[0], 400)
        self.assertEqual(self.call("GET", "/api/events?since=yesterday", token=token)[0], 400)
        self.assertEqual(self.call("GET", "/api/nothing", token=token)[0], 404)
        self.assertEqual(self.call("PATCH", "/api/viewers/nope", {"name": "x"}, token=token)[0], 404)


if __name__ == "__main__":
    unittest.main()
