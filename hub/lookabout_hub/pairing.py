"""Pairing codes shown on the hub's page.

A code is made when someone asks for one on the hub page, lasts five minutes
and works once. A viewer that sends it gets a key (a random token) that it
shows on every later request.
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

    def new_code(self):
        """Makes a fresh code, replacing any earlier one. Returns (code, seconds left)."""
        raw = "".join(secrets.choice(ALPHABET) for _ in range(8))
        with self._lock:
            self._code = raw
            self._expires = self._clock() + CODE_SECONDS
            self._wrong = 0
        return f"{raw[:4]}-{raw[4:]}", CODE_SECONDS

    def redeem(self, code):
        """True once for the current code. Five wrong tries cancel the code."""
        with self._lock:
            if not self._code or self._clock() > self._expires:
                self._code = None
                return False
            if hmac.compare_digest(normalize(code), self._code):
                self._code = None
                return True
            self._wrong += 1
            if self._wrong >= MAX_WRONG:
                self._code = None
            return False
