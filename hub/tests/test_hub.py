"""Hub tests. Standard library only:  python3 -m unittest discover -s tests

go2rtc is replaced by a stand-in, so these cover the hub's own behaviour
(pairing codes, camera checks, health, the HTTP interface); accounts are in test_accounts.py, not video.
"""

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from lookabout_hub.bridge import BridgeError, sources  # noqa: E402,F401
from lookabout_hub.cameras import BadCamera, clean_camera, stream_url, usb_cameras  # noqa: E402
from lookabout_hub.pairing import Pairing  # noqa: E402
from lookabout_hub.store import Store  # noqa: E402
from support import JPEG, HubCase  # noqa: E402


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


class HubTest(HubCase):
    def test_page_and_info_are_open(self):
        status, page = self.call("GET", "/", raw=True)
        self.assertEqual(status, 200)
        self.assertIn(b"Lookabout hub", page)
        status, info = self.call("GET", "/api/hub")
        self.assertEqual((status, info["name"], info["viewers"], info["setup_required"]), (200, "Test hub", 0, True))

    def test_sign_in_survives_a_restart(self):
        token = self.signin()
        reopened = Store(os.path.join(self.dir.name, "hub.db"))
        self.assertEqual(reopened.hub_id(), self.store.hub_id())
        self.assertEqual(len(reopened._all("SELECT id FROM members")), 1)
        reopened.close()
        self.assertEqual(self.call("GET", "/api/me", token=token)[0], 200)

    def test_cameras(self):
        token = self.signin()
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

        _, made = self.call("POST", f"/api/cameras/{cam['id']}/ticket", token=token)
        status, frame = self.call("GET", f"/api/cameras/{cam['id']}/snapshot.jpg?ticket={made['ticket']}", raw=True)
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
        token = self.signin()
        status, frame = self.call("POST", "/api/cameras/test", {"kind": "mjpeg", "address": "10.0.0.9"}, token=token, raw=True)
        self.assertEqual((status, frame), (200, JPEG))
        status, problem = self.call("POST", "/api/cameras/test", {"kind": "mjpeg", "address": "dead.local"}, token=token)
        self.assertEqual(status, 502)
        self.assertIn("No video", problem["error"])
        self.assertEqual(self.store.cameras(), [])

    def test_offline_and_back(self):
        token = self.signin()
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
        token = self.signin()
        _, cam = self.call("POST", "/api/cameras", {"kind": "mjpeg", "name": "Garage", "address": "10.0.0.9"}, token=token)
        self.up[cam["id"]] = False
        self.monitor.check_all()
        self.monitor.check_all()
        self.call("DELETE", f"/api/cameras/{cam['id']}", token=token)
        event = self.call("GET", "/api/events", token=token)[1]["events"][0]
        self.assertIsNotNone(event["ended"])
        self.assertEqual(event["detail"], "Camera removed")

    def test_bad_requests(self):
        token = self.signin()
        self.assertEqual(self.call("POST", "/api/cameras", b"{not json", token=token)[0], 400)
        self.assertEqual(self.call("GET", "/api/events?since=yesterday", token=token)[0], 400)
        self.assertEqual(self.call("GET", "/api/nothing", token=token)[0], 404)
        self.assertEqual(self.call("DELETE", "/api/household/members/nope", token=token)[0], 404)


class WebAppTest(HubCase):
    """The hub serves the built web app from its own address (no CORS, so it has to)."""

    def setUp(self):
        super().setUp()
        self.web = os.path.join(self.dir.name, "web")
        os.makedirs(os.path.join(self.web, "assets"))
        for name, text in (("index.html", "<!doctype html><title>Lookabout</title>"), ("assets/app.js", "console.log(1)"),
                           ("assets/app.css", "a{}"), ("assets/logo.svg", "<svg/>")):
            with open(os.path.join(self.web, name), "w") as f:
                f.write(text)
        with open(os.path.join(self.dir.name, "secret.txt"), "w") as f:
            f.write("nope")
        self.hub.web_dir = self.web

    def test_the_app_is_the_front_page_and_the_status_page_moves(self):
        status, page, headers = self.send("GET", "/", raw=True)
        self.assertEqual((status, headers["Content-Type"]), (200, "text/html; charset=utf-8"))
        self.assertIn(b"<title>Lookabout</title>", page)
        self.assertIn(b"Lookabout hub", self.send("GET", "/status", raw=True)[1])

    def test_files_and_their_types(self):
        for path, kind in (("/assets/app.js", "javascript"), ("/assets/app.css", "text/css"), ("/assets/logo.svg", "image/svg+xml"),
                           ("/index.html", "text/html")):
            status, _, headers = self.send("GET", path, raw=True)
            self.assertEqual(status, 200, path)
            self.assertIn(kind, headers["Content-Type"], path)
            self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(self.send("GET", "/assets/", raw=True)[0], 404)
        self.assertEqual(self.send("GET", "/assets/missing.js", raw=True)[0], 404)

    def test_nothing_outside_the_folder(self):
        for path in ("/../secret.txt", "/%2e%2e/secret.txt", "/assets/../../secret.txt", "/..%2fsecret.txt", "//etc/passwd"):
            status, body, _ = self.send("GET", path, raw=True)
            self.assertNotIn(b"nope", body, path)
            self.assertIn(status, (404, 200), path)
        link = os.path.join(self.web, "assets", "link.txt")
        os.symlink(os.path.join(self.dir.name, "secret.txt"), link)
        self.assertEqual(self.send("GET", "/assets/link.txt", raw=True)[0], 404)

    def test_the_api_is_not_shadowed(self):
        self.assertEqual(self.call("GET", "/api/hub")[0], 200)
        self.assertEqual(self.call("GET", "/api/nothing")[0], 401 if not self.hub.accounts.setup_needed() else 423)
        self.assertEqual(self.send("POST", "/", {}, raw=True)[0], 404)

    def test_without_a_web_app_the_status_page_stays_at_the_root(self):
        self.hub.web_dir = None
        self.assertIn(b"Lookabout hub", self.send("GET", "/", raw=True)[1])
        self.assertEqual(self.send("GET", "/assets/app.js", raw=True)[0], 404)


if __name__ == "__main__":
    unittest.main()
