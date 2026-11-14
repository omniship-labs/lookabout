"""Everything the hub remembers, in one SQLite file on the data volume."""

import hashlib
import json
import secrets
import sqlite3
import threading
import time

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cameras (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,          -- mjpeg | rtsp | usb
    address TEXT NOT NULL,       -- board address, stream address or /dev/videoN
    username TEXT NOT NULL DEFAULT '',
    password TEXT NOT NULL DEFAULT '',
    device TEXT NOT NULL DEFAULT '',   -- short label on the tile, e.g. ESP32
    source TEXT NOT NULL DEFAULT '',   -- line in Paired devices, e.g. "ESP32 via hub"
    created REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'online',
    since REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS viewers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'viewer',   -- the first viewer paired is the owner
    token_hash TEXT NOT NULL UNIQUE,
    created REAL NOT NULL,
    last_seen REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,          -- offline | motion | crying
    camera_id TEXT NOT NULL,
    camera_name TEXT NOT NULL,
    started REAL NOT NULL,
    ended REAL,                  -- NULL while it is still going on
    detail TEXT NOT NULL DEFAULT '',
    clip TEXT                    -- file name under clips/, once one exists
);
CREATE INDEX IF NOT EXISTS events_started ON events (started);
CREATE TABLE IF NOT EXISTS zones (
    camera_id TEXT PRIMARY KEY,
    zones TEXT NOT NULL,         -- JSON list of {id, name, action, tone, points}; points are 0..1 of the frame
    sensitivity INTEGER NOT NULL DEFAULT 60
);
"""

# Settings viewers can change, with their defaults and what each accepts.
SETTINGS = {
    "keep_days": (14, lambda v: isinstance(v, int) and not isinstance(v, bool) and 1 <= v <= 365),
    "recording": (True, lambda v: isinstance(v, bool)),
    "motion": (True, lambda v: isinstance(v, bool)),
    "cry": (True, lambda v: isinstance(v, bool)),
    "cry_sensitivity": ("Medium", lambda v: v in ("Low", "Medium", "High")),
}

CAMERA_COLUMNS = ("name", "kind", "address", "username", "password", "device", "source")


def hash_token(token):
    return hashlib.sha256(token.encode()).hexdigest()


class Store:
    def __init__(self, path):
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        with self._lock, self._db:
            self._db.executescript(SCHEMA)

    def _all(self, sql, args=()):
        with self._lock:
            return [dict(r) for r in self._db.execute(sql, args).fetchall()]

    def _one(self, sql, args=()):
        rows = self._all(sql, args)
        return rows[0] if rows else None

    def _run(self, sql, args=()):
        with self._lock, self._db:
            return self._db.execute(sql, args)

    # --- hub identity and settings -------------------------------------

    def meta(self, key, default=None):
        row = self._one("SELECT value FROM meta WHERE key = ?", (key,))
        return row["value"] if row else default

    def set_meta(self, key, value):
        self._run("INSERT INTO meta (key, value) VALUES (?, ?) "
                  "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, str(value)))

    def hub_id(self):
        """A stable id for this hub, made on first start."""
        with self._lock:
            hub_id = self.meta("hub_id")
            if not hub_id:
                hub_id = secrets.token_hex(8)
                self.set_meta("hub_id", hub_id)
            return hub_id

    def settings(self):
        saved = json.loads(self.meta("settings", "{}"))
        return {key: saved.get(key, default) for key, (default, _) in SETTINGS.items()}

    def update_settings(self, patch):
        """Applies the known, valid keys of `patch`. Returns the settings, or None if a value is wrong."""
        for key, value in patch.items():
            if key not in SETTINGS or not SETTINGS[key][1](value):
                return None
        with self._lock:
            self.set_meta("settings", json.dumps({**self.settings(), **patch}))
            return self.settings()

    # --- cameras --------------------------------------------------------

    def cameras(self):
        return self._all("SELECT * FROM cameras ORDER BY created")

    def camera(self, camera_id):
        return self._one("SELECT * FROM cameras WHERE id = ?", (camera_id,))

    def add_camera(self, fields):
        now = time.time()
        camera_id = "cam-" + secrets.token_hex(4)
        values = [fields.get(c, "") for c in CAMERA_COLUMNS]
        self._run(
            f"INSERT INTO cameras (id, {', '.join(CAMERA_COLUMNS)}, created, since) "
            f"VALUES (?, {', '.join('?' * len(CAMERA_COLUMNS))}, ?, ?)",
            [camera_id, *values, now, now],
        )
        return self.camera(camera_id)

    def rename_camera(self, camera_id, name):
        self._run("UPDATE cameras SET name = ? WHERE id = ?", (name, camera_id))

    def set_camera_status(self, camera_id, status, since):
        self._run("UPDATE cameras SET status = ?, since = ? WHERE id = ?", (status, since, camera_id))

    def remove_camera(self, camera_id):
        # Whatever was still going on for it (e.g. "offline") ends here.
        self._run("UPDATE events SET ended = ?, detail = 'Camera removed' WHERE camera_id = ? AND ended IS NULL",
                  (time.time(), camera_id))
        self._run("DELETE FROM zones WHERE camera_id = ?", (camera_id,))
        return self._run("DELETE FROM cameras WHERE id = ?", (camera_id,)).rowcount > 0

    def zones(self, camera_id):
        """Motion zones of a camera: {"zones": [...], "sensitivity": 0..100}. No zones means the whole frame."""
        row = self._one("SELECT zones, sensitivity FROM zones WHERE camera_id = ?", (camera_id,))
        return {"zones": json.loads(row["zones"]), "sensitivity": row["sensitivity"]} if row else {"zones": [], "sensitivity": 60}

    def set_zones(self, camera_id, zones, sensitivity):
        self._run("INSERT INTO zones (camera_id, zones, sensitivity) VALUES (?, ?, ?) "
                  "ON CONFLICT(camera_id) DO UPDATE SET zones = excluded.zones, sensitivity = excluded.sensitivity",
                  (camera_id, json.dumps(zones), sensitivity))

    # --- viewers --------------------------------------------------------

    def viewers(self):
        return self._all("SELECT id, name, platform, role, created, last_seen FROM viewers ORDER BY created")

    def add_viewer(self, name, platform):
        """Stores a new viewer and returns (viewer, token). Only the token's hash is kept."""
        token = secrets.token_urlsafe(32)
        viewer_id = "viewer-" + secrets.token_hex(4)
        now = time.time()
        with self._lock:
            role = "viewer" if self._one("SELECT 1 FROM viewers") else "owner"
            self._run(
                "INSERT INTO viewers (id, name, platform, role, token_hash, created, last_seen) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (viewer_id, name, platform, role, hash_token(token), now, now),
            )
        return self._one("SELECT id, name, platform, role, created, last_seen FROM viewers WHERE id = ?",
                         (viewer_id,)), token

    def viewer_for_token(self, token):
        if not token:
            return None
        viewer = self._one("SELECT id, name, role, last_seen FROM viewers WHERE token_hash = ?",
                           (hash_token(token),))
        if viewer and time.time() - viewer["last_seen"] > 60:
            self._run("UPDATE viewers SET last_seen = ? WHERE id = ?", (time.time(), viewer["id"]))
        return viewer

    def rename_viewer(self, viewer_id, name):
        return self._run("UPDATE viewers SET name = ? WHERE id = ?", (name, viewer_id)).rowcount > 0

    def remove_viewer(self, viewer_id):
        return self._run("DELETE FROM viewers WHERE id = ?", (viewer_id,)).rowcount > 0

    # --- events ---------------------------------------------------------

    def add_event(self, kind, camera, started=None, ended=None, detail=""):
        cur = self._run(
            "INSERT INTO events (kind, camera_id, camera_name, started, ended, detail) VALUES (?, ?, ?, ?, ?, ?)",
            (kind, camera["id"], camera["name"], started or time.time(), ended, detail),
        )
        return cur.lastrowid

    def end_event(self, event_id, ended=None, detail=None):
        self._run("UPDATE events SET ended = ?, detail = COALESCE(?, detail) WHERE id = ? AND ended IS NULL",
                  (ended or time.time(), detail, event_id))

    def close_stale_events(self):
        """After a restart nothing is watching the events that were going on; end them where they began."""
        self._run("UPDATE events SET ended = started WHERE ended IS NULL AND kind IN ('motion', 'crying')")

    def open_event(self, kind, camera_id):
        """The event of this kind that is still going on for a camera, if any."""
        return self._one(
            "SELECT * FROM events WHERE kind = ? AND camera_id = ? AND ended IS NULL ORDER BY started DESC LIMIT 1",
            (kind, camera_id),
        )

    def event(self, event_id):
        return self._one("SELECT * FROM events WHERE id = ?", (event_id,))

    def set_event_clip(self, event_id, clip):
        self._run("UPDATE events SET clip = ? WHERE id = ?", (clip, event_id))

    def remove_event(self, event_id):
        return self._run("DELETE FROM events WHERE id = ?", (event_id,)).rowcount > 0

    def events_before(self, when):
        return self._all("SELECT * FROM events WHERE started < ?", (when,))

    def events(self, since=0, kind=None, limit=200):
        sql, args = "SELECT * FROM events WHERE started >= ?", [since]
        if kind:
            sql += " AND kind = ?"
            args.append(kind)
        sql += " ORDER BY started DESC LIMIT ?"
        args.append(limit)
        return self._all(sql, args)
