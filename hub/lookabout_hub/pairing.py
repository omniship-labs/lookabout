"""Pairing codes shown on the hub's page.

A code is made by a signed-in admin for one member, lasts five minutes and
works once. The app that sends it gets a session for that member (a random
token it shows on every later request).
"""

import hmac
import secrets
import threading
import time

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O or 1/I to mix up when typing
CODE_SECONDS = 300
MAX_WRONG = 5


def normalize(code):
    return "".join(ch for ch in str(code).upper() if ch.isalnum())


class Pairing:
    def __init__(self, clock=time.time):
        self._clock = clock
        self._lock = threading.Lock()
        self._code = None
        self._expires = 0.0
        self._wrong = 0
        self._payload = None

    def new_code(self, payload=None):
        """Makes a fresh code, replacing any earlier one. `payload` (who it is for) comes back when it is used.
        Returns (code, seconds left)."""
        raw = "".join(secrets.choice(ALPHABET) for _ in range(8))
        with self._lock:
            self._code, self._payload = raw, payload
            self._expires = self._clock() + CODE_SECONDS
            self._wrong = 0
        return f"{raw[:4]}-{raw[4:]}", CODE_SECONDS

    def redeem(self, code):
        """True once for the current code. Five wrong tries cancel the code."""
        return self.claim(code)[0]

    def claim(self, code):
        """(True, payload) once for the current code, else (False, None)."""
        with self._lock:
            if not self._code or self._clock() > self._expires:
                self._code = None
                return False, None
            if hmac.compare_digest(normalize(code), self._code):
                payload, self._code = self._payload, None
                return True, payload
            self._wrong += 1
            if self._wrong >= MAX_WRONG:
                self._code = None
            return False, None
