"""What the hub does with each camera around the clock: record it, watch it
for motion, and listen to it for crying.

One ffmpeg process per camera reads the camera from go2rtc, writes the
recording and hands small frames to the motion detector. Cameras with sound
get a second process that feeds the cry classifier.
"""

import os
import subprocess
import sys
import threading
import time

import numpy as np

from .clips import SEGMENT_NAME, SEGMENT_SECONDS
from .cry import SAMPLE_RATE, THRESHOLDS, WINDOW, CryTracker, pcm_to_samples
from .motion import FPS, FRAME_BYTES, HEIGHT, WIDTH, MotionDetector, MotionTracker

RETRY_SECONDS = 10
NO_SOUND_RETRY = 300   # a camera without sound is asked again this often


class Worker(threading.Thread):
    """Runs a command for a camera over and over until stopped."""

    def __init__(self, hub, camera):
        super().__init__(daemon=True)
        self.hub, self.camera = hub, camera
        self._stop_event = threading.Event()
        self._proc = None
        self._kicked = False

    def stop(self):
        self._stop_event.set()
        self.kick()

    def kick(self):
        """Ends the current process; the loop starts a fresh one with current settings."""
        self._kicked = True
        proc = self._proc
        if proc and proc.poll() is None:
            proc.terminate()

    def run(self):
        while not self._stop_event.is_set():
            wait = RETRY_SECONDS
            camera = self.hub.store.camera(self.camera["id"])
            if not camera:
                return
            if camera["status"] == "online":
                try:
                    wait = self.once(camera) or RETRY_SECONDS
                except Exception as err:  # keep watching the other cameras whatever happens
                    print(f"{type(self).__name__} for {camera['name']}: {err}", file=sys.stderr)
            if self._kicked:  # settings changed: start again straight away
                self._kicked, wait = False, 0.5
            self._stop_event.wait(wait)

    def spawn(self, command):
        self._proc = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        if self._stop_event.is_set():
            self._proc.terminate()
        return self._proc


class VideoWorker(Worker):
    """Recording and motion detection."""

    def __init__(self, hub, camera):
        super().__init__(hub, camera)
        # Only RTSP cameras can have sound. Asking go2rtc for sound a camera
        # doesn't send makes the whole request fail, so stop asking if it does.
        self.with_sound = camera["kind"] == "rtsp"

    def once(self, camera):
        began = time.time()
        try:
            return self.watch(camera)
        finally:
            if self.with_sound and time.time() - began < 5 and not self._kicked:
                self.with_sound = False

    def watch(self, camera):
        settings = self.hub.store.settings()
        record, motion = settings["recording"], settings["motion"]
        if not record and not motion:
            return 30
        source = self.hub.bridge.rtsp_url(camera["id"])
        command = ["ffmpeg", "-loglevel", "error", "-rtsp_transport", "tcp",
                   "-i", source + ("?video=h264" + ("&audio" if self.with_sound else "") if record else "?video")]
        if record:
            folder = self.hub.clips.camera_dir(camera["id"])
            # flush_packets: a quiet scene is so few bytes that ffmpeg would otherwise hold
            # them back for most of a minute, and a clip cut meanwhile finds an empty file.
            command += ["-map", "0", "-c", "copy", "-f", "segment",
                        "-segment_format_options", "flush_packets=1", "-segment_time", str(SEGMENT_SECONDS),
                        "-segment_format", "matroska", "-reset_timestamps", "1", "-strftime", "1",
                        os.path.join(folder, SEGMENT_NAME + ".mkv")]
        if motion:
            command += ["-map", "0:v:0", "-an", "-vf", f"fps={FPS},scale={WIDTH}:{HEIGHT},format=gray",
                        "-f", "rawvideo", "pipe:1"]
        proc = self.spawn(command)
        if not motion:
            proc.wait()
            return None

        zones = self.hub.store.zones(camera["id"])
        detector = MotionDetector(zones["zones"], zones["sensitivity"])
        open_event = {}

        def started(when, names):
            open_event["id"] = self.hub.store.add_event("motion", camera, started=when, detail=zone_label(names))

        def ended(when, names):
            event_id = open_event.pop("id", None)
            if event_id:
                self.hub.store.end_event(event_id, when, detail=zone_label(names))
                self.hub.clips.request(event_id)

        tracker = MotionTracker(started, ended)
        try:
            while True:
                data = proc.stdout.read(FRAME_BYTES)
                if len(data) < FRAME_BYTES:
                    break
                frame = np.frombuffer(data, dtype=np.uint8).reshape(HEIGHT, WIDTH)
                tracker.feed(time.time(), detector.feed(frame))
        finally:
            tracker.finish()
            proc.wait()
        return None


def zone_label(names):
    return " and ".join(f"{n} zone" for n in names[:2]) if names else ""


class SoundWorker(Worker):
    """Cry detection, for cameras that send sound."""

    def once(self, camera):
        settings = self.hub.store.settings()
        if not settings["cry"] or not self.hub.classifier:
            return 30
        threshold = THRESHOLDS[settings["cry_sensitivity"]]
        proc = self.spawn(["ffmpeg", "-loglevel", "error", "-rtsp_transport", "tcp",
                           "-i", self.hub.bridge.rtsp_url(camera["id"]) + "?audio",
                           "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "s16le", "pipe:1"])
        open_event = {}

        def started(when):
            open_event["id"] = self.hub.store.add_event("crying", camera, started=when)

        def ended(when):
            event_id = open_event.pop("id", None)
            if event_id:
                self.hub.store.end_event(event_id, when)
                self.hub.clips.request(event_id)

        tracker = CryTracker(started, ended)
        heard = False
        try:
            while True:
                data = proc.stdout.read(WINDOW * 2)
                if len(data) < WINDOW * 2:
                    break
                heard = True
                score = self.hub.classifier.score(pcm_to_samples(data))
                tracker.feed(time.time(), score >= threshold)
        finally:
            tracker.finish()
            proc.wait()
        return None if heard else NO_SOUND_RETRY


class Watchers:
    """Keeps one set of workers per camera in step with the camera list and settings."""

    def __init__(self, hub):
        self.hub = hub
        self._workers = {}
        self._lock = threading.Lock()

    def sync(self):
        """Call after cameras are added or removed."""
        with self._lock:
            cameras = {c["id"]: c for c in self.hub.store.cameras()}
            for camera_id in list(self._workers):
                if camera_id not in cameras:
                    for worker in self._workers.pop(camera_id):
                        worker.stop()
            for camera_id, camera in cameras.items():
                if camera_id not in self._workers:
                    workers = [VideoWorker(self.hub, camera)]
                    if camera["kind"] == "rtsp":  # ESP32 / Pi nodes and USB webcams send no sound
                        workers.append(SoundWorker(self.hub, camera))
                    for worker in workers:
                        worker.start()
                    self._workers[camera_id] = workers

    def refresh(self, camera_id=None):
        """Call after settings (all cameras) or one camera's zones change."""
        with self._lock:
            for key, workers in self._workers.items():
                if camera_id in (None, key):
                    for worker in workers:
                        worker.kick()

    def stop(self):
        with self._lock:
            for workers in self._workers.values():
                for worker in workers:
                    worker.stop()
            self._workers = {}
