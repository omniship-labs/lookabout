"""The ESP32 camera firmware, run in QEMU and driven over HTTP.

Build the images first (qemu/build.sh, inside ESP-IDF), then:

    python3 firmware/esp32/qemu/test_board.py

The emulator build swaps Wi-Fi for QEMU's emulated Ethernet and the USB webcam
for a generated test picture (CONFIG_LOOKABOUT_EMULATOR). Everything else is
the real firmware: NVS settings, the web server, the viewer limit, and the
over-Wi-Fi update into the second app slot. It runs on QEMU's classic ESP32
machine, whose network emulation is the reliable one; the code under test
doesn't depend on the chip.

Settings, by environment variable:
    QEMU          qemu-system-xtensa binary (default: from PATH)
    LK_FLASH      flash image (default qemu/out/flash.bin)
    LK_UPDATE     update image (default qemu/out/update-emu-b.bin)
    LK_LOGS       folder for each board's serial log (default qemu/out/logs)
    LK_BOOT_S     seconds to wait for a boot (default 120)
"""

import http.client
import json
import os
import re
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
QEMU = os.environ.get("QEMU") or shutil.which("qemu-system-xtensa") or "qemu-system-xtensa"
FLASH = os.environ.get("LK_FLASH", os.path.join(HERE, "out", "flash.bin"))
UPDATE = os.environ.get("LK_UPDATE", os.path.join(HERE, "out", "update-emu-b.bin"))
LOGS = os.environ.get("LK_LOGS", os.path.join(HERE, "out", "logs"))
BOOT_S = float(os.environ.get("LK_BOOT_S", "120"))

BOOTED = "Lookabout camera firmware"
ONLINE = "Online. Camera address"
# What the firmware logs just before esp_restart() (Wi-Fi saved, update done).
RESTARTING = re.compile(r"(Wi-Fi details saved|Firmware updated), restarting")


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Board:
    """One emulated board with its own copy of the flash. Restarts like a board would."""

    def __init__(self, name, flash=None):
        self.name = name
        self.dir = tempfile.mkdtemp(prefix="lk-board-")
        self.flash = os.path.join(self.dir, "flash.bin")
        shutil.copyfile(flash or FLASH, self.flash)
        self.port = None
        self.proc = None
        self.log = []
        self._lock = threading.Lock()
        self._on = False
        self._boot_at = 0  # where in the log the current QEMU run started

    # --- the emulator ---------------------------------------------------

    def power_on(self):
        self.port = self.port or free_port()
        self._on = True
        self._launch()
        self.wait_ready(boots=self.boots() + 1)
        return self

    def _launch(self):
        # -no-reboot: QEMU's ESP32 doesn't come back cleanly from a software
        # reset (it panics early in the next boot), so a restart makes QEMU
        # exit and _read_log starts it again from the same flash, like a
        # board coming back up.
        with self._lock:
            self._boot_at = len(self.log)
        self.proc = subprocess.Popen([
            QEMU, "-nographic", "-no-reboot", "-machine", "esp32",
            "-drive", f"file={self.flash},if=mtd,format=raw",
            "-nic", f"user,model=open_eth,hostfwd=tcp:127.0.0.1:{self.port}-:80",
            "-global", "driver=timer.esp32.timg,property=wdt_disable,value=true",
        ], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        threading.Thread(target=self._read_log, args=(self.proc,), daemon=True).start()

    def power_off(self):
        """Pulls the plug: no shutdown, whatever was being written stays half-written."""
        self._on = False
        if self.proc and self.proc.poll() is None:
            self.proc.kill()
            self.proc.wait(10)
        self.proc = None

    def close(self):
        self.power_off()
        os.makedirs(LOGS, exist_ok=True)
        with open(os.path.join(LOGS, f"{self.name}.log"), "w", errors="replace") as f:
            f.write("".join(self.log))
        shutil.rmtree(self.dir, ignore_errors=True)

    def _read_log(self, proc):
        for raw in iter(proc.stdout.readline, b""):
            with self._lock:
                self.log.append(raw.decode(errors="replace"))
        proc.stdout.close()
        proc.wait()
        # The firmware asked for a restart: bring the board back up. Anything
        # else (a crash) leaves it down, and the test waiting on it fails.
        with self._lock:
            this_run = "".join(self.log[self._boot_at:])
        if self._on and proc is self.proc and RESTARTING.search(this_run):
            self._launch()

    def text(self):
        with self._lock:
            return "".join(self.log)

    def boots(self):
        return self.text().count(BOOTED)

    def wait_log(self, pattern, count=1, timeout=BOOT_S):
        deadline = time.time() + timeout
        while time.time() < deadline:
            if len(re.findall(pattern, self.text())) >= count:
                return
            proc = self.proc
            if proc and proc.poll() is not None and proc is self.proc and not RESTARTING.search(self.text()[-4000:]):
                raise AssertionError(f"QEMU stopped (exit {self.proc.returncode}). Log:\n{self.text()[-3000:]}")
            time.sleep(0.2)
        raise AssertionError(f"Waited {timeout:.0f} s for {pattern!r} x{count}. Log:\n{self.text()[-3000:]}")

    def wait_ready(self, boots):
        """Waits for boot number `boots` to get an address and answer HTTP."""
        self.wait_log(re.escape(BOOTED), boots)
        self.wait_log(re.escape(ONLINE), boots)
        deadline = time.time() + 30
        while True:
            try:
                return self.status()
            except OSError:
                if time.time() > deadline:
                    raise
                time.sleep(0.5)

    # --- HTTP -----------------------------------------------------------

    def connect(self, timeout=20):
        return http.client.HTTPConnection("127.0.0.1", self.port, timeout=timeout)

    def request(self, method, path, body=None, headers=None, timeout=30):
        conn = self.connect(timeout)
        try:
            conn.request(method, path, body=body, headers=headers or {})
            res = conn.getresponse()
            return res.status, dict(res.getheaders()), res.read()
        finally:
            conn.close()

    def status(self):
        status, headers, body = self.request("GET", "/api/status", timeout=10)
        assert status == 200, (status, body)
        return json.loads(body)


def read_part(res):
    """Reads one part of a multipart MJPEG stream: (headers, jpeg)."""
    line = res.readline()
    while line in (b"\r\n", b""):
        if line == b"":
            raise EOFError("stream ended")
        line = res.readline()
    assert line.strip() == b"--lookaboutframe", line
    headers = {}
    while (line := res.readline()) not in (b"\r\n", b""):
        key, _, value = line.decode().partition(":")
        headers[key.strip().lower()] = value.strip()
    return headers, res.read(int(headers["content-length"]))


def comment(jpeg):
    """The "frame 0000042" comment the emulator puts in each frame."""
    match = re.search(rb"frame \d{7}", jpeg[:40])
    return match.group().decode() if match else None


class BoardTest(unittest.TestCase):
    """A fresh board per test."""

    def setUp(self):
        self.board = Board(self.id().split(".")[-1])
        self.addCleanup(self.board.close)
        self.board.power_on()

    def run(self, result=None):
        # On a failure, print the end of the board's serial log, so CI output has it.
        result = result if result is not None else self.defaultTestResult()
        before = len(result.failures) + len(result.errors)
        super().run(result)
        board = getattr(self, "board", None)
        if len(result.failures) + len(result.errors) > before and board is not None:
            print(f"\n----- serial log of {board.name} (last 4000 chars) -----\n"
                  + board.text()[-4000:] + "\n-----", flush=True)
        return result


class FreshBoardTest(BoardTest):
    """What a just-flashed board answers, before any setup. One boot for all of these."""

    board = None

    @classmethod
    def setUpClass(cls):
        cls.board = Board("fresh-board").power_on()

    @classmethod
    def tearDownClass(cls):
        cls.board.close()

    def setUp(self):
        pass

    def test_status(self):
        status, headers, body = self.board.request("GET", "/api/status")
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), "*", "viewers on other origins read it")
        info = json.loads(body)
        self.assertEqual(
            {k: info[k] for k in ("name", "firmware", "camera", "width", "height", "fps", "online", "setup", "rssi")},
            {"name": "lookabout-cam", "firmware": "emu-a", "camera": True, "width": 160, "height": 120,
             "fps": 10, "online": True, "setup": True, "rssi": 0})
        self.assertEqual(info["ip"], "10.0.2.15", "QEMU's network hands out this address")
        self.assertIsInstance(info["uptime_s"], int)

    def test_setup_page(self):
        status, headers, body = self.board.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn(b"<form class=card method=post action=/api/wifi>", body)
        self.assertIn(b"fetch('/api/status')", body)

    def test_snapshot_is_one_whole_jpeg(self):
        status, headers, body = self.board.request("GET", "/snapshot.jpg?t=1")
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("Content-Type"), "image/jpeg")
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), "*")
        self.assertEqual((body[:2], body[-2:]), (b"\xff\xd8", b"\xff\xd9"))
        self.assertIsNotNone(comment(body))

    def test_stream_sends_new_frames(self):
        conn = self.board.connect()
        conn.request("GET", "/stream")
        res = conn.getresponse()
        self.assertEqual(res.status, 200)
        self.assertEqual(res.getheader("Content-Type"), "multipart/x-mixed-replace;boundary=lookaboutframe")
        seen = []
        for _ in range(3):
            headers, jpeg = read_part(res)
            self.assertEqual(headers["content-type"], "image/jpeg")
            self.assertEqual((jpeg[:2], jpeg[-2:]), (b"\xff\xd8", b"\xff\xd9"))
            seen.append(comment(jpeg))
        conn.close()
        self.assertEqual(len(set(seen)), 3, f"each part is a newer frame: {seen}")

    def test_four_viewers_at_most(self):
        streams = []
        try:
            for _ in range(4):
                conn = self.board.connect()
                conn.request("GET", "/stream")
                res = conn.getresponse()
                self.assertEqual(res.status, 200)
                read_part(res)
                # Keep the response: it owns the socket, and dropping it would end the stream.
                streams.append((conn, res))
            self.assertEqual(self.board.status()["viewers"], 4)
            status, _, body = self.board.request("GET", "/stream")
            self.assertEqual((status, body), (503, b"Too many viewers"))
            conn, res = streams.pop()
            res.close()
            conn.close()
            deadline = time.time() + 10
            while self.board.status()["viewers"] != 3 and time.time() < deadline:
                time.sleep(0.2)
            self.assertEqual(self.board.status()["viewers"], 3, "a viewer that leaves frees its place")
        finally:
            for conn, res in streams:
                res.close()
                conn.close()

    def test_wifi_form_is_checked(self):
        self.assertEqual(self.board.request("POST", "/api/wifi", b"")[0], 400)
        self.assertEqual(self.board.request("POST", "/api/wifi", b"ssid=&pass=x")[0], 400)
        self.assertEqual(self.board.request("POST", "/api/wifi", b"ssid=" + b"x" * 33)[0], 400)
        self.assertEqual(self.board.request("POST", "/api/wifi", b"ssid=Home&pass=" + b"p" * 65)[0], 400)
        self.assertEqual(self.board.status()["setup"], True, "nothing was saved")

    def test_update_preflight(self):
        status, headers, _ = self.board.request("OPTIONS", "/api/update")
        self.assertEqual(status, 204)
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), "*")
        self.assertIn("POST", headers.get("Access-Control-Allow-Methods", ""))

    def test_update_refuses_a_file_that_isnt_firmware(self):
        status, _, body = self.board.request("POST", "/api/update", os.urandom(4096),
                                             {"Content-Type": "application/octet-stream"})
        self.assertEqual(status, 400)
        self.assertIn(b"not a valid Lookabout firmware image", body)
        self.assertEqual(self.board.status()["firmware"], "emu-a")

    def test_update_refuses_a_file_too_big_for_the_slot(self):
        # The server only calls the handler once some of the body is in, so
        # send a first piece, as any uploader would.
        conn = self.board.connect()
        conn.putrequest("POST", "/api/update")
        conn.putheader("Content-Length", str(64 * 1024 * 1024))
        conn.endheaders()
        conn.send(b"\xe9" + bytes(4095))
        res = conn.getresponse()
        self.assertEqual(res.status, 400)
        self.assertIn(b"too large", res.read())
        conn.close()


class WifiSetupTest(BoardTest):
    def test_details_and_name_survive_the_restart(self):
        status, _, body = self.board.request("POST", "/api/wifi", b"ssid=Home+Wi-Fi&pass=s3cret%21&name=Garage+Cam%21",
                                             {"Content-Type": "application/x-www-form-urlencoded"})
        self.assertEqual(status, 200)
        self.assertIn(b"Saved", body)
        info = self.board.wait_ready(boots=2)
        self.assertEqual(info["name"], "garage-cam", "spaces become hyphens, other characters go")
        self.assertEqual(info["setup"], False, "Wi-Fi details are saved")
        self.assertIn('Wi-Fi "Home Wi-Fi" saved', self.board.text())


class UpdateTest(BoardTest):
    def image(self):
        with open(UPDATE, "rb") as f:
            return f.read()

    def send_part(self, image, fraction):
        """Starts an upload and stops partway, leaving the connection open."""
        conn = self.board.connect(timeout=60)
        conn.putrequest("POST", "/api/update")
        conn.putheader("Content-Type", "application/octet-stream")
        conn.putheader("Content-Length", str(len(image)))
        conn.endheaders()
        conn.send(image[: int(len(image) * fraction)])
        return conn

    def test_new_firmware_is_running_after_the_restart(self):
        status, _, body = self.board.request("POST", "/api/update", self.image(),
                                             {"Content-Type": "application/octet-stream"}, timeout=300)
        self.assertEqual((status, json.loads(body)), (200, {"ok": True}))
        self.assertEqual(self.board.wait_ready(boots=2)["firmware"], "emu-b")
        self.assertIn("Firmware updated, restarting", self.board.text())

    def test_an_upload_cut_off_keeps_the_old_firmware(self):
        conn = self.send_part(self.image(), 0.5)
        conn.close()
        deadline = time.time() + 20
        while time.time() < deadline:
            try:
                self.assertEqual(self.board.status()["firmware"], "emu-a")
                break
            except OSError:
                time.sleep(0.5)
        time.sleep(3)
        self.assertEqual(self.board.boots(), 1, "no restart")
        self.assertEqual(self.board.status()["firmware"], "emu-a")

    def test_power_cut_mid_update_keeps_the_old_firmware(self):
        conn = self.send_part(self.image(), 0.6)
        time.sleep(2)  # let some of it reach the flash
        self.board.power_off()
        conn.close()
        self.board.power_on()
        self.assertEqual(self.board.status()["firmware"], "emu-a")


if __name__ == "__main__":
    for path in (FLASH, UPDATE):
        if not os.path.exists(path):
            raise SystemExit(f"{path} is missing: run qemu/build.sh inside ESP-IDF first.")
    unittest.main(verbosity=2)
