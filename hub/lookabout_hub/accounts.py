"""Who may use the hub: members, sessions, camera groups and what each can see.

This is the hub half of docs/hub-auth.md. Local accounts (email and password)
are here; passkeys, Google and Apple sign-in are not built yet.
"""

import hashlib
import hmac
import secrets
import sys
import threading
import time

DAY = 86400
SESSION_DAYS, REMOTE_SESSION_DAYS = 30, 7      # Q1: shorter while remote access is on
INVITE_DAYS = 7
TICKET_SECONDS = 300
AUDIT_DAYS = 90
MAX_FAILURES, FAILURE_WINDOW = 10, 900          # 10 failed sign-ins in 15 minutes lock that account from that address
MAX_SETUP_WRONG = 5
MIN_PASSWORD, STRONG_PASSWORD = 10, 14
COMMON_PASSWORDS = frozenset("""password1234 1234567890 qwertyuiop 0123456789 password123 iloveyou123
    letmein1234 welcome1234 admin12345 changeme123 11111111111 passw0rd123""".split())
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

CODES = {400: "bad_request", 401: "not_signed_in", 403: "admin_only", 404: "not_found", 409: "conflict",
         413: "too_large", 423: "setup_required", 429: "too_many_tries", 502: "bad_gateway"}


class Problem(Exception):
    """Ends a request early: a status, a sentence for the person and a code for the app."""

    def __init__(self, status, message, code=None, retry_after=None):
        super().__init__(message)
        self.status, self.message, self.retry_after = status, message, retry_after
        self.code = code or CODES.get(status, "error")


def hash_secret(value):
    return hashlib.sha256(value.encode()).hexdigest()


def hash_password(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)
    return f"scrypt$16384$8$1${salt.hex()}${digest.hex()}"


def check_password(password, stored):
    try:
        scheme, n, r, p, salt, digest = stored.split("$")
        if scheme != "scrypt":
            return False
        got = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p), dklen=32)
        return hmac.compare_digest(got.hex(), digest)
    except (ValueError, TypeError):
        return False


DUMMY = hash_password("not-a-real-password")   # compared against when the email is unknown, so timing doesn't tell


def clean_email(value):
    email = str(value or "").strip().lower()
    if not 3 <= len(email) <= 120 or email.count("@") != 1 or email.startswith("@") or email.endswith("@") or " " in email:
        raise Problem(400, "Enter a valid email address.")
    return email


def check_new_password(password):
    if not isinstance(password, str) or len(password) < MIN_PASSWORD:
        raise Problem(400, f"Use a password of at least {MIN_PASSWORD} characters.")
    if password.lower() in COMMON_PASSWORDS or len(set(password)) < 4:
        raise Problem(400, "That password is too easy to guess. Try a longer one.")


def public_member(row):
    return {"id": row["id"], "name": row["name"], "email": row["email"], "role": row["role"]}


class Accounts:
    def __init__(self, store, clock=time.time, log=None):
        self.store, self._clock = store, clock
        self._log = log or (lambda text: print(text, file=sys.stderr, flush=True))
        self._lock = threading.RLock()
        self._failures = {}        # (email, address) -> times of failed sign-ins
        self._tickets = {}         # ticket hash -> (member id, camera id, expires)
        self._setup_code, self._setup_wrong = None, 0

    # --- setup code and first admin --------------------------------------

    def setup_needed(self):
        return not self.store._one("SELECT 1 FROM members")

    def legacy_only(self):
        """Pairing keys from before accounts exist, and no admin yet: they keep working, read-only."""
        return self.setup_needed() and bool(self.store.viewers())

    def setup_code(self):
        with self._lock:
            if not self._setup_code:
                raw = "".join(secrets.choice(ALPHABET) for _ in range(8))
                self._setup_code, self._setup_wrong = raw, 0
                self._log(f"Setup code for the first admin: {raw[:4]}-{raw[4:]}")
            return f"{self._setup_code[:4]}-{self._setup_code[4:]}"

    def _check_setup_code(self, code):
        with self._lock:
            if not self._setup_code:
                raise Problem(403, "Ask the hub for a setup code first.", "bad_code")
            given = "".join(ch for ch in str(code).upper() if ch.isalnum())
            if hmac.compare_digest(given, self._setup_code):
                self._setup_code = None
                return
            self._setup_wrong += 1
            if self._setup_wrong >= MAX_SETUP_WRONG:
                self._setup_code = None
                self.setup_code()          # a fresh one, in the log
            raise Problem(403, "That setup code is wrong.", "bad_code")

    def first_admin(self, code, name, email, password):
        email = clean_email(email)
        check_new_password(password)
        name = str(name or "").strip()[:40] or email.split("@")[0]
        with self._lock:
            if not self.setup_needed():
                raise Problem(409, "This hub already has an admin.")
            self._check_setup_code(code)
            member = self._add_member(name, email, "admin", "active", password)
            ended = self.store.clear_viewers()          # Q8: old pairing keys end here
        self.audit(member["id"], "first-admin", f"Pairing keys ended: {ended}")
        return member

    # --- members ----------------------------------------------------------

    def _add_member(self, name, email, role, status, password=""):
        member_id = "m-" + secrets.token_hex(3)
        now = self._clock()
        self.store._run(
            "INSERT INTO members (id, name, email, role, status, password_hash, strong, created, last_seen, invited) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)",
            (member_id, name, email, role, status, hash_password(password) if password else "",
             int(len(password) >= STRONG_PASSWORD), now, now if status == "invited" else 0))
        return self.member(member_id)

    def member(self, member_id):
        return self.store._one("SELECT * FROM members WHERE id = ?", (member_id,))

    def members(self):
        return self.store._all("SELECT * FROM members ORDER BY created, id")

    def admins(self):
        return self.store._all("SELECT * FROM members WHERE role = 'admin' AND status = 'active'")

    def _last_admin(self, member_id):
        admins = self.admins()
        return len(admins) == 1 and admins[0]["id"] == member_id

    def update_member(self, member_id, patch):
        member = self.member(member_id)
        if not member:
            raise Problem(404, "The hub has no such member.")
        role = patch.get("role", member["role"])
        if role not in ("admin", "member"):
            raise Problem(400, "A role is admin or member.")
        if role != "admin" and member["role"] == "admin" and self._last_admin(member_id):
            raise Problem(409, "The hub needs at least one admin.")
        if role == "admin" and member["status"] != "active":
            raise Problem(409, "Only someone who has signed in can be an admin.")
        name = str(patch["name"]).strip()[:40] if "name" in patch else member["name"]
        if "grants" in patch:
            grants = self._clean_grants(patch["grants"])
        with self._lock:
            self.store._run("UPDATE members SET role = ?, name = ? WHERE id = ?", (role, name, member_id))
            if "grants" in patch:
                self._set_grants(member_id, grants, by=None)
        return self.member(member_id)

    def remove_member(self, member_id):
        member = self.member(member_id)
        if not member:
            raise Problem(404, "The hub has no such member.")
        if member["status"] == "active" and self._last_admin(member_id):
            raise Problem(409, "The hub needs at least one admin.")
        with self._lock:
            self.store._run("DELETE FROM sessions WHERE member_id = ?", (member_id,))
            self.store._run("DELETE FROM grants WHERE member_id = ?", (member_id,))
            self.store._run("DELETE FROM members WHERE id = ?", (member_id,))

    def set_name(self, member_id, name):
        name = str(name or "").strip()[:40]
        if not name:
            raise Problem(400, "Enter a name.")
        self.store._run("UPDATE members SET name = ? WHERE id = ?", (name, member_id))

    def change_password(self, member, current, new):
        if not check_password(str(current or ""), member["password_hash"]):
            raise Problem(403, "That isn't your current password.", "wrong_password")
        check_new_password(new)
        self.store._run("UPDATE members SET password_hash = ?, strong = ? WHERE id = ?",
                        (hash_password(new), int(len(new) >= STRONG_PASSWORD), member["id"]))

    def strong(self, member):
        """Q3: what remote access needs of every admin. (Passkeys will count here too.)"""
        return bool(member["strong"])

    # --- sign-in ----------------------------------------------------------

    def _lifetime(self):
        return (REMOTE_SESSION_DAYS if self.remote() else SESSION_DAYS) * DAY

    def remote(self):
        return self.store.meta("remote_access") == "1"

    def set_remote(self, on):
        """Switching remote access on shortens the sessions that already exist."""
        self.store.set_meta("remote_access", "1" if on else "0")
        if on:
            self.store._run("UPDATE sessions SET expires = MIN(expires, ?)", (self._clock() + REMOTE_SESSION_DAYS * DAY,))

    def login(self, email, password, address, kind="browser", device=""):
        email = str(email or "").strip().lower()
        key, now = (email, address), self._clock()
        with self._lock:
            recent = [t for t in self._failures.get(key, []) if now - t < FAILURE_WINDOW]
            self._failures[key] = recent
            if len(recent) >= MAX_FAILURES:
                wait = max(1, int(recent[0] + FAILURE_WINDOW - now))
                raise Problem(429, "Too many tries. Wait a while and try again.", retry_after=wait)
        member = self.store._one("SELECT * FROM members WHERE email = ?", (email,))
        stored = member["password_hash"] if member and member["status"] == "active" else DUMMY
        if not check_password(str(password or ""), stored) or not member or member["status"] != "active":
            with self._lock:
                self._failures.setdefault(key, []).append(now)
            self.audit(member["id"] if member else "", "sign-in-failed", f"{email} from {address}")
            raise Problem(401, "That email and password don't match.", "bad_sign_in")
        with self._lock:
            self._failures.pop(key, None)
        token = self.create_session(member["id"], kind, device)
        self.audit(member["id"], "sign-in", f"{kind} from {address}")
        return member, token

    def create_session(self, member_id, kind, device=""):
        token = secrets.token_urlsafe(32)
        now = self._clock()
        self.store._run(
            "INSERT INTO sessions (id, member_id, token_hash, kind, device, created, last_seen, expires) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            ("s-" + secrets.token_hex(3), member_id, hash_secret(token), kind, str(device or "")[:60],
             now, now, now + self._lifetime()))
        self.store._run("UPDATE members SET last_seen = ? WHERE id = ?", (now, member_id))
        return token

    def session_for(self, token):
        """(session, member) for a live session token, extending it when it is in its last days."""
        if not token:
            return None
        row = self.store._one(
            "SELECT s.id AS sid, s.kind, s.device, s.expires, s.last_seen AS seen, m.* FROM sessions s "
            "JOIN members m ON m.id = s.member_id WHERE s.token_hash = ? AND m.status = 'active'",
            (hash_secret(token),))
        if not row:
            return None
        now = self._clock()
        if row["expires"] <= now:
            self.store._run("DELETE FROM sessions WHERE id = ?", (row["sid"],))
            return None
        slide = (2 if self.remote() else 7) * DAY
        expires = row["expires"]
        if expires - now < slide:
            expires = now + self._lifetime()
        if expires != row["expires"] or now - row["seen"] > 60:
            self.store._run("UPDATE sessions SET expires = ?, last_seen = ? WHERE id = ?", (expires, now, row["sid"]))
            self.store._run("UPDATE members SET last_seen = ? WHERE id = ?", (now, row["id"]))
        session = {"id": row["sid"], "kind": row["kind"], "device": row["device"], "expires": expires}
        member = {k: row[k] for k in ("id", "name", "email", "role", "status", "strong")}
        return session, member

    def sessions(self, member_id=None):
        sql = ("SELECT s.id, s.member_id, m.name AS member, s.kind, s.device, s.created, s.last_seen, s.expires "
               "FROM sessions s JOIN members m ON m.id = s.member_id")
        args = ()
        if member_id:
            sql, args = sql + " WHERE s.member_id = ?", (member_id,)
        return self.store._all(sql + " ORDER BY s.created", args)

    def end_session(self, session_id, member_id=None):
        sql, args = "DELETE FROM sessions WHERE id = ?", [session_id]
        if member_id:
            sql, args = sql + " AND member_id = ?", [session_id, member_id]
        return self.store._run(sql, args).rowcount > 0

    # --- invites ----------------------------------------------------------

    def invite(self, email, role, grants, by):
        email = clean_email(email)
        if role not in ("admin", "member"):
            raise Problem(400, "A role is admin or member.")
        grants = self._clean_grants(grants)
        if self.store._one("SELECT 1 FROM members WHERE email = ?", (email,)):
            raise Problem(409, "That email is already part of this household.")
        member = self._add_member("", email, role, "invited")
        self._set_grants(member["id"], grants, by=by)
        token = self._new_invite(member["id"])
        self.audit(by, "invite", email)
        return self.member(member["id"]), token

    def _new_invite(self, member_id):
        token = secrets.token_urlsafe(24)
        self.store._run("UPDATE members SET invite_hash = ?, invite_expires = ? WHERE id = ?",
                        (hash_secret(token), self._clock() + INVITE_DAYS * DAY, member_id))
        return token

    def cancel_invite(self, member_id):
        member = self.member(member_id)
        if not member or member["status"] != "invited":
            raise Problem(404, "There is no such invite.")
        self.store._run("DELETE FROM grants WHERE member_id = ?", (member_id,))
        self.store._run("DELETE FROM members WHERE id = ?", (member_id,))

    def accept_invite(self, token, name, password, address, device="", kind="browser"):
        check_new_password(password)
        member = self.store._one("SELECT * FROM members WHERE invite_hash = ? AND status = 'invited'",
                                 (hash_secret(str(token or "")),))
        if not member or member["invite_expires"] < self._clock():
            raise Problem(404, "This invite link has run out or was already used. Ask for a new one.", "bad_invite")
        name = str(name or "").strip()[:40] or member["email"].split("@")[0]
        self.store._run("UPDATE members SET name = ?, password_hash = ?, strong = ?, status = 'active', "
                        "invite_hash = '', invite_expires = 0 WHERE id = ?",
                        (name, hash_password(password), int(len(password) >= STRONG_PASSWORD), member["id"]))
        session = self.create_session(member["id"], kind, device)
        self.audit(member["id"], "invite-accepted", f"from {address}")
        return self.member(member["id"]), session

    # --- camera groups and grants ----------------------------------------

    def _clean_grants(self, grants):
        if not isinstance(grants, list):
            raise Problem(400, "Grants should be a list.")
        seen = {}
        for grant in grants:
            group, level = (grant.get("group"), grant.get("level")) if isinstance(grant, dict) else (None, None)
            if level not in ("view", "manage") or not self.group(group):
                raise Problem(400, "A grant needs an existing group and a level of view or manage.")
            seen[group] = "manage" if "manage" in (level, seen.get(group)) else "view"
        return seen

    def _set_grants(self, member_id, grants, by):
        self.store._run("DELETE FROM grants WHERE member_id = ?", (member_id,))
        for group, level in grants.items():
            self.store._run("INSERT INTO grants (member_id, group_id, level, by) VALUES (?, ?, ?, ?)",
                            (member_id, group, level, by or ""))

    def grants(self, member_id):
        return self.store._all("SELECT group_id AS \"group\", level, by FROM grants WHERE member_id = ? ORDER BY group_id",
                               (member_id,))

    def group(self, group_id):
        return self.store._one("SELECT * FROM groups WHERE id = ?", (group_id,)) if group_id else None

    def groups(self):
        rows = self.store._all("SELECT * FROM groups ORDER BY name, id")
        return [{**g, "cameras": self.group_cameras(g["id"])} for g in rows]

    def group_cameras(self, group_id):
        return [r["camera_id"] for r in self.store._all(
            "SELECT camera_id FROM group_cameras WHERE group_id = ? ORDER BY camera_id", (group_id,))]

    def _check_cameras(self, cameras):
        known = {c["id"] for c in self.store.cameras()}
        if not isinstance(cameras, list) or any(c not in known for c in cameras):
            raise Problem(400, "Those cameras aren't all on the hub.")
        return sorted(set(cameras))

    def add_group(self, name, cameras):
        name = str(name or "").strip()[:40]
        if not name:
            raise Problem(400, "Enter a name.")
        cameras = self._check_cameras(cameras or [])
        group_id = "g-" + secrets.token_hex(3)
        self.store._run("INSERT INTO groups (id, name) VALUES (?, ?)", (group_id, name))
        self.set_group_cameras(group_id, cameras)
        return {"id": group_id, "name": name, "cameras": cameras}

    def update_group(self, group_id, patch):
        if not self.group(group_id):
            raise Problem(404, "The hub has no such group.")
        if "name" in patch:
            name = str(patch["name"] or "").strip()[:40]
            if not name:
                raise Problem(400, "Enter a name.")
            self.store._run("UPDATE groups SET name = ? WHERE id = ?", (name, group_id))
        if "cameras" in patch:
            self.set_group_cameras(group_id, self._check_cameras(patch["cameras"]))
        return next(g for g in self.groups() if g["id"] == group_id)

    def set_group_cameras(self, group_id, cameras):
        self.store._run("DELETE FROM group_cameras WHERE group_id = ?", (group_id,))
        for camera_id in cameras:
            self.store._run("INSERT INTO group_cameras (group_id, camera_id) VALUES (?, ?)", (group_id, camera_id))

    def remove_group(self, group_id):
        if not self.group(group_id):
            raise Problem(404, "The hub has no such group.")
        for table in ("grants", "group_cameras"):
            self.store._run(f"DELETE FROM {table} WHERE group_id = ?", (group_id,))
        self.store._run("DELETE FROM groups WHERE id = ?", (group_id,))

    def levels(self, member):
        """{camera id: "view" | "manage"} for a member, or "all" for an admin."""
        if member["role"] == "admin":
            return "all"
        rows = self.store._all(
            "SELECT gc.camera_id, g.level FROM grants g JOIN group_cameras gc ON gc.group_id = g.group_id "
            "WHERE g.member_id = ?", (member["id"],))
        out = {}
        for row in rows:
            out[row["camera_id"]] = "manage" if "manage" in (row["level"], out.get(row["camera_id"])) else "view"
        return out

    def group_levels(self, member):
        if member["role"] == "admin":
            return "all"
        return [{"id": g["group_id"], "name": g["name"], "level": g["level"]} for g in self.store._all(
            "SELECT g.group_id, gr.name, g.level FROM grants g JOIN groups gr ON gr.id = g.group_id "
            "WHERE g.member_id = ? ORDER BY gr.name", (member["id"],))]

    def share(self, group_id, target_id, by):
        if not self.group(group_id):
            raise Problem(404, "The hub has no such group.")
        target = self.member(target_id)
        if not target or target["status"] != "active":
            raise Problem(404, "The hub has no such member.")
        if self.store._one("SELECT 1 FROM grants WHERE member_id = ? AND group_id = ?", (target_id, group_id)):
            raise Problem(409, "They can already see this group.")
        self.store._run("INSERT INTO grants (member_id, group_id, level, by) VALUES (?, ?, 'view', ?)",
                        (target_id, group_id, by["id"]))
        self.audit(by["id"], "share", f"{group_id} with {target_id}")

    def unshare(self, group_id, target_id, by):
        row = self.store._one("SELECT * FROM grants WHERE member_id = ? AND group_id = ? AND level = 'view'",
                              (target_id, group_id))
        if not row:
            raise Problem(404, "They don't have a shared view of this group.")
        if by["role"] != "admin" and row["by"] != by["id"]:
            raise Problem(403, "Only whoever shared this, or an admin, can take it back.", "not_yours")
        self.store._run("DELETE FROM grants WHERE member_id = ? AND group_id = ?", (target_id, group_id))
        self.audit(by["id"], "unshare", f"{group_id} from {target_id}")

    # --- media tickets ----------------------------------------------------

    def ticket(self, member_id, camera_id):
        """A five-minute pass for one camera, for places that can't send a cookie or header."""
        raw, now = secrets.token_urlsafe(24), self._clock()
        with self._lock:
            self._tickets = {h: t for h, t in self._tickets.items() if t[2] > now}
            self._tickets[hash_secret(raw)] = (member_id, camera_id, now + TICKET_SECONDS)
        return raw, now + TICKET_SECONDS

    def ticket_member(self, raw, camera_id):
        """The member a ticket was made for, if it is live and for this camera and they still see it."""
        found = self._tickets.get(hash_secret(raw or ""))
        if not found or found[2] <= self._clock() or found[1] != camera_id:
            return None
        member = self.member(found[0])
        return member if member and member["status"] == "active" else None

    # --- audit -------------------------------------------------------------

    def audit(self, actor, action, detail=""):
        now = self._clock()
        self.store._run("INSERT INTO audit (at, actor, action, detail) VALUES (?, ?, ?, ?)",
                        (now, actor or "", action, str(detail)[:200]))
        self.store._run("DELETE FROM audit WHERE at < ?", (now - AUDIT_DAYS * DAY,))

    def audit_log(self, limit=200):
        return self.store._all("SELECT at, actor, action, detail FROM audit ORDER BY at DESC, id DESC LIMIT ?", (limit,))
