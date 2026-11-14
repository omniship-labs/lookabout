"""Recordings on disk, and the clips cut from them for events.

    recordings/<camera id>/<YYYYMMDD-HHMMSS>.mkv   one-minute pieces, H.264
    clips/<event id>.mp4 and .jpg                  what the viewer plays

Recordings older than "Keep clips for" are deleted, oldest first, and
sooner than that when the disk is nearly full.
"""

import glob
import os
import queue
import shutil
import subprocess
import sys
import tempfile
import threading
import time

SEGMENT_SECONDS = 60
SEGMENT_NAME = "%Y%m%d-%H%M%S"
BEFORE, AFTER = 4, 4           # seconds of video kept around an event
LONGEST_CLIP = 180
MIN_FREE_BYTES = 1 << 30       # start deleting old recordings below 1 GB free
SWEEP_SECONDS = 600


class Clips:
    def __init__(self, data_dir, store, clock=time.time):
        self.store, self._clock = store, clock
        self.recordings = os.path.join(data_dir, "recordings")
        self.clips = os.path.join(data_dir, "clips")
        os.makedirs(self.recordings, exist_ok=True)
        os.makedirs(self.clips, exist_ok=True)
        self._jobs = queue.Queue()

    def start(self):
        threading.Thread(target=self._work, daemon=True).start()
        threading.Thread(target=self._sweep_loop, daemon=True).start()

    # --- recordings -----------------------------------------------------

    def camera_dir(self, camera_id):
        path = os.path.join(self.recordings, camera_id)
        os.makedirs(path, exist_ok=True)
        return path

    def segments(self, camera_id):
        """[(start time, path)] of a camera's recorded pieces, oldest first."""
        found = []
        for path in glob.glob(os.path.join(self.recordings, camera_id, "*.mkv")):
            try:
                started = time.mktime(time.strptime(os.path.basename(path)[:-4], SEGMENT_NAME))
            except ValueError:
                continue
            found.append((started, path))
        return sorted(found)

    # --- clips ----------------------------------------------------------

    def request(self, event_id):
        """Cut a clip for an event that has just ended."""
        self._jobs.put(event_id)

    def path(self, name):
        """Full path of a clip file by name, or None. Names never leave the clips folder."""
        if os.path.basename(name) != name or not name.endswith((".mp4", ".jpg")):
            return None
        path = os.path.join(self.clips, name)
        return path if os.path.isfile(path) else None

    def remove(self, event):
        for ext in (".mp4", ".jpg"):
            try:
                os.remove(os.path.join(self.clips, f"{event['id']}{ext}"))
            except OSError:
                pass

    def _work(self):
        while True:
            event_id = self._jobs.get()
            try:
                self.make(event_id)
            except Exception as err:  # one bad clip mustn't stop the rest
                print(f"Could not make the clip for event {event_id}: {err}", file=sys.stderr)

    def make(self, event_id, wait=time.sleep):
        event = self.store.event(event_id)
        if not event or not event["ended"]:
            return None
        start = event["started"] - BEFORE
        end = min(event["ended"] + AFTER, start + LONGEST_CLIP)
        # Let the recorder write the seconds after the event before cutting.
        late = end + 2 - self._clock()
        if late > 0:
            wait(late)

        pieces = self.segments(event["camera_id"])
        chosen = [(t, path) for i, (t, path) in enumerate(pieces)
                  if t < end and (pieces[i + 1][0] if i + 1 < len(pieces) else float("inf")) > start]
        if not chosen:
            return None  # recording was off, or already deleted
        name = f"{event_id}.mp4"
        out = os.path.join(self.clips, name)
        offset = max(0.0, start - chosen[0][0])
        with tempfile.NamedTemporaryFile("w", suffix=".txt", dir=self.clips, delete=False) as listing:
            for _, path in chosen:
                listing.write("file '" + path.replace("'", "'\\''") + "'\n")
        try:
            done = subprocess.run(
                ["ffmpeg", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0",
                 "-ss", f"{offset:.2f}", "-i", listing.name, "-t", f"{end - start:.2f}",
                 "-c:v", "copy", "-c:a", "aac", "-movflags", "+faststart", out],
                capture_output=True, timeout=120)
        finally:
            os.remove(listing.name)
        if done.returncode != 0 or not os.path.exists(out) or not os.path.getsize(out):
            raise RuntimeError(done.stderr.decode(errors="replace").strip()[-300:] or "ffmpeg made no file")
        # Thumbnail: the frame at the moment the event began.
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", str(min(BEFORE, max(0, end - start - 1))), "-i", out,
                        "-frames:v", "1", "-vf", "scale=320:-2", os.path.join(self.clips, f"{event_id}.jpg")],
                       capture_output=True, timeout=60)
        self.store.set_event_clip(event_id, name)
        return name

    # --- keeping the disk in check ---------------------------------------

    def _sweep_loop(self):
        while True:
            try:
                self.sweep()
            except Exception as err:
                print(f"Could not tidy recordings: {err}", file=sys.stderr)
            time.sleep(SWEEP_SECONDS)

    def sweep(self, free_bytes=None):
        """Deletes what is older than "Keep clips for", then more if the disk is nearly full."""
        cutoff = self._clock() - self.store.settings()["keep_days"] * 86400
        for event in self.store.events_before(cutoff):
            self.remove(event)
            self.store.remove_event(event["id"])
        every = sorted(piece for camera_id in os.listdir(self.recordings) for piece in self.segments(camera_id))
        free = free_bytes if free_bytes is not None else (lambda: shutil.disk_usage(self.recordings).free)
        newest = {}  # the piece each camera is writing right now stays
        for started, path in every:
            newest[os.path.dirname(path)] = path
        for started, path in every:
            if path == newest[os.path.dirname(path)]:
                continue
            if started + SEGMENT_SECONDS < cutoff or free() < MIN_FREE_BYTES:
                os.remove(path)
        for camera_id in os.listdir(self.recordings):
            folder = os.path.join(self.recordings, camera_id)
            if not os.listdir(folder) and not self.store.camera(camera_id):
                os.rmdir(folder)
