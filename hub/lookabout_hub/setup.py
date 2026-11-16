"""The setup wizards' side of the hub (docs/hub-auth.md, "Setup wizards"): flows, steps, and the checks that
run on the hub. Progress is kept on the hub, so a flow can be carried on from another device and the health
panel can show how every flow stands.

Each check says, before it runs (`plan`), which host it contacts and what it sends. Nothing here contacts
anything else.
"""

import json
import os
import re
import shutil
import socket
import ssl
import tempfile
import threading
import time
import urllib.parse

from .accounts import Problem
from .discovery import local_addresses
from .oidc import PROVIDERS, apple_client_secret

# flow -> (steps in order, the ones that are a manual confirm)
FLOWS = {
    "hub-install": (("docker", "container", "volume", "mdns", "first-admin"), ()),
    "remote-cloudflare": (("domain", "tunnel", "certificate", "reach-self", "locked-down"), ("tunnel",)),
    "remote-tailscale": (("tailnet", "funnel-or-private", "certificate", "reach-self", "locked-down"), ("tailnet", "funnel-or-private")),
    "google": (("public-url", "console", "client", "discovery", "test-sign-in"), ("console",)),
    "apple": (("public-url", "developer", "identifiers", "key", "token-endpoint", "test-sign-in"), ("developer",)),
}
REMOTE_FLOWS = ("remote-cloudflare", "remote-tailscale")
# What a person typed that is kept (never a secret) so a form refills on another device.
VALUE_KEYS = {"client_id", "services_id", "team_id", "key_id", "public_url", "mode"}
GOOGLE_DISCOVERY = "https://accounts.google.com/.well-known/openid-configuration"
MIN_FREE_BYTES = 1 << 30
HOSTNAME = re.compile(r"^(?=.{4,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$")


def _is_public_host(host):
    host = (host or "").lower()
    return bool(HOSTNAME.match(host)) and not host.endswith((".local", ".lan", ".home", ".internal", ".localhost"))


class Net:
    """The few outgoing connections the checks make. Replaced in tests."""

    def __init__(self, http):
        self.http = http

    def get_json(self, url):
        return self.http.get_json(url)

    def post_form(self, url, data):
        return self.http.post_form(url, data)

    def tls_expires(self, host, port=443):
        """When the certificate at host:port runs out, after checking it is valid for that name. Raises OSError/SSLError."""
        context = ssl.create_default_context()
        context.minimum_version = ssl.TLSVersion.TLSv1_2     # never an old protocol, whatever the machine's defaults
        with socket.create_connection((host, port), timeout=8) as raw, context.wrap_socket(raw, server_hostname=host) as tls:
            return ssl.cert_time_to_seconds(tls.getpeercert()["notAfter"])

    def port_open(self, host, port):
        try:
            with socket.create_connection((host, port), timeout=2):
                return True
        except OSError:
            return False

    def local_request(self, port, method, path, headers=None):
        """(status, headers) from this hub, asked on its own loopback address as a stranger would."""
        import http.client
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        try:
            conn.request(method, path, body=b"{}" if method != "GET" else None, headers=headers or {})
            response = conn.getresponse()
            response.read()
            return response.status, {k.lower(): v for k, v in response.getheaders()}
        finally:
            conn.close()


class Setup:
    def __init__(self, hub, net=None, clock=time.time):
        self.hub, self._clock = hub, clock
        self.net = net or Net(hub.federation.http)
        self._lock = threading.RLock()
        self._checks = {
            ("hub-install", "docker"): (self._docker, ()),
            ("hub-install", "container"): (self._container, ()),
            ("hub-install", "volume"): (self._volume, ()),
            ("hub-install", "mdns"): (self._mdns, ()),
            ("hub-install", "first-admin"): (self._first_admin, ()),
            ("google", "public-url"): (self._public_url, ()),
            ("google", "client"): (self._google_client, ()),
            ("google", "discovery"): (self._google_discovery, (("accounts.google.com", "Nothing but the request for Google's public sign-in settings."),)),
            ("google", "test-sign-in"): (lambda b, m: self._test_sign_in("google", m), ()),
            ("apple", "public-url"): (self._public_url, ()),
            ("apple", "identifiers"): (self._apple_identifiers, ()),
            ("apple", "key"): (self._apple_key, ()),
            ("apple", "token-endpoint"): (self._apple_token, (("appleid.apple.com", "A made-up code, signed with your key. Nothing about you or your household."),)),
            ("apple", "test-sign-in"): (lambda b, m: self._test_sign_in("apple", m), ()),
        }
        for flow in REMOTE_FLOWS:
            self._checks[(flow, "certificate")] = (self._certificate, (("your public address", "A secure connection to it, to check the certificate. Nothing is sent."),))
            self._checks[(flow, "reach-self")] = (self._reach_self, (("your public address", "A request for this hub's name and id, to see that it is really this hub answering."),))
            self._checks[(flow, "locked-down")] = (self._locked_down, ())
        self._checks[("remote-cloudflare", "domain")] = (self._domain, ())

    # --- saved progress ------------------------------------------------------

    def _load(self):
        return json.loads(self.hub.store.meta("setup", "{}"))

    def _save(self, saved):
        self.hub.store.set_meta("setup", json.dumps(saved))

    @staticmethod
    def _need_flow(flow):
        if flow not in FLOWS:
            raise Problem(404, "There is no such setup flow.")
        return FLOWS[flow]

    @staticmethod
    def _need_step(flow, step):
        steps, _ = FLOWS[flow]
        if step not in steps:
            raise Problem(404, "There is no such step.")
        return steps.index(step)

    def _state(self, saved, flow, step):
        entry = saved.get(flow, {}).get("steps", {}).get(step) or {}
        return {"id": step, "state": entry.get("state", "todo"), **{k: entry[k] for k in ("reason", "summary", "checked") if k in entry}}

    def flow(self, name):
        steps, manual = self._need_flow(name)
        saved = self._load()
        out = []
        for step in steps:
            item = self._state(saved, name, step)
            if step in manual:
                item["manual"] = True
            out.append(item)
        return {"flow": name, "steps": out, "values": saved.get(name, {}).get("values", {})}

    def summary(self):
        flows = []
        for name in FLOWS:
            steps = self.flow(name)["steps"]
            failed = next((s for s in steps if s["state"] == "failed"), None)
            checked = max([s.get("checked", 0) for s in steps] or [0])
            state = "failed" if failed else "passed" if all(s["state"] == "passed" for s in steps) else "started" if any(s["state"] != "todo" for s in steps) else "todo"
            item = {"flow": name, "state": state}
            if failed:
                item["failed_step"] = failed["id"]
            if checked:
                item["checked"] = checked
            flows.append(item)
        return {"flows": flows}

    def passed(self, name):
        return all(s["state"] == "passed" for s in self.flow(name)["steps"])

    def missing(self, name):
        """The first step of a flow that hasn't passed, as a sentence, or None when it has all passed."""
        step = next((s for s in self.flow(name)["steps"] if s["state"] != "passed"), None)
        return None if not step else f"Finish the {name} setup first: the “{step['id']}” step hasn't passed."

    def plan(self, name, step):
        self._need_flow(name)
        self._need_step(name, step)
        entry = self._checks.get((name, step))
        _, manual = FLOWS[name]
        return {"contacts": [{"host": h, "sends": s} for h, s in (entry[1] if entry else ())], "manual": step in manual}

    # --- running a step -------------------------------------------------------

    def _set(self, name, step, state, reason="", summary="", values=None):
        with self._lock:
            saved = self._load()
            flow = saved.setdefault(name, {"steps": {}, "values": {}})
            steps, _ = FLOWS[name]
            for later in steps[steps.index(step) + 1:]:      # checking this step again sets the later ones back
                flow["steps"].pop(later, None)
            entry = {"state": state, "checked": self._clock()}
            if reason:
                entry["reason"] = reason
            if summary:
                entry["summary"] = summary
            flow["steps"][step] = entry
            flow["values"].update({k: v for k, v in (values or {}).items() if k in VALUE_KEYS})
            self._save(saved)

    def _ready(self, name, step):
        steps, _ = FLOWS[name]
        saved = self._load()
        for earlier in steps[:steps.index(step)]:
            if self._state(saved, name, earlier)["state"] != "passed":
                raise Problem(409, f"Do the “{earlier}” step first.")

    def verify(self, name, step, body, member):
        """Runs a step's check. Returns the step as `flow()` shows it, with `summary` or `reason` set."""
        self._need_flow(name)
        self._need_step(name, step)
        if step in FLOWS[name][1]:
            raise Problem(400, "That step is a manual one: confirm it instead.")
        if not isinstance(body, dict):
            raise Problem(400, "That wasn't valid.")
        self._ready(name, step)
        check = self._checks[(name, step)][0]
        try:
            ok, text, values = check(body, member)
        except OSError as err:
            ok, text, values = False, f"The hub couldn't reach what it needed to: {err}", {}
        self._set(name, step, "passed" if ok else "failed", "" if ok else text, text if ok else "", values)
        self.hub.accounts.audit(member["id"] if member else "", "setup-check", f"{name}/{step}: {'passed' if ok else 'failed'}")
        return self._state(self._load(), name, step)

    def confirm(self, name, step, state, member):
        self._need_flow(name)
        self._need_step(name, step)
        if step not in FLOWS[name][1]:
            raise Problem(409, "That step is checked by the hub, not confirmed by hand.")
        if state != "passed":
            raise Problem(400, "A manual step can only be confirmed as passed.")
        self._ready(name, step)
        self._set(name, step, "passed", summary="Confirmed")
        return self._state(self._load(), name, step)

    # --- hub-install ------------------------------------------------------------

    def _docker(self, body, member):
        try:
            with open("/proc/1/cgroup") as f:
                cgroup = f.read()
        except OSError:
            cgroup = ""
        if os.path.exists("/.dockerenv") or "docker" in cgroup or "containerd" in cgroup or os.environ.get("LOOKABOUT_IN_CONTAINER"):
            return True, "The hub is running in a container.", {}
        return False, "The hub isn't running in a Docker container. The install guide uses Docker (curl -fsSL https://get.docker.com | sh, then docker compose up -d --build).", {}

    def _container(self, body, member):
        if not self.hub.bridge.available:
            return False, "go2rtc isn't running inside the hub, so there is no video. Check `docker compose logs hub`.", {}
        return True, f"Hub {self.hub.info(brief=True)['version']} is up and the video bridge is running.", {}

    def _volume(self, body, member):
        try:
            with tempfile.NamedTemporaryFile(dir=self.hub.data_dir):
                pass
            free = shutil.disk_usage(self.hub.data_dir).free
        except OSError as err:
            return False, f"The hub can't write to its data folder: {err}. Check the hub-data volume.", {}
        if free < MIN_FREE_BYTES:
            return False, f"Only {free // (1 << 20)} MB is free where the hub keeps its data. Recordings need room: free some up.", {}
        return True, f"The data folder is writable, with {free // (1 << 30)} GB free.", {}

    def _mdns(self, body, member):
        name = getattr(self.hub, "mdns_name", None)
        if not name:
            return False, "The hub isn't announcing itself on the network, so apps won't find it by name. Start it without --no-mdns, and with host networking in Docker.", {}
        return True, f"Announced as {name}.", {}

    def _first_admin(self, body, member):
        if self.hub.accounts.setup_needed():
            return False, "No admin account yet. Open the hub in Lookabout and make the first admin with the setup code.", {}
        return True, f"{len(self.hub.accounts.admins())} admin account(s).", {}

    # --- Google and Apple ---------------------------------------------------------

    def _public_url(self, body, member):
        url = str(body.get("public_url") or self.hub.federation.public_url()).strip().rstrip("/")
        parts = urllib.parse.urlsplit(url)
        if not url:
            return False, "Enter the hub's public https address, such as https://hub.example.com. Google and Apple only call back to https.", {}
        if parts.scheme != "https" or not _is_public_host(parts.hostname) or parts.path or parts.query or parts.fragment:
            return False, "That should be an https address with a real domain name (not an IP address or a .local name), such as https://hub.example.com.", {}
        if url != self.hub.federation.public_url():
            self.hub.federation.update({"public_url": url})
        return True, url, {"public_url": url}

    def _google_client(self, body, member):
        saved = self.hub.federation._saved().get("google", {})
        client_id = str(body.get("client_id") or saved.get("client_id") or "").strip()
        secret = str(body.get("client_secret") or "").strip()
        if not client_id.endswith(".apps.googleusercontent.com"):
            return False, "That client ID doesn't look like a Google one. It ends in .apps.googleusercontent.com.", {}
        if not secret and not saved.get("secret"):
            return False, "Enter the client secret from the same Google credentials page.", {}
        self.hub.federation.update({"google": {"client_id": client_id, **({"client_secret": secret} if secret else {})}})
        return True, f"Client {client_id.split('-')[0]}… saved. The secret is stored encrypted and not shown again.", {"client_id": client_id}

    def _google_discovery(self, body, member):
        found = self.net.get_json(GOOGLE_DISCOVERY)
        ours = PROVIDERS["google"]
        wrong = [k for k, mine in (("authorization_endpoint", ours["authorize"]), ("token_endpoint", ours["token"]), ("jwks_uri", ours["jwks"]))
                 if found.get(k) != mine]
        if found.get("issuer") not in ours["issuers"] or wrong:
            return False, f"Google's published settings differ from what this hub uses ({', '.join(wrong) or 'issuer'}). Update the hub.", {}
        return True, "Google's sign-in settings match what the hub uses.", {}

    def _apple_identifiers(self, body, member):
        saved = self.hub.federation._saved().get("apple", {})
        services = str(body.get("services_id") or saved.get("services_id") or "").strip()
        team = str(body.get("team_id") or saved.get("team_id") or "").strip()
        if not re.fullmatch(r"[A-Za-z0-9.-]+\.[A-Za-z0-9.-]+", services):
            return False, "The Services ID looks like a reverse domain name, such as dev.example.lookabout.", {}
        if not re.fullmatch(r"[A-Z0-9]{10}", team):
            return False, "The Team ID is 10 capital letters and digits. It is under your name at the top right of the Apple developer site.", {}
        self.hub.federation.update({"apple": {"services_id": services, "team_id": team}})
        return True, f"Services ID {services}, team {team}.", {"services_id": services, "team_id": team}

    def _apple_key(self, body, member):
        saved = self.hub.federation._saved().get("apple", {})
        key_id = str(body.get("key_id") or saved.get("key_id") or "").strip()
        pem = str(body.get("key") or "").strip()
        if not re.fullmatch(r"[A-Z0-9]{10}", key_id):
            return False, "The Key ID is 10 capital letters and digits, shown next to the key you made.", {}
        if not pem and not saved.get("key"):
            return False, "Paste the contents of the .p8 file you downloaded (it starts with -----BEGIN PRIVATE KEY-----).", {}
        try:
            self.hub.federation.update({"apple": {"key_id": key_id, **({"key": pem} if pem else {})}})
        except Problem as err:
            return False, err.message, {}
        return True, f"Key {key_id} saved, encrypted. It isn't shown again.", {"key_id": key_id}

    def _apple_token(self, body, member):
        saved = self.hub.federation._saved().get("apple", {})
        secret = apple_client_secret(saved["team_id"], saved["services_id"], saved["key_id"], self.hub.federation.vault.open(saved["key"]), self._clock())
        answer = self.net.post_form(PROVIDERS["apple"]["token"], {
            "grant_type": "authorization_code", "code": "lookabout-setup-check", "client_id": saved["services_id"],
            "client_secret": secret, "redirect_uri": self.hub.federation.redirect_uri("apple")})
        if answer.get("error") == "invalid_client":
            return False, "Apple didn't accept the Services ID, Team ID, Key ID and key together. Check that the key is enabled for Sign in with Apple and belongs to this team.", {}
        return True, "Apple accepted the hub's credentials (it refused only the made-up code).", {}

    def _test_sign_in(self, provider, member):
        label = provider.capitalize()
        if not member or provider not in self.hub.accounts.identities(member["id"]):
            return False, f"Link your {label} account first: Your account, then Linked sign-ins, then Link. Then check again.", {}
        return True, f"Signed in with {label} as {self.hub.accounts.identities(member['id'])[provider]}.", {}

    # --- remote access ------------------------------------------------------------

    def _domain(self, body, member):
        return self._public_url(body, member)

    def _public_host(self):
        url = self.hub.federation.public_url()
        parts = urllib.parse.urlsplit(url)
        return url, parts.hostname, parts.port or 443

    def _certificate(self, body, member):
        if body.get("public_url"):                      # Tailscale has no separate address step: it is given here
            ok, text, _ = self._public_url(body, member)
            if not ok:
                return False, text, {}
        url, host, port = self._public_host()
        if not url.startswith("https://") or not _is_public_host(host):
            return False, "Set the hub's public https address first, such as https://hub.example.com.", {}
        try:
            expires = self.net.tls_expires(host, port)
        except (OSError, ssl.SSLError) as err:
            return False, f"The secure connection to {host} didn't work: {err}. Check the tunnel is running and the certificate is valid for that name.", {}
        days = int((expires - self._clock()) // 86400)
        if days < 1:
            return False, f"The certificate for {host} has run out.", {}
        return True, f"A valid certificate for {host}, good for {days} more days.", {}

    def _reach_self(self, body, member):
        url, host, _ = self._public_host()
        try:
            found = self.net.get_json(f"{url}/api/hub")
        except (OSError, ValueError) as err:
            return False, f"{host} didn't answer: {err}. Check the tunnel is running and points at this hub.", {}
        if found.get("id") != self.hub.store.hub_id():
            return False, f"{host} answered, but it isn't this hub. Check the tunnel points at the right machine.", {}
        return True, f"{host} reaches this hub.", {}

    def lockdown(self):
        """What must be true before the hub is reachable from outside. Returns a list of (what, ok, detail)."""
        out, port = [], getattr(self.hub, "listening", (None, None))[1]
        weak = [m["email"] for m in self.hub.accounts.admins() if not self.hub.accounts.strong(m)]
        out.append(("Every admin has a passkey or a password of 14+ characters", not weak,
                    "Weak: " + ", ".join(weak) if weak else f"{len(self.hub.accounts.admins())} admin(s) are strong enough"))
        if port:
            leaks = []
            for method, path in (("GET", "/api/cameras"), ("GET", "/api/events"), ("GET", "/api/cameras/cam-x/snapshot.jpg"),
                                 ("GET", "/api/cameras/cam-x/stream.mjpeg"), ("POST", "/api/cameras/cam-x/webrtc"), ("GET", "/api/clips/1.mp4"),
                                 ("GET", "/api/settings"), ("GET", "/api/usb"), ("GET", "/api/household")):
                status, _ = self.net.local_request(port, method, path)
                if status not in (401, 423):
                    leaks.append(f"{method} {path} answered {status}")
            out.append(("Every camera, stream and clip route asks for a sign-in", not leaks, "; ".join(leaks) or "Asked as a stranger: all refused"))
            _, headers = self.net.local_request(port, "GET", "/api/hub", {"Origin": "https://elsewhere.example"})
            cors = [h for h in headers if h.startswith("access-control-")]
            out.append(("No other website may read from the hub", not cors, ", ".join(cors) or "No cross-origin headers sent"))
        exposed = [p for p in (1984, 8554) for a in local_addresses() if self.net.port_open(a, p)]
        out.append(("go2rtc's own ports (1984, 8554) are closed to the network", not exposed,
                    "Open on the network: " + ", ".join(str(p) for p in sorted(set(exposed))) if exposed else "Only reachable on the machine itself"))
        return out

    def _locked_down(self, body, member):
        results = self.lockdown()
        bad = [f"{what}: {detail}" for what, ok, detail in results if not ok]
        if bad:
            return False, " · ".join(bad), {}
        self.hub.accounts.set_remote(True)
        self.hub.accounts.audit(member["id"] if member else "", "remote-access", "on")
        return True, "All checks passed. Remote access is on; sessions now last 7 days.", {}

    def turn_off_remote(self, member):
        self.hub.accounts.set_remote(False)
        self.hub.accounts.audit(member["id"], "remote-access", "off")
        for flow in REMOTE_FLOWS:
            saved = self._load()
            saved.get(flow, {}).get("steps", {}).pop("locked-down", None)
            self._save(saved)

    # --- the health panel (G10) -----------------------------------------------------

    def health(self):
        """Everything worth knowing about how the hub is set up, with what to do about each. state: ok | warn | bad."""
        hub, checks = self.hub, []

        def add(id_, title, state, detail, flow=None):
            checks.append({"id": id_, "title": title, "state": state, "detail": detail, **({"flow": flow} if flow else {})})

        admins = hub.accounts.admins()
        weak = [m["email"] for m in admins if not hub.accounts.strong(m)]
        add("admins", "Admin sign-in strength", "ok" if admins and not weak else "warn",
            "Every admin has a passkey or a long password." if admins and not weak else f"Needs a passkey or a 14+ character password: {', '.join(weak) or 'no admin yet'}.")
        url = hub.federation.public_url()
        add("public-url", "Public address", "ok" if url.startswith("https://") else "warn",
            url or "None set. Only needed for Google, Apple and remote access.")
        for provider in ("google", "apple"):
            enabled = hub.federation.enabled(provider)
            flow = self.flow(provider)["steps"]
            failed = next((s for s in flow if s["state"] == "failed"), None)
            if failed:
                add(provider, f"{provider.capitalize()} sign-in", "bad", f"“{failed['id']}” failed: {failed.get('reason', '')}", provider)
            elif enabled and not self.passed(provider):
                add(provider, f"{provider.capitalize()} sign-in", "warn", "On, but its setup hasn't been checked all the way through.", provider)
            else:
                add(provider, f"{provider.capitalize()} sign-in", "ok" if enabled else "ok", "On." if enabled else "Off (optional).", provider)
        remote = hub.accounts.remote()
        if remote:
            bad = [f"{what}: {detail}" for what, ok, detail in self.lockdown() if not ok]
            add("remote", "Remote access", "bad" if bad else "ok", " · ".join(bad) if bad else "On, and every lock-down check still passes.", "remote-cloudflare")
        else:
            add("remote", "Remote access", "ok", "Off. The hub is only reachable on your home network.")
        key = os.path.join(hub.data_dir, "keys", "vault.key")
        mode = os.stat(key).st_mode & 0o777 if os.path.exists(key) else None
        add("vault", "Provider secrets key", "ok" if mode == 0o600 else "warn" if mode is not None else "ok",
            "Key file is private (mode 600)." if mode == 0o600 else f"Key file mode is {oct(mode)}; it should be 600." if mode is not None else "No secrets stored yet.")
        free = shutil.disk_usage(hub.data_dir).free
        add("disk", "Disk space", "ok" if free >= MIN_FREE_BYTES else "warn", f"{free // (1 << 30)} GB free.", "hub-install")
        add("video", "Video bridge", "ok" if hub.bridge.available else "bad", "go2rtc is running." if hub.bridge.available else "go2rtc isn't running: no video, recording or detection.", "hub-install")
        add("cry", "Cry detection", "ok" if hub.classifier else "warn", "Ready." if hub.classifier else f"Off: {hub.classifier_problem}.")
        add("mdns", "Found by name on the network", "ok" if getattr(hub, "mdns_name", None) else "warn",
            f"Announced as {hub.mdns_name}." if getattr(hub, "mdns_name", None) else "Not announced: apps can't find the hub by name.", "hub-install")
        order = {"bad": 2, "warn": 1, "ok": 0}
        worst = max((c["state"] for c in checks), key=lambda s: order[s])
        return {"state": worst, "checks": checks, "flows": self.summary()["flows"]}
