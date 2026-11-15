"""Tests for the per-camera workers (watcher.py):  python3 -m unittest discover -s tests

Needs numpy (imported by watcher.py). No ffmpeg or go2rtc: the workers' own
commands are replaced by stand-ins.
"""

import os
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from lookabout_hub import watcher  # noqa: E402
from lookabout_hub.store import Store  # noqa: E402


class FakeHub:
    def __init__(self, store):
        self.store = store


class Recorder:
    """Stands in for VideoWorker / SoundWorker and records what Watchers does with it."""

    made = []

    def __init__(self, hub, camera):
        self.camera_id, self.kind = camera["id"], type(self).__name__
        self.calls = []
        Recorder.made.append(self)

    def start(self):
        self.calls.append("start")

    def stop(self):
        self.calls.append("stop")

    def kick(self):
        self.calls.append("kick")


class FakeVideo(Recorder):
    pass


class FakeSound(Recorder):
    pass


class WatchersTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.store = Store(os.path.join(self.dir.name, "hub.db"))
        Recorder.made = []
        patches = [mock.patch.object(watcher, "VideoWorker", FakeVideo), mock.patch.object(watcher, "SoundWorker", FakeSound)]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.watchers = watcher.Watchers(FakeHub(self.store))

    def tearDown(self):
        self.store.close()
        self.dir.cleanup()

    def add(self, kind, name):
        return self.store.add_camera({"name": name, "kind": kind, "address": f"{name}.local"})

    def workers(self, camera):
        return [w for w in Recorder.made if w.camera_id == camera["id"]]

    def test_sound_only_for_cameras_that_send_it(self):
        board, rtsp, usb = self.add("mjpeg", "board"), self.add("rtsp", "porch"), self.add("usb", "desk")
        self.watchers.sync()
        self.assertEqual([w.kind for w in self.workers(board)], ["FakeVideo"])
        self.assertEqual([w.kind for w in self.workers(rtsp)], ["FakeVideo", "FakeSound"])
        self.assertEqual([w.kind for w in self.workers(usb)], ["FakeVideo"])
        self.assertTrue(all(w.calls == ["start"] for w in Recorder.made))

    def test_sync_starts_new_cameras_and_stops_removed_ones_only(self):
        a = self.add("rtsp", "a")
        self.watchers.sync()
        b = self.add("mjpeg", "b")
        self.watchers.sync()
        self.assertEqual(len(Recorder.made), 3, "a's workers aren't started twice")
        self.store.remove_camera(a["id"])
        self.watchers.sync()
        self.assertTrue(all(w.calls == ["start", "stop"] for w in self.workers(a)))
        self.assertEqual(self.workers(b)[0].calls, ["start"])

    def test_refresh_kicks_one_camera_or_all(self):
        a, b = self.add("mjpeg", "a"), self.add("rtsp", "b")
        self.watchers.sync()
        self.watchers.refresh(a["id"])
        self.assertEqual(self.workers(a)[0].calls, ["start", "kick"])
        self.assertTrue(all(w.calls == ["start"] for w in self.workers(b)))
        self.watchers.refresh()
        self.assertTrue(all(w.calls[-1] == "kick" for w in Recorder.made))

    def test_stop_stops_everything(self):
        self.add("mjpeg", "a"), self.add("rtsp", "b")
        self.watchers.sync()
        self.watchers.stop()
        self.assertTrue(all(w.calls == ["start", "stop"] for w in Recorder.made))
        self.watchers.sync()
        self.assertEqual(len(Recorder.made), 6, "sync after stop starts them afresh")


class CountingWorker(watcher.Worker):
    """A Worker whose once() just counts, optionally failing first."""

    def __init__(self, hub, camera, fail_first=False):
        super().__init__(hub, camera)
        self.runs = 0
        self.fail_first = fail_first
        self.ran = threading.Event()

    def once(self, camera):
        self.runs += 1
        self.ran.set()
        if self.fail_first and self.runs == 1:
            raise RuntimeError("ffmpeg fell over")
        return 0.01


class WorkerLoopTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.store = Store(os.path.join(self.dir.name, "hub.db"))
        self.camera = self.store.add_camera({"name": "porch", "kind": "rtsp", "address": "rtsp://porch.local/1"})
        self.hub = FakeHub(self.store)
        # Cleanups run last-added first, so workers stop before the store closes.
        self.addCleanup(self.dir.cleanup)
        self.addCleanup(self.store.close)

    def start(self, worker):
        worker.start()
        self.addCleanup(lambda: (worker.stop(), worker.join(2)))
        return worker

    def test_runs_again_and_again_until_stopped(self):
        worker = self.start(CountingWorker(self.hub, self.camera))
        deadline = time.time() + 3
        while worker.runs < 3 and time.time() < deadline:
            time.sleep(0.01)
        self.assertGreaterEqual(worker.runs, 3)
        worker.stop()
        worker.join(2)
        self.assertFalse(worker.is_alive())

    def test_an_error_doesnt_end_the_worker(self):
        with mock.patch.object(watcher, "RETRY_SECONDS", 0.01), mock.patch("sys.stderr"):
            worker = self.start(CountingWorker(self.hub, self.camera, fail_first=True))
            deadline = time.time() + 3
            while worker.runs < 2 and time.time() < deadline:
                time.sleep(0.01)
        self.assertGreaterEqual(worker.runs, 2)

    def test_offline_camera_is_not_watched(self):
        self.store.set_camera_status(self.camera["id"], "offline", time.time())
        with mock.patch.object(watcher, "RETRY_SECONDS", 0.01):
            worker = self.start(CountingWorker(self.hub, self.camera))
            time.sleep(0.2)
        self.assertEqual(worker.runs, 0)

    def test_removed_camera_ends_the_worker(self):
        self.store.remove_camera(self.camera["id"])
        worker = self.start(CountingWorker(self.hub, self.camera))
        worker.join(2)
        self.assertFalse(worker.is_alive())
        self.assertEqual(worker.runs, 0)

    def test_kick_ends_the_running_command(self):
        worker = CountingWorker(self.hub, self.camera)
        proc = worker.spawn([sys.executable, "-c", "import time; time.sleep(30)"])
        worker.kick()
        self.assertIsNotNone(proc.wait(5), "the process was terminated")
        proc.stdout.close()

    def test_stop_before_spawn_doesnt_leave_a_process_running(self):
        worker = CountingWorker(self.hub, self.camera)
        worker.stop()
        proc = worker.spawn([sys.executable, "-c", "import time; time.sleep(30)"])
        self.assertIsNotNone(proc.wait(5))
        proc.stdout.close()


class ZoneLabelTest(unittest.TestCase):
    def test_names_up_to_two_zones(self):
        self.assertEqual(watcher.zone_label([]), "")
        self.assertEqual(watcher.zone_label(["Door"]), "Door zone")
        self.assertEqual(watcher.zone_label(["Door", "Gate", "Path"]), "Door zone and Gate zone")


if __name__ == "__main__":
    unittest.main()
