"""Tests for the Raspberry Pi camera node. Standard library only, like the node.

    cd firmware/rpi && python3 -m unittest discover -s tests
"""

import json
import os
import sys
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from lookabout_rpi import __main__ as node  # noqa: E402

A = b"\xff\xd8frame-a\xff\xd9"
B = b"\xff\xd8frame-b\xff\xd9"


class SplitJpegsTest(unittest.TestCase):
    def test_whole_frames_come_out_in_order(self):
        self.assertEqual(node.split_jpegs(A + B), ([A, B], b""))

    def test_a_half_frame_waits_for_the_rest(self):
        frames, rest = node.split_jpegs(A + B[:5])
        self.assertEqual((frames, rest), ([A], B[:5]))
        self.assertEqual(node.split_jpegs(rest + B[5:]), ([B], b""))

    def test_junk_before_a_frame_is_dropped(self):
        self.assertEqual(node.split_jpegs(b"garbage" + A), ([A], b""))
        self.assertEqual(node.split_jpegs(b"no frame here"), ([], b""))

    def test_a_marker_split_across_reads_is_kept(self):
        # The first byte of the start marker arrives at the end of one read.
        frames, rest = node.split_jpegs(b"junk\xff")
        self.assertEqual((frames, rest), ([], b"\xff"))
        self.assertEqual(node.split_jpegs(rest + A[1:]), ([A], b""))

    def test_an_end_marker_split_across_reads(self):
        frames, rest = node.split_jpegs(A[:-1])
        self.assertEqual(frames, [])
        self.assertEqual(node.split_jpegs(rest + A[-1:]), ([A], b""))


class CameraCommandTest(unittest.TestCase):
    def which(self, present):
        return lambda tool: f"/usr/bin/{tool}" if tool in present else None

    def test_pi_camera_module_wins_in_auto(self):
        with mock.patch.object(node.shutil, "which", self.which({"rpicam-vid", "ffmpeg"})), \
                mock.patch.object(node.os.path, "exists", return_value=True):
            name, argv = node.camera_command("auto", "/dev/video0", 1280, 720, 15)
        self.assertEqual(name, "Pi camera module")
        self.assertEqual(argv[0], "/usr/bin/rpicam-vid")
        self.assertIn("mjpeg", argv)
        self.assertEqual(argv[argv.index("--width") + 1], "1280")
        self.assertEqual(argv[-2:], ["--output", "-"])

    def test_older_libcamera_tool(self):
        with mock.patch.object(node.shutil, "which", self.which({"libcamera-vid"})):
            name, argv = node.camera_command("pi", "/dev/video0", 640, 480, 10)
        self.assertEqual((name, argv[0]), ("Pi camera module", "/usr/bin/libcamera-vid"))

    def test_usb_webcam_through_ffmpeg(self):
        with mock.patch.object(node.shutil, "which", self.which({"ffmpeg", "rpicam-vid"})), \
                mock.patch.object(node.os.path, "exists", return_value=True):
            name, argv = node.camera_command("usb", "/dev/video2", 640, 480, 10)
        self.assertEqual(name, "USB webcam")
        self.assertEqual(argv[argv.index("-i") + 1], "/dev/video2")
        self.assertEqual(argv[argv.index("-video_size") + 1], "640x480")

    def test_nothing_found(self):
        with mock.patch.object(node.shutil, "which", self.which(set())):
            self.assertIsNone(node.camera_command("auto", "/dev/video0", 1280, 720, 15))
        with mock.patch.object(node.shutil, "which", self.which({"ffmpeg"})), \
                mock.patch.object(node.os.path, "exists", return_value=False):
            self.assertIsNone(node.camera_command("usb", "/dev/video0", 1280, 720, 15))
        with mock.patch.object(node.shutil, "which", self.which({"rpicam-vid"})):
            self.assertIsNone(node.camera_command("usb", "/dev/video0", 1280, 720, 15), "asked for USB, got none")


class CameraTest(unittest.TestCase):
    def test_keeps_the_newest_frame_from_the_command(self):
        # Writes two frames and stays running, like rpicam-vid; killed by the test.
        script = f"import sys,time; sys.stdout.buffer.write({A + B!r}); sys.stdout.flush(); time.sleep(30)"
        procs = []
        real_popen = node.subprocess.Popen

        def popen(*args, **kwargs):
            procs.append(real_popen(*args, **kwargs))
            return procs[-1]

        with mock.patch.object(node.subprocess, "Popen", popen):
            camera = node.Camera([sys.executable, "-c", script], 640, 480, 10)
            deadline = time.time() + 5
            while camera.frame != B and time.time() < deadline:
                time.sleep(0.02)
        for proc in procs:
            proc.kill()
        self.assertEqual(camera.frame, B, "the newest complete frame is kept")
        self.assertTrue(camera.connected)
        self.assertEqual(camera.wait_frame(camera.seq, timeout=0.1), (None, camera.seq), "nothing newer yet")
        frame, seq = camera.wait_frame(-1, timeout=0.1)
        self.assertEqual(frame, B)


class FakeCamera:
    def __init__(self, frame):
        self.frame, self.connected = frame, frame is not None
        self.width, self.height, self.fps = 640, 480, 10
        self.started = time.time() - 42

    def wait_frame(self, seq, timeout=2.0):
        if self.frame is None:
            time.sleep(min(timeout, 0.05))
            return None, seq
        return self.frame, seq + 1


class ServerTest(unittest.TestCase):
    def serve(self, camera):
        server = ThreadingHTTPServer(("127.0.0.1", 0), node.make_handler(camera, "Garage", "USB webcam"))
        server.daemon_threads = True
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return f"http://127.0.0.1:{server.server_address[1]}"

    def get(self, url):
        try:
            with urllib.request.urlopen(url, timeout=5) as res:
                return res.status, res.headers, res.read()
        except urllib.error.HTTPError as err:
            return err.code, err.headers, err.read()

    def test_status_matches_what_the_viewers_read(self):
        base = self.serve(FakeCamera(A))
        status, headers, body = self.get(base + "/api/status")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Access-Control-Allow-Origin"], "*", "viewers on other origins read it")
        info = json.loads(body)
        self.assertEqual(
            {k: info[k] for k in ("name", "firmware", "camera", "source", "width", "height", "fps", "viewers", "online")},
            {"name": "Garage", "firmware": node.VERSION, "camera": True, "source": "USB webcam",
             "width": 640, "height": 480, "fps": 10, "viewers": 0, "online": True})
        self.assertGreaterEqual(info["uptime_s"], 42)

    def test_snapshot(self):
        status, headers, body = self.get(self.serve(FakeCamera(A)) + "/snapshot.jpg?t=123")
        self.assertEqual((status, headers["Content-Type"], body), (200, "image/jpeg", A))
        self.assertEqual(self.get(self.serve(FakeCamera(None)) + "/snapshot.jpg")[0], 503)

    def test_stream_sends_frames_as_multipart(self):
        base = self.serve(FakeCamera(A))
        with urllib.request.urlopen(base + "/stream", timeout=5) as res:
            self.assertEqual(res.headers["Content-Type"], f"multipart/x-mixed-replace;boundary={node.BOUNDARY}")
            head = res.read(200)
        self.assertTrue(head.startswith(f"--{node.BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: {len(A)}\r\n\r\n".encode()))
        self.assertIn(A, head)

    def test_too_many_viewers(self):
        base = self.serve(FakeCamera(A))
        with mock.patch.object(node, "MAX_VIEWERS", 0):
            self.assertEqual(self.get(base + "/stream")[0], 503)

    def test_page_and_unknown_paths(self):
        base = self.serve(FakeCamera(A))
        status, headers, body = self.get(base + "/")
        self.assertEqual(status, 200)
        self.assertIn(b"<img src=/stream", body)
        self.assertEqual(self.get(base + "/nope")[0], 404)


if __name__ == "__main__":
    unittest.main()
