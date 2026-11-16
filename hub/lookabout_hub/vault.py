"""Keeps provider secrets (Google's client secret, Apple's key) encrypted on the data volume.

The key lives in its own file under keys/, so a copy of the database alone
doesn't hold them. Anyone with the whole volume has both: this protects
copies of the database, not a stolen SD card (docs/hub-auth.md, Q5).
"""

import os

from cryptography.fernet import Fernet, InvalidToken


class Vault:
    def __init__(self, folder):
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, "vault.key")
        if not os.path.exists(path):
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as f:
                f.write(Fernet.generate_key())
        with open(path, "rb") as f:
            self._fernet = Fernet(f.read().strip())

    def seal(self, text):
        return self._fernet.encrypt(text.encode()).decode()

    def open(self, sealed):
        """The text, or "" when it can't be opened (another key, or damaged)."""
        try:
            return self._fernet.decrypt(sealed.encode()).decode()
        except (InvalidToken, ValueError):
            return ""
