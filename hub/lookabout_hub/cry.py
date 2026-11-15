"""Cry detection on cameras that send sound.

Each second of sound goes through YAMNet (an open audio classifier, run
with LiteRT). Crying that keeps going for 20 seconds becomes an event:
shorter bursts are a cough, a shout or a stir.
"""

import threading
import zipfile

import numpy as np

SAMPLE_RATE = 16000
WINDOW = 15600                 # samples YAMNet takes at once (0.975 s)
CRY_LABELS = ("Crying, sobbing", "Baby cry, infant cry")
CRY_INDEXES = (19, 20)         # where those labels sit if the model file doesn't list them
THRESHOLDS = {"Low": 0.5, "Medium": 0.25, "High": 0.12}
ALERT_AFTER = 20               # seconds of crying before it counts
BREATH = 4                     # a pause this short is still the same cry
OVER_AFTER = 10                # seconds of quiet that end the event


class Yamnet:
    def __init__(self, model_path):
        from ai_edge_litert.interpreter import Interpreter
        self._interpreter = Interpreter(model_path=model_path)
        self._interpreter.allocate_tensors()
        self._input = self._interpreter.get_input_details()[0]["index"]
        self._output = self._interpreter.get_output_details()[0]["index"]
        self._lock = threading.Lock()
        self._classes = list(CRY_INDEXES)
        try:  # the model file carries its label list as an attached file
            with zipfile.ZipFile(model_path) as attached:
                labels = attached.read(attached.namelist()[0]).decode().splitlines()
            found = [labels.index(label) for label in CRY_LABELS if label in labels]
            self._classes = found or self._classes
        except (zipfile.BadZipFile, IndexError, OSError):
            pass

    def score(self, samples):
        """How much one window of sound (WINDOW float32 samples, -1..1) sounds like crying, 0..1."""
        with self._lock:
            self._interpreter.set_tensor(self._input, samples.astype(np.float32))
            self._interpreter.invoke()
            scores = self._interpreter.get_tensor(self._output)[0]
        return float(max(scores[i] for i in self._classes))


def load_classifier(model_path):
    """The classifier, or None with the reason when this machine can't run it."""
    try:
        return Yamnet(model_path), ""
    except ImportError:
        return None, "the LiteRT package is not installed"
    except (OSError, ValueError) as err:
        return None, f"the model file could not be loaded ({err})"


def pcm_to_samples(pcm):
    """Signed 16-bit little-endian sound -> float32 samples in -1..1."""
    return np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0


class CryTracker:
    """The 20-second rule."""

    def __init__(self, on_start, on_end):
        self.on_start, self.on_end = on_start, on_end
        self.began = None        # when the current run of crying started
        self.last = 0.0          # when crying was last heard
        self.active = False

    def feed(self, now, crying):
        if crying:
            if not self.active and (self.began is None or now - self.last > BREATH):
                self.began = now  # a new run of crying
            self.last = now
            if not self.active and now - self.began >= ALERT_AFTER:
                self.active = True
                self.on_start(self.began)
        elif self.active and now - self.last >= OVER_AFTER:
            self.finish()
        elif not self.active and self.began is not None and now - self.last > BREATH:
            self.began = None

    def finish(self):
        if self.active:
            self.active = False
            self.on_end(self.last)
        self.began = None
