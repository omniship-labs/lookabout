"""Motion detection by comparing small greyscale frames, inside drawn zones.

Each frame (160x120) is compared with a slowly updating picture of the
empty scene. A zone has motion when enough of its pixels differ for two
frames in a row. With no zones drawn the whole frame is one zone.
"""

import numpy as np

WIDTH, HEIGHT = 160, 120
FRAME_BYTES = WIDTH * HEIGHT
FPS = 4
PIXEL_CHANGE = 22          # grey levels (of 255) a pixel must move to count as changed
SCENE_CHANGE = 0.5         # more of the frame than this changing at once is a light going on, not motion
BACKGROUND_RATE = 0.05     # how fast the empty-scene picture follows the camera
FRAMES_TO_CONFIRM = 2
QUIET_SECONDS = 8          # motion is over after this long without any
LONGEST_EVENT = 120        # a scene that never settles (a tree in the wind) gets one event, not an endless one


def zone_mask(points, width=WIDTH, height=HEIGHT):
    """Pixels inside a polygon whose corners are fractions (0..1) of the frame."""
    ys, xs = np.mgrid[0:height, 0:width]
    px, py = (xs + 0.5) / width, (ys + 0.5) / height
    inside = np.zeros((height, width), dtype=bool)
    count = len(points)
    for i in range(count):
        (x1, y1), (x2, y2) = points[i], points[(i + 1) % count]
        if y1 == y2:
            continue
        crosses = ((y1 > py) != (y2 > py)) & (px < (x2 - x1) * (py - y1) / (y2 - y1) + x1)
        inside ^= crosses
    return inside


def share_needed(sensitivity):
    """Share of a zone that must change: 8% at sensitivity 0, 0.4% at 100."""
    return 0.08 * 0.05 ** (min(max(sensitivity, 0), 100) / 100)


class MotionDetector:
    def __init__(self, zones=(), sensitivity=60):
        self.zones = [(z.get("name") or "Zone", zone_mask(z["points"])) for z in zones if len(z.get("points", ())) >= 3]
        self.zones = [(name, mask) for name, mask in self.zones if mask.any()]
        if not self.zones:
            self.zones = [("", np.ones((HEIGHT, WIDTH), dtype=bool))]
        self.needed = share_needed(sensitivity)
        self.background = None
        self.streak = [0] * len(self.zones)

    def feed(self, frame):
        """Takes one frame (HEIGHT x WIDTH, uint8). Returns the names of zones with motion right now."""
        frame = frame.astype(np.float32)
        if self.background is None:
            self.background = frame
            return []
        changed = np.abs(frame - self.background) > PIXEL_CHANGE
        if changed.mean() > SCENE_CHANGE:
            self.background = frame
            self.streak = [0] * len(self.zones)
            return []
        self.background += BACKGROUND_RATE * (frame - self.background)
        moving = []
        for i, (name, mask) in enumerate(self.zones):
            self.streak[i] = self.streak[i] + 1 if changed[mask].mean() >= self.needed else 0
            if self.streak[i] >= FRAMES_TO_CONFIRM:
                moving.append(name)
        return moving


class MotionTracker:
    """Turns frame-by-frame motion into events with a start and an end."""

    def __init__(self, on_start, on_end):
        self.on_start, self.on_end = on_start, on_end
        self.active = False
        self.began = 0.0
        self.last_motion = 0.0
        self.names = []
        self.same_motion = False  # the event was cut short and the motion hasn't stopped since

    def feed(self, now, moving):
        if moving:
            self.last_motion = now
            if self.same_motion:
                return
            self.names.extend(n for n in moving if n and n not in self.names)
            if not self.active:
                self.active, self.began = True, now
                self.on_start(now, list(self.names))
            elif now - self.began >= LONGEST_EVENT:
                self.finish()
                self.same_motion = True
        elif now - self.last_motion >= QUIET_SECONDS:
            self.same_motion = False
            self.finish()

    def finish(self):
        """Ends the event at the last motion seen (also when the camera stops)."""
        if self.active:
            self.active = False
            self.on_end(self.last_motion, list(self.names))
            self.names = []
