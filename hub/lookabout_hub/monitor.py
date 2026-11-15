"""Watches whether each camera can be reached and records when one drops out."""

import os
import socket
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit

CHECK_SECONDS = 15
MISSES_BEFORE_OFFLINE = 2  # one slow answer shouldn't raise an alarm


def reachable(camera, timeout=4):
    kind, address = camera["kind"], camera["address"]
    if kind == "usb":
        return os.path.exists(address)
    parts = urlsplit(address)
    if kind == "mjpeg":
        # ESP32 and Pi nodes answer /api/status; any http answer means the board is up.
        try:
            urllib.request.urlopen(f"{parts.scheme}://{parts.netloc}/api/status", timeout=timeout).close()
            return True
        except urllib.error.HTTPError:
            return True
        except (OSError, ValueError, urllib.error.URLError):
            return False
    try:
        socket.create_connection((parts.hostname, parts.port or 554), timeout=timeout).close()
        return True
    except (OSError, ValueError):
        return False


class Monitor:
    def __init__(self, store, check=reachable, clock=time.time):
        self.store = store
        self._check = check
        self._clock = clock
        self._misses = {}

    def start(self):
        threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self):
        while True:
            self.check_all()
            time.sleep(CHECK_SECONDS)

    def check_all(self):
        cameras = self.store.cameras()
        results = {}
        threads = [threading.Thread(target=lambda c=c: results.__setitem__(c["id"], self._check(c)), daemon=True)
                   for c in cameras]
        for t in threads:
            t.start()
        for t in threads:
            t.join(10)
        for camera in cameras:
            self._record(camera, results.get(camera["id"], False))

    def _record(self, camera, ok):
        camera_id, now = camera["id"], self._clock()
        if ok:
            self._misses.pop(camera_id, None)
            if camera["status"] != "online":
                self.store.set_camera_status(camera_id, "online", now)
                event = self.store.open_event("offline", camera_id)
                if event:
                    self.store.end_event(event["id"], now)
            return
        self._misses[camera_id] = self._misses.get(camera_id, 0) + 1
        if camera["status"] == "online" and self._misses[camera_id] >= MISSES_BEFORE_OFFLINE:
            self.store.set_camera_status(camera_id, "offline", now)
            self.store.add_event("offline", camera, started=now)

    def forget(self, camera_id):
        self._misses.pop(camera_id, None)
