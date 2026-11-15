"""Recording, motion and cry detection tests:  python3 -m unittest discover -s tests

Needs numpy. Clip cutting also needs ffmpeg and is skipped without it. The
cry classifier itself (YAMNet) is not loaded here; the 20-second rule is.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from lookabout_hub.accounts import Accounts  # noqa: E402
from lookabout_hub.clips import SEGMENT_NAME, Clips  # noqa: E402
from lookabout_hub.cry import CryTracker, pcm_to_samples  # noqa: E402
from lookabout_hub.monitor import Monitor  # noqa: E402
from lookabout_hub.motion import HEIGHT, WIDTH, MotionDetector, MotionTracker, share_needed, zone_mask  # noqa: E402
from lookabout_hub.pairing import Pairing  # noqa: E402
from lookabout_hub.server import Hub, make_server  # noqa: E402
from lookabout_hub.store import Store  # noqa: E402

LOWER_HALF = {"name": "Door", "points": [[0, 0.5], [1, 0.5], [1, 1], [0, 1]]}
UPPER_LEFT = {"name": "Sky", "points": [[0, 0], [0.4, 0], [0.4, 0.3], [0, 0.3]]}


def scene(box=None, level=90):
    frame = np.full((HEIGHT, WIDTH), level, dtype=np.uint8)
    if box:
        x, y, w, h = box
        frame[y:y + h, x:x + w] = 240
    return frame


class MotionTest(unittest.TestCase):
    def test_zone_mask(self):
        self.assertAlmostEqual(zone_mask(LOWER_HALF["points"]).mean(), 0.5, places=2)
        triangle = zone_mask([[0, 0], [1, 0], [0, 1]])
        self.assertTrue(triangle[5, 5])
        self.assertFalse(triangle[HEIGHT - 5, WIDTH - 5])

    def test_sensitivity(self):
        self.assertAlmostEqual(share_needed(0), 0.08)
        self.assertAlmostEqual(share_needed(100), 0.004)
        self.assertGreater(share_needed(30), share_needed(70))

    def test_motion_only_counts_inside_its_zone(self):
        detector = MotionDetector([LOWER_HALF, UPPER_LEFT])
        seen = []
        for i in range(12):
            box = (20 + i * 8, 70, 24, 40) if i >= 4 else None  # something crosses the lower half
            seen.append(detector.feed(scene(box)))
        self.assertEqual(seen[:5], [[]] * 5)       # still scene, then one frame isn't enough
        self.assertEqual(seen[5:], [["Door"]] * 7)

    def test_something_that_stops_is_no_longer_motion(self):
        detector = MotionDetector([LOWER_HALF])
        for i in range(8):
            detector.feed(scene((20 + i * 8, 70, 24, 40)))
        parked = [detector.feed(scene((76, 70, 24, 40))) for _ in range(8)]
        self.assertEqual(parked[3:], [[]] * 5)

    def test_still_scene_and_noise_are_quiet(self):
        detector = MotionDetector([LOWER_HALF])
        rng = np.random.default_rng(1)
        for _ in range(40):
            noisy = np.clip(scene().astype(int) + rng.integers(-6, 7, (HEIGHT, WIDTH)), 0, 255).astype(np.uint8)
            self.assertEqual(detector.feed(noisy), [])

    def test_lights_going_on_is_not_motion(self):
        detector = MotionDetector()
        for _ in range(3):
            detector.feed(scene())
        for _ in range(6):
            self.assertEqual(detector.feed(scene(level=200)), [])

    def test_no_zones_means_the_whole_frame(self):
        detector = MotionDetector([])
        detector.feed(scene())
        detector.feed(scene((10, 10, 30, 30)))
        self.assertEqual(detector.feed(scene((14, 10, 30, 30))), [""])

    def test_passer_by_leaves_no_ghost(self):
        detector = MotionDetector([LOWER_HALF])
        for _ in range(4):
            detector.feed(scene())
        for i in range(20):
            detector.feed(scene((10 + i * 6, 70, 24, 40)))
        after = [detector.feed(scene()) for _ in range(6)]
        self.assertEqual(after[3:], [[]] * 3)

    def test_events(self):
        events = []
        tracker = MotionTracker(lambda t, n: events.append(("start", t, n)), lambda t, n: events.append(("end", t, n)))
        for t in range(0, 5):
            tracker.feed(t, [])
        for t in range(5, 15):
            tracker.feed(t, ["Door"] if t < 12 else ["Door", "Street"])
        for t in range(15, 30):
            tracker.feed(t, [])
        self.assertEqual(events, [("start", 5, ["Door"]), ("end", 14, ["Door", "Street"])])

    def test_motion_that_never_stops_is_one_event(self):
        events = []
        tracker = MotionTracker(lambda t, n: events.append(("start", t)), lambda t, n: events.append(("end", t)))
        for t in range(0, 400):
            tracker.feed(t, ["Door"])
        self.assertEqual(events, [("start", 0), ("end", 120)])
        for t in range(400, 420):
            tracker.feed(t, [])
        tracker.feed(420, ["Door"])
        self.assertEqual(events[-1], ("start", 420))


class CryTest(unittest.TestCase):
    def run_sound(self, pattern):
        """pattern: one bool per second. Returns the events raised."""
        events = []
        tracker = CryTracker(lambda t: events.append(("start", t)), lambda t: events.append(("end", t)))
        for second, crying in enumerate(pattern):
            tracker.feed(second, crying)
        return events

    def test_short_cry_is_ignored(self):
        self.assertEqual(self.run_sound([True] * 15 + [False] * 60), [])

    def test_twenty_seconds_raise_an_event_from_when_it_began(self):
        events = self.run_sound([False] * 5 + [True] * 45 + [False] * 30)
        self.assertEqual(events, [("start", 5), ("end", 49)])

    def test_breaths_between_cries_do_not_reset_the_count(self):
        pattern = [second % 5 != 0 for second in range(1, 41)] + [False] * 30
        self.assertEqual(self.run_sound(pattern)[0], ("start", 0))

    def test_two_short_cries_far_apart_do_not_add_up(self):
        self.assertEqual(self.run_sound([True] * 12 + [False] * 10 + [True] * 12 + [False] * 20), [])

    def test_pcm(self):
        samples = pcm_to_samples(np.array([0, 16384, -32768], dtype="<i2").tobytes())
        self.assertEqual(samples.tolist(), [0.0, 0.5, -1.0])


class ClipsTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.store = Store(os.path.join(self.dir.name, "hub.db"))
        self.now = [time.mktime(time.strptime("20261114-120500", SEGMENT_NAME))]
        self.clips = Clips(self.dir.name, self.store, clock=lambda: self.now[0])
        self.camera = self.store.add_camera({"name": "Garage", "kind": "mjpeg", "address": "http://10.0.0.9"})

    def tearDown(self):
        self.store.close()
        self.dir.cleanup()

    def piece(self, name, video=False):
        path = os.path.join(self.clips.camera_dir(self.camera["id"]), name + ".mkv")
        if video:
            subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=160x120:rate=10",
                            "-t", "60", "-c:v", "libx264", "-preset", "ultrafast", "-g", "10", path], check=True)
        else:
            open(path, "w").close()
        return path

    def test_segments_are_listed_in_order(self):
        self.piece("20261114-120100")
        self.piece("20261114-120000")
        self.piece("not-a-recording")
        self.assertEqual([os.path.basename(p) for _, p in self.clips.segments(self.camera["id"])],
                         ["20261114-120000.mkv", "20261114-120100.mkv"])

    def test_names_cannot_leave_the_clips_folder(self):
        open(os.path.join(self.clips.clips, "7.mp4"), "w").close()
        self.assertTrue(self.clips.path("7.mp4"))
        for bad in ("../hub.db", "7.txt", "/etc/passwd", "missing.mp4", "../clips/7.mp4"):
            self.assertIsNone(self.clips.path(bad), bad)

    def test_old_recordings_and_events_are_deleted(self):
        old = self.piece("20261025-120000")
        recent = self.piece("20261114-110000")
        writing = self.piece("20261114-120400")
        old_event = self.store.add_event("motion", self.camera, started=self.now[0] - 20 * 86400, ended=self.now[0] - 20 * 86400 + 5)
        kept_event = self.store.add_event("motion", self.camera, started=self.now[0] - 3600, ended=self.now[0] - 3590)
        open(os.path.join(self.clips.clips, f"{old_event}.mp4"), "w").close()
        self.clips.sweep(free_bytes=lambda: 50 << 30)
        self.assertEqual([os.path.exists(p) for p in (old, recent, writing)], [False, True, True])
        self.assertEqual([e["id"] for e in self.store.events()], [kept_event])
        self.assertFalse(os.path.exists(os.path.join(self.clips.clips, f"{old_event}.mp4")))

    def test_a_full_disk_deletes_oldest_first_but_not_what_is_being_written(self):
        recent = self.piece("20261114-110000")
        writing = self.piece("20261114-120400")
        self.clips.sweep(free_bytes=lambda: 100 << 20)
        self.assertEqual([os.path.exists(p) for p in (recent, writing)], [False, True])

    @unittest.skipUnless(shutil.which("ffmpeg"), "needs ffmpeg")
    def test_clip_is_cut_from_the_recording(self):
        self.piece("20261114-120000", video=True)
        self.piece("20261114-120100", video=True)
        began = time.mktime(time.strptime("20261114-120050", SEGMENT_NAME))  # runs across the two pieces
        event_id = self.store.add_event("motion", self.camera, started=began, ended=began + 20)
        name = self.clips.make(event_id, wait=lambda seconds: None)
        self.assertEqual((name, self.store.event(event_id)["clip"]), (f"{event_id}.mp4", f"{event_id}.mp4"))
        probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
                                self.clips.path(name)], capture_output=True, text=True)
        self.assertAlmostEqual(float(probe.stdout), 32, delta=2.5)  # 8 s before + 20 s + 4 s after
        decoded = subprocess.run(["ffmpeg", "-v", "error", "-i", self.clips.path(name), "-frames:v", "1", "-f", "null", "-"],
                                 capture_output=True)
        self.assertEqual((decoded.returncode, decoded.stderr), (0, b""))
        self.assertTrue(self.clips.path(f"{event_id}.jpg"))

    def test_a_piece_from_before_a_restart_is_not_used(self):
        self.piece("20261114-090000")  # hours before the event, and nothing recorded in between
        event_id = self.store.add_event("motion", self.camera, started=self.now[0] - 100, ended=self.now[0] - 90)
        self.assertIsNone(self.clips.make(event_id, wait=lambda seconds: None))

    def test_no_recording_means_no_clip(self):
        event_id = self.store.add_event("motion", self.camera, started=self.now[0] - 100, ended=self.now[0] - 90)
        self.assertIsNone(self.clips.make(event_id, wait=lambda seconds: None))


class FakeBridge:
    available = True

    def add(self, camera, cameras):
        pass

    def remove(self, camera_id, cameras):
        pass


class FakeWatchers:
    def __init__(self):
        self.calls = []

    def sync(self):
        self.calls.append("sync")

    def refresh(self, camera_id=None):
        self.calls.append(("refresh", camera_id))


class RoutesTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.store = Store(os.path.join(self.dir.name, "hub.db"))
        self.clips = Clips(self.dir.name, self.store)
        self.hub = Hub(self.store, Pairing(), FakeBridge(), Monitor(self.store), "Test hub", 0, self.dir.name, clips=self.clips,
                       accounts=Accounts(self.store, log=lambda text: None))
        self.hub.watchers = FakeWatchers()
        self.server = make_server(self.hub, host="127.0.0.1")
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        login = {"email": "sam@example.com", "password": "correct horse battery"}
        self.call("POST", "/api/setup/first-admin", {"setup_code": self.hub.accounts.setup_code(), "name": "Sam", **login}, token=None)
        self.token = self.call("POST", "/api/auth/login/local?app=1", login, token=None)[1]["token"]
        self.camera = self.call("POST", "/api/cameras", {"kind": "mjpeg", "name": "Garage", "address": "10.0.0.9"})[1]

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.store.close()
        self.dir.cleanup()

    def call(self, method, path, body=None, token="", headers=None, raw=False):
        request = urllib.request.Request(self.base + path, data=json.dumps(body).encode() if body is not None else None,
                                         method=method, headers=headers or {})
        if token is not None:
            request.add_header("Authorization", f"Bearer {token or self.token}")
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                payload, status, got = response.read(), response.status, response.headers
        except urllib.error.HTTPError as err:
            payload, status, got = err.read(), err.code, err.headers
        return (status, payload, got) if raw else (status, json.loads(payload))

    def ticket(self):
        return self.call("POST", f"/api/cameras/{self.camera['id']}/ticket")[1]["ticket"]

    def test_settings(self):
        status, settings = self.call("GET", "/api/settings")
        self.assertEqual((status, settings), (200, {"keep_days": 14, "recording": True, "motion": True,
                                                    "cry": True, "cry_sensitivity": "Medium"}))
        status, settings = self.call("PATCH", "/api/settings", {"keep_days": 30, "cry_sensitivity": "High"})
        self.assertEqual((status, settings["keep_days"], settings["cry_sensitivity"]), (200, 30, "High"))
        self.assertEqual(self.hub.watchers.calls[-1], ("refresh", None))
        for bad in ({"keep_days": 0}, {"keep_days": "7"}, {"recording": "yes"}, {"cry_sensitivity": "Max"}, {"other": 1}):
            self.assertEqual(self.call("PATCH", "/api/settings", bad)[0], 400, bad)
        reopened = Store(os.path.join(self.dir.name, "hub.db"))
        self.assertEqual(reopened.settings()["keep_days"], 30)
        reopened.close()
        self.assertEqual(self.call("GET", "/api/settings", token=None)[0], 401)

    def test_zones(self):
        path = f"/api/cameras/{self.camera['id']}/zones"
        self.assertEqual(self.call("GET", path)[1], {"zones": [], "sensitivity": 60})
        status, saved = self.call("PUT", path, {"sensitivity": 80, "zones": [
            {"id": "porch", "name": "Porch", "action": "record only", "tone": "info", "points": [[0.1, 0.2], [1.4, 0.2], [0.5, -1]]}]})
        self.assertEqual(status, 200)
        self.assertEqual(saved["sensitivity"], 80)
        self.assertEqual(saved["zones"][0]["points"], [[0.1, 0.2], [1.0, 0.2], [0.5, 0.0]])  # kept inside the frame
        self.assertEqual(self.hub.watchers.calls[-1], ("refresh", self.camera["id"]))
        self.assertEqual(self.call("GET", path)[1], saved)
        for bad in ({"zones": "all"}, {"zones": [{"points": [[0, 0], [1, 1]]}]}, {"zones": [{"points": [[0, 0], [1, "x"], [1, 1]]}]}):
            self.assertEqual(self.call("PUT", path, bad)[0], 400, bad)
        self.assertEqual(self.call("GET", "/api/cameras/nope/zones")[0], 404)
        self.call("DELETE", f"/api/cameras/{self.camera['id']}")
        self.assertEqual(self.store.zones(self.camera["id"])["zones"], [])

    def test_events_can_be_filtered(self):
        cam = self.store.camera(self.camera["id"])
        old = self.store.add_event("motion", cam, started=1000, ended=1010, detail="Door zone")
        cry = self.store.add_event("crying", cam, started=2000, ended=2040)
        new = self.store.add_event("motion", cam, started=3000)
        ids = lambda q: [e["id"] for e in self.call("GET", "/api/events" + q)[1]["events"]]
        self.assertEqual(ids(""), [new, cry, old], "newest first")
        self.assertEqual(ids("?kind=motion"), [new, old])
        self.assertEqual(ids("?since=2000"), [new, cry], "since is inclusive")
        self.assertEqual(ids("?limit=1"), [new])
        self.assertEqual(ids("?limit=0"), [new], "at least one")
        self.assertEqual(ids("?since=1500&kind=motion"), [new])
        event = self.call("GET", "/api/events?kind=motion&since=0")[1]["events"][1]
        self.assertEqual({k: event[k] for k in ("kind", "camera_id", "camera", "started", "ended", "detail", "clip", "thumb")},
                         {"kind": "motion", "camera_id": cam["id"], "camera": "Garage", "started": 1000, "ended": 1010,
                          "detail": "Door zone", "clip": None, "thumb": None})
        self.assertIsNone(self.call("GET", "/api/events")[1]["events"][0]["ended"], "still going on")
        status, body = self.call("DELETE", f"/api/events/{old}")
        self.assertEqual((status, body), (200, {"removed": old}))
        self.assertEqual(self.call("DELETE", f"/api/events/{old}")[0], 404)
        self.assertEqual(self.call("DELETE", "/api/events/nope")[0], 404)

    def test_cameras_say_when_motion_is_going_on(self):
        self.assertFalse(self.call("GET", "/api/cameras")[1]["cameras"][0]["motion"])
        self.store.add_event("motion", self.store.camera(self.camera["id"]))
        self.assertTrue(self.call("GET", "/api/cameras")[1]["cameras"][0]["motion"])
        self.store.close_stale_events()
        self.assertFalse(self.call("GET", "/api/cameras")[1]["cameras"][0]["motion"])

    def test_clip_download_and_delete(self):
        event_id = self.store.add_event("crying", self.store.camera(self.camera["id"]), started=1000, ended=1040)
        with open(os.path.join(self.clips.clips, f"{event_id}.mp4"), "wb") as f:
            f.write(bytes(range(100)))
        self.store.set_event_clip(event_id, f"{event_id}.mp4")
        event = self.call("GET", "/api/events")[1]["events"][0]
        self.assertEqual((event["clip"], event["thumb"]), (f"{event_id}.mp4", f"{event_id}.jpg"))

        status, body, headers = self.call("GET", f"/api/clips/{event_id}.mp4?ticket={self.ticket()}", token=None, raw=True)
        self.assertEqual((status, len(body), headers["Content-Type"]), (200, 100, "video/mp4"))
        status, body, headers = self.call("GET", f"/api/clips/{event_id}.mp4", headers={"Range": "bytes=10-19"}, raw=True)
        self.assertEqual((status, body, headers["Content-Range"]), (206, bytes(range(10, 20)), "bytes 10-19/100"))
        status, body, _ = self.call("GET", f"/api/clips/{event_id}.mp4", headers={"Range": "bytes=90-"}, raw=True)
        self.assertEqual((status, body), (206, bytes(range(90, 100))))
        status, body, _ = self.call("GET", f"/api/clips/{event_id}.mp4", headers={"Range": "bytes=-5"}, raw=True)
        self.assertEqual((status, body), (206, bytes(range(95, 100))))
        self.assertEqual(self.call("GET", f"/api/clips/{event_id}.mp4", headers={"Range": "bytes=500-"}, raw=True)[0], 416)
        self.assertEqual(self.call("GET", f"/api/clips/{event_id}.mp4", token=None)[0], 401)
        self.assertEqual(self.call("GET", "/api/clips/..%2Fhub.db")[0], 404)

        self.assertEqual(self.call("DELETE", f"/api/events/{event_id}")[0], 200)
        self.assertEqual(self.call("GET", f"/api/clips/{event_id}.mp4")[0], 404)
        self.assertEqual(self.call("GET", "/api/events")[1]["events"], [])
        self.assertEqual(self.call("DELETE", "/api/events/999")[0], 404)


if __name__ == "__main__":
    unittest.main()
