"""The setup wizards on the hub: flows, steps, checks and the health panel (docs/hub-auth.md).

Everything the checks would contact is stood in for, so these cover the hub's own logic: the order of
steps, what each check decides, what it stores, and what the lock-down check refuses. Nothing here has
touched a real Google, Apple, Cloudflare or Tailscale account.
"""

import json
import os
import ssl
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from lookabout_hub import setup as setup_module  # noqa: E402
from lookabout_hub.oidc import PROVIDERS  # noqa: E402
from lookabout_hub.setup import Net  # noqa: E402
from support import PASSWORD, HubCase  # noqa: E402
from test_federation import APPLE_PEM, CLIENT_ID  # noqa: E402

GOOGLE_DISCOVERY = {"issuer": "https://accounts.google.com", "authorization_endpoint": PROVIDERS["google"]["authorize"],
                    "token_endpoint": PROVIDERS["google"]["token"], "jwks_uri": PROVIDERS["google"]["jwks"]}


class FakeNet:
    """Stands in for every outgoing connection. Loopback requests to the hub itself are real."""

    def __init__(self):
        self.json, self.form_answer, self.forms, self.tls, self.open_ports = {}, {}, [], 4_000_000_000, set()
        self.leaks = {}
        self._real = Net(None)

    def get_json(self, url):
        found = self.json.get(url, OSError("no such address"))
        if isinstance(found, Exception):
            raise found
        return found

    def post_form(self, url, data):
        self.forms.append((url, data))
        return self.form_answer

    def tls_expires(self, host, port=443):
        if isinstance(self.tls, Exception):
            raise self.tls
        return self.tls

    def port_open(self, host, port):
        return port in self.open_ports

    def local_request(self, port, method, path, headers=None):
        if path in self.leaks:
            return self.leaks[path], {}
        return self._real.local_request(port, method, path, headers)


class SetupCase(HubCase):
    def setUp(self):
        super().setUp()
        self.net = FakeNet()
        self.hub.setup.net = self.net
        self.hub.setup._clock = lambda: self.clock[0]

    def api(self, method, path, body=None, token=None):
        return self.call(method, f"/api/setup{path}", body, token=token)

    def verify(self, flow, step, body=None, token=None):
        return self.api("POST", f"/{flow}/{step}/verify", body or {}, token=token or self.admin)

    def confirm(self, flow, step):
        return self.api("PUT", f"/{flow}/{step}", {"state": "passed"}, token=self.admin)

    def state(self, flow, step):
        return next(s for s in self.api("GET", f"/{flow}", token=self.admin)[1]["steps"] if s["id"] == step)

    def admin_with(self, password=PASSWORD):
        self.admin = self.signin(password=password)
        return self.admin

    def link_identity(self, provider, email="sam@gmail.com"):
        member = self.member()
        self.store._run("INSERT INTO identities (provider, sub, member_id, email, created) VALUES (?, ?, ?, ?, 0)",
                        (provider, "sub-1", member["id"], email))

    def run_to(self, flow, upto, bodies=None):
        """Passes every step before `upto`."""
        steps, manual = setup_module.FLOWS[flow]
        for step in steps[:steps.index(upto)]:
            status, got = (self.confirm(flow, step) if step in manual else self.verify(flow, step, (bodies or {}).get(step)))
            self.assertEqual((status, got["state"]), (200, "passed"), (step, got))


class FlowTest(SetupCase):
    def test_before_the_first_admin_only_the_install_flow_is_open_and_only_at_home(self):
        status, got = self.api("GET", "/hub-install")
        self.assertEqual((status, [s["id"] for s in got["steps"]]), (200, ["docker", "container", "volume", "mdns", "first-admin"]))
        self.assertEqual(self.api("GET", "/hub-install/volume/plan")[0], 200)
        status, got = self.api("POST", "/hub-install/docker/verify", {})          # a check runs, and says how it went
        self.assertEqual((status, got["state"] in ("passed", "failed")), (200, True))
        self.assertEqual(self.api("POST", "/hub-install/volume/verify", {})[0], 200 if got["state"] == "passed" else 409)
        for method, path in (("GET", "/google"), ("GET", ""), ("POST", "/google/public-url/verify"), ("GET", "/remote-cloudflare")):
            status, got = self.api(method, path, {} if method == "POST" else None)
            self.assertEqual((status, got["code"]), (423, "setup_required"), path)
        self.signin()
        for method, path in (("GET", "/hub-install"), ("GET", ""), ("POST", "/hub-install/volume/verify")):
            self.assertEqual(self.api(method, path, {} if method == "POST" else None)[0], 401, path)

    def test_the_install_flow_is_closed_to_other_networks(self):
        with mock.patch("lookabout_hub.server.ipaddress.ip_address", return_value=__import__("ipaddress").ip_address("8.8.8.8")):
            status, got = self.api("GET", "/hub-install")
        self.assertEqual((status, got["code"]), (423, "setup_required"))

    def test_only_admins(self):
        admin = self.admin_with()
        _, member = self.invite(admin, "olga@example.com")
        for method, path in (("GET", ""), ("GET", "/google"), ("GET", "/google/public-url/plan"), ("POST", "/google/public-url/verify"),
                             ("PUT", "/google/console"), ("GET", "/hub-install")):
            status, got = self.api(method, path, {} if method in ("POST", "PUT") else None, token=member)
            self.assertEqual((status, got["code"]), (403, "admin_only"), path)
        for path in ("/admin/health", "/admin/remote/off"):
            self.assertEqual(self.call("GET" if "health" in path else "POST", f"/api{path}", {} if "off" in path else None, token=member)[0], 403)

    def test_flows_and_unknown_things(self):
        self.admin_with()
        names = [f["flow"] for f in self.api("GET", "", token=self.admin)[1]["flows"]]
        self.assertEqual(names, ["hub-install", "remote-cloudflare", "remote-tailscale", "google", "apple"])
        self.assertEqual(self.api("GET", "/nothing", token=self.admin)[0], 404)
        self.assertEqual(self.api("GET", "/google/nothing/plan", token=self.admin)[0], 404)
        self.assertEqual(self.verify("nothing", "x")[0], 404)
        self.assertEqual(self.verify("google", "nothing")[0], 404)
        self.assertEqual(self.confirm("google", "nothing")[0], 404)
        self.assertEqual(self.api("GET", "/google/public-url/nothing", token=self.admin)[0], 404)
        for flow in ("google", "apple", "remote-cloudflare", "remote-tailscale", "hub-install"):
            self.assertTrue(all(s["state"] == "todo" for s in self.api("GET", f"/{flow}", token=self.admin)[1]["steps"]))

    def test_steps_go_in_order_and_manual_steps_are_confirmed(self):
        self.admin_with()
        status, got = self.verify("google", "client")
        self.assertEqual((status, got["code"]), (409, "conflict"))
        self.assertIn("public-url", got["error"])
        status, got = self.verify("google", "console")
        self.assertEqual(status, 400)                                         # manual: confirm it instead
        status, got = self.confirm("google", "console")
        self.assertEqual(status, 409)                                         # and not before the step before it
        self.assertEqual(self.confirm("google", "client")[0], 409)            # not manual
        self.assertEqual(self.api("PUT", "/google/console", {"state": "failed"}, token=self.admin)[0], 400)
        self.assertEqual(self.api("POST", "/google/public-url/verify", [], token=self.admin)[0], 400)

    def test_plan_names_who_is_contacted(self):
        self.admin_with()
        plan = lambda flow, step: self.api("GET", f"/{flow}/{step}/plan", token=self.admin)[1]  # noqa: E731
        self.assertEqual(plan("google", "discovery")["contacts"][0]["host"], "accounts.google.com")
        self.assertIn("public sign-in settings", plan("google", "discovery")["contacts"][0]["sends"])
        self.assertEqual(plan("apple", "token-endpoint")["contacts"][0]["host"], "appleid.apple.com")
        self.assertEqual(plan("remote-cloudflare", "reach-self")["contacts"][0]["host"], "your public address")
        self.assertEqual(plan("google", "client"), {"contacts": [], "manual": False})
        self.assertEqual(plan("google", "console"), {"contacts": [], "manual": True})

    def test_checking_a_step_again_sends_the_later_ones_back(self):
        self.admin_with()
        self.verify("google", "public-url", {"public_url": "https://hub.example.com"})
        self.confirm("google", "console")
        self.verify("google", "client", {"client_id": CLIENT_ID, "client_secret": "s3cret"})
        self.verify("google", "public-url", {"public_url": "https://hub.example.com"})
        self.assertEqual([self.state("google", s)["state"] for s in ("console", "client")], ["todo", "todo"])
        self.assertEqual(self.state("google", "public-url")["state"], "passed")

    def test_summary(self):
        self.admin_with()
        self.verify("google", "public-url", {"public_url": "http://nope"})
        with mock.patch.dict(os.environ, {"LOOKABOUT_IN_CONTAINER": "1"}):
            self.verify("hub-install", "docker")
        flows = {f["flow"]: f for f in self.api("GET", "", token=self.admin)[1]["flows"]}
        self.assertEqual((flows["google"]["state"], flows["google"]["failed_step"]), ("failed", "public-url"))
        self.assertEqual(flows["hub-install"]["state"], "started")
        self.assertEqual(flows["apple"], {"flow": "apple", "state": "todo"})
        self.assertIn("checked", flows["google"])


class InstallTest(SetupCase):
    def test_each_install_step(self):
        self.admin_with()
        with mock.patch("builtins.open", side_effect=OSError), mock.patch("os.path.exists", return_value=False), mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("LOOKABOUT_IN_CONTAINER", None)
            status, got = self.verify("hub-install", "docker")
        self.assertEqual((got["state"], "Docker container" in got["reason"]), ("failed", True))
        with mock.patch.dict(os.environ, {"LOOKABOUT_IN_CONTAINER": "1"}):
            self.assertEqual(self.verify("hub-install", "docker")[1]["state"], "passed")
        with mock.patch("os.path.exists", side_effect=lambda p: p == "/.dockerenv"):
            self.assertEqual(self.verify("hub-install", "docker")[1]["state"], "passed")
        got = self.verify("hub-install", "container")[1]
        self.assertEqual(got["state"], "passed")
        self.bridge.available = False
        got = self.verify("hub-install", "container")[1]
        self.assertEqual((got["state"], "go2rtc" in got["reason"]), ("failed", True))
        self.bridge.available = True
        self.verify("hub-install", "container")
        self.assertEqual(self.verify("hub-install", "volume")[1]["state"], "passed")
        with mock.patch("shutil.disk_usage", return_value=mock.Mock(free=10 << 20)):
            got = self.verify("hub-install", "volume")[1]
        self.assertEqual((got["state"], "10 MB" in got["reason"]), ("failed", True))
        self.verify("hub-install", "volume")
        with mock.patch("tempfile.NamedTemporaryFile", side_effect=PermissionError("denied")):
            got = self.verify("hub-install", "volume")[1]
        self.assertIn("can't write", got["reason"])
        self.verify("hub-install", "volume")
        got = self.verify("hub-install", "mdns")[1]
        self.assertEqual((got["state"], "--no-mdns" in got["reason"]), ("failed", True))
        self.hub.mdns_name = "pi.local"
        self.assertEqual(self.verify("hub-install", "mdns")[1]["summary"], "Announced as pi.local.")
        self.assertEqual(self.verify("hub-install", "first-admin")[1]["state"], "passed")

    def test_first_admin_step_waits_for_the_admin(self):
        status, got = self.api("POST", "/hub-install/first-admin/verify", {})
        self.assertEqual(status, 409)                                         # earlier steps first
        with mock.patch.dict(os.environ, {"LOOKABOUT_IN_CONTAINER": "1"}):
            for step in ("docker", "container", "volume"):
                self.api("POST", f"/hub-install/{step}/verify", {})
        self.hub.mdns_name = "pi.local"
        self.api("POST", "/hub-install/mdns/verify", {})
        got = self.api("POST", "/hub-install/first-admin/verify", {})[1]
        self.assertEqual((got["state"], "No admin" in got["reason"]), ("failed", True))
        self.signin()
        self.admin = self.signin()
        self.assertEqual(self.verify("hub-install", "first-admin")[1]["summary"], "1 admin(s) account(s).".replace("admin(s) account(s)", "admin account(s)"))


class GoogleTest(SetupCase):
    def setUp(self):
        super().setUp()
        self.admin_with()
        self.net.json[setup_module.GOOGLE_DISCOVERY] = dict(GOOGLE_DISCOVERY)

    def test_the_whole_flow_and_only_then_may_google_be_switched_on(self):
        put = lambda patch: self.call("PUT", "/api/admin/auth/providers", patch, token=self.admin)  # noqa: E731
        got = self.verify("google", "public-url")[1]
        self.assertEqual(got["state"], "failed")                                      # none set yet
        for bad in ("http://hub.example.com", "https://192.168.1.5", "https://pi.local", "https://localhost", "hub.example.com"):
            self.assertEqual(self.verify("google", "public-url", {"public_url": bad})[1]["state"], "failed", bad)
        got = self.verify("google", "public-url", {"public_url": "https://hub.example.com/"})[1]
        self.assertEqual((got["state"], got["summary"]), ("passed", "https://hub.example.com"))
        self.assertEqual(self.store.meta("public_url"), "https://hub.example.com")
        self.assertEqual(self.confirm("google", "console")[1]["summary"], "Confirmed")
        got = self.verify("google", "client", {"client_id": "nope", "client_secret": "x"})[1]
        self.assertIn("ends in .apps.googleusercontent.com", got["reason"])
        got = self.verify("google", "client", {"client_id": CLIENT_ID})[1]
        self.assertIn("client secret", got["reason"])
        got = self.verify("google", "client", {"client_id": CLIENT_ID, "client_secret": "GOCSPX-s3cret"})[1]
        self.assertEqual(got["state"], "passed")
        self.assertNotIn("GOCSPX", json.dumps(self.api("GET", "/google", token=self.admin)[1]))
        self.assertEqual(self.api("GET", "/google", token=self.admin)[1]["values"], {"public_url": "https://hub.example.com", "client_id": CLIENT_ID})
        self.assertNotIn("GOCSPX", self.store.meta("setup"))
        self.assertTrue(self.hub.federation.configured("google"))
        self.assertFalse(self.hub.federation.enabled("google"))                       # entering details doesn't switch it on
        status, got = put({"google": {"enabled": True}})
        self.assertEqual(status, 409)
        self.assertIn("“discovery” step", got["error"])                              # the wizard isn't finished
        self.assertEqual(self.verify("google", "discovery")[1]["state"], "passed")
        self.net.json[setup_module.GOOGLE_DISCOVERY] = {**GOOGLE_DISCOVERY, "token_endpoint": "https://elsewhere.example/token"}
        got = self.verify("google", "discovery")[1]
        self.assertEqual((got["state"], "token_endpoint" in got["reason"]), ("failed", True))
        self.net.json[setup_module.GOOGLE_DISCOVERY] = {**GOOGLE_DISCOVERY, "issuer": "https://evil.example"}
        self.assertEqual(self.verify("google", "discovery")[1]["state"], "failed")
        self.net.json[setup_module.GOOGLE_DISCOVERY] = OSError("timed out")
        got = self.verify("google", "discovery")[1]
        self.assertEqual((got["state"], "couldn't reach" in got["reason"]), ("failed", True))
        self.net.json[setup_module.GOOGLE_DISCOVERY] = dict(GOOGLE_DISCOVERY)
        self.assertEqual(self.verify("google", "discovery")[1]["state"], "passed")
        got = self.verify("google", "test-sign-in")[1]
        self.assertEqual((got["state"], "Link your Google account" in got["reason"]), ("failed", True))
        self.link_identity("google")
        got = self.verify("google", "test-sign-in")[1]
        self.assertEqual((got["state"], got["summary"]), ("passed", "Signed in with Google as sam@gmail.com."))
        self.assertEqual(put({"google": {"enabled": True}})[0], 200)                  # now it may be
        self.assertTrue(self.hub.federation.enabled("google"))

    def test_an_admin_can_try_google_before_it_is_on_but_nobody_else(self):
        self.verify("google", "public-url", {"public_url": "https://hub.example.com"})
        self.confirm("google", "console")
        self.verify("google", "client", {"client_id": CLIENT_ID, "client_secret": "s"})
        _, member = self.invite(self.admin, "olga@example.com")
        self.assertEqual(self.call("POST", "/api/auth/login/google", {})[0], 404)           # nobody signs in with it yet
        self.assertEqual(self.call("POST", "/api/me/link/google", {}, token=member)[0], 403)
        status, got = self.call("POST", "/api/me/link/google", {"return_to": "/#/setup"}, token=self.admin)
        self.assertEqual(status, 200)
        self.assertTrue(got["redirect"].startswith("https://accounts.google.com/"))

    def test_the_hub_without_credentials_cannot_be_tried(self):
        self.assertEqual(self.call("POST", "/api/me/link/google", {}, token=self.admin)[0], 404)


class AppleTest(SetupCase):
    def setUp(self):
        super().setUp()
        self.admin_with()
        self.verify("apple", "public-url", {"public_url": "https://hub.example.com"})
        self.confirm("apple", "developer")

    def test_identifiers_key_and_token_endpoint(self):
        for body, wanted in (({"services_id": "nodots", "team_id": "TEAM123456"}, "reverse domain"),
                             ({"services_id": "dev.example.lookabout", "team_id": "short"}, "10 capital")):
            got = self.verify("apple", "identifiers", body)[1]
            self.assertEqual(got["state"], "failed")
            self.assertIn(wanted, got["reason"])
        got = self.verify("apple", "identifiers", {"services_id": "dev.example.lookabout", "team_id": "TEAM123456"})[1]
        self.assertEqual(got["state"], "passed")
        self.assertIn("10 capital", self.verify("apple", "key", {"key_id": "bad", "key": APPLE_PEM})[1]["reason"])
        self.assertIn(".p8", self.verify("apple", "key", {"key_id": "KEY1234567"})[1]["reason"])
        got = self.verify("apple", "key", {"key_id": "KEY1234567", "key": "not a key"})[1]
        self.assertEqual((got["state"], "isn't an Apple .p8" in got["reason"]), ("failed", True))
        got = self.verify("apple", "key", {"key_id": "KEY1234567", "key": APPLE_PEM})[1]
        self.assertEqual(got["state"], "passed")
        self.assertNotIn("BEGIN", json.dumps(self.api("GET", "/apple", token=self.admin)[1]))
        self.assertEqual(self.api("GET", "/apple", token=self.admin)[1]["values"]["key_id"], "KEY1234567")
        self.net.form_answer = {"error": "invalid_client"}
        got = self.verify("apple", "token-endpoint")[1]
        self.assertEqual((got["state"], "didn't accept" in got["reason"]), ("failed", True))
        url, form = self.net.forms[-1]
        self.assertEqual((url, form["client_id"], form["code"]), ("https://appleid.apple.com/auth/token", "dev.example.lookabout", "lookabout-setup-check"))
        self.assertEqual(form["client_secret"].count("."), 2)                        # a signed token, never the key
        self.assertNotIn("BEGIN", json.dumps(form))
        self.net.form_answer = {"error": "invalid_grant"}                           # Apple refused only the made-up code
        self.assertEqual(self.verify("apple", "token-endpoint")[1]["state"], "passed")
        self.assertEqual(self.verify("apple", "test-sign-in")[1]["state"], "failed")
        self.link_identity("apple", "sam@icloud.com")
        self.assertEqual(self.verify("apple", "test-sign-in")[1]["summary"], "Signed in with Apple as sam@icloud.com.")
        self.assertEqual(self.call("PUT", "/api/admin/auth/providers", {"apple": {"enabled": True}}, token=self.admin)[0], 200)


class RemoteTest(SetupCase):
    def setUp(self):
        super().setUp()
        self.admin_with()
        self.url = "https://hub.example.com"
        self.net.json[f"{self.url}/api/hub"] = {"id": self.store.hub_id(), "name": "Test hub", "version": "0.1.0"}

    def to_certificate(self, flow="remote-cloudflare"):
        if flow == "remote-cloudflare":
            self.run_to(flow, "certificate", {"domain": {"public_url": self.url}})
        else:
            self.store.set_meta("public_url", self.url)
            self.run_to(flow, "certificate")

    def test_domain_then_certificate(self):
        got = self.verify("remote-cloudflare", "domain", {"public_url": "https://pi.local"})[1]
        self.assertEqual(got["state"], "failed")
        self.to_certificate()
        self.assertEqual(self.state("remote-cloudflare", "tunnel")["manual"], True)
        got = self.verify("remote-cloudflare", "certificate")[1]
        self.assertEqual(got["state"], "passed")
        self.assertIn("hub.example.com", got["summary"])
        self.net.tls = ssl.SSLCertVerificationError("certificate verify failed")
        got = self.verify("remote-cloudflare", "certificate")[1]
        self.assertEqual((got["state"], "didn't work" in got["reason"]), ("failed", True))
        self.net.tls = self.clock[0] - 10
        self.assertIn("run out", self.verify("remote-cloudflare", "certificate")[1]["reason"])
        self.net.tls = OSError("refused")
        self.assertEqual(self.verify("remote-cloudflare", "certificate")[1]["state"], "failed")

    def test_certificate_needs_the_address_first(self):
        self.run_to("remote-tailscale", "certificate")
        got = self.verify("remote-tailscale", "certificate")[1]
        self.assertEqual((got["state"], "public https address" in got["reason"]), ("failed", True))

    def test_tailscale_gives_its_address_at_the_certificate_step(self):
        self.run_to("remote-tailscale", "certificate")
        got = self.verify("remote-tailscale", "certificate", {"public_url": "http://pi.tail1234.ts.net"})[1]
        self.assertEqual(got["state"], "failed")
        got = self.verify("remote-tailscale", "certificate", {"public_url": "https://pi.tail1234.ts.net"})[1]
        self.assertEqual((got["state"], self.store.meta("public_url")), ("passed", "https://pi.tail1234.ts.net"))

    def test_reach_self_knows_this_hub_from_another(self):
        self.to_certificate()
        self.verify("remote-cloudflare", "certificate")
        self.assertEqual(self.verify("remote-cloudflare", "reach-self")[1]["state"], "passed")
        self.net.json[f"{self.url}/api/hub"] = {"id": "someone-elses", "version": "1"}
        got = self.verify("remote-cloudflare", "reach-self")[1]
        self.assertEqual((got["state"], "isn't this hub" in got["reason"]), ("failed", True))
        self.net.json[f"{self.url}/api/hub"] = OSError("no route")
        self.assertIn("didn't answer", self.verify("remote-cloudflare", "reach-self")[1]["reason"])
        self.net.json[f"{self.url}/api/hub"] = ValueError("not json")
        self.assertEqual(self.verify("remote-cloudflare", "reach-self")[1]["state"], "failed")

    def finish_to_lockdown(self, flow="remote-cloudflare"):
        self.to_certificate(flow)
        self.assertEqual(self.verify(flow, "certificate")[1]["state"], "passed")
        self.assertEqual(self.verify(flow, "reach-self")[1]["state"], "passed")

    def test_the_lockdown_turns_remote_access_on_only_when_everything_holds(self):
        self.finish_to_lockdown()
        self.assertFalse(self.accounts.remote())
        got = self.verify("remote-cloudflare", "locked-down")[1]
        self.assertEqual((got["state"], self.accounts.remote()), ("passed", True))
        self.assertIn("7 days", got["summary"])
        brief = self.call("GET", "/api/hub")[1]
        self.assertEqual(sorted(brief), ["id", "name", "setup_required", "version"])      # strangers learn almost nothing now
        health = self.call("GET", "/api/admin/health", token=self.admin)[1]
        self.assertEqual(next(c for c in health["checks"] if c["id"] == "remote")["state"], "ok")

    def test_each_lock_down_rule(self):
        self.finish_to_lockdown()
        results = {what: ok for what, ok, _ in self.hub.setup.lockdown()}
        self.assertEqual(len(results), 4)
        self.assertTrue(all(results.values()), results)
        for label, setup in (("a route that answers a stranger", lambda: self.net.leaks.update({"/api/events": 200})),
                             ("go2rtc's port open", lambda: self.net.open_ports.add(1984))):
            setup()
            got = self.verify("remote-cloudflare", "locked-down")[1]
            self.assertEqual((label, got["state"], self.accounts.remote()), (label, "failed", False))
            self.net.leaks.clear()
            self.net.open_ports.clear()
        self.net.leaks["/api/events"] = 200
        self.assertIn("GET /api/events answered 200", self.verify("remote-cloudflare", "locked-down")[1]["reason"])

    def test_a_weak_admin_blocks_remote_access(self):
        _, member = self.invite(self.admin, "short@example.com", role="admin", password="tenletters1")
        self.finish_to_lockdown()
        got = self.verify("remote-cloudflare", "locked-down")[1]
        self.assertEqual(got["state"], "failed")
        self.assertIn("short@example.com", got["reason"])
        self.assertFalse(self.accounts.remote())
        # with a passkey the same admin is strong enough
        self.store._run("INSERT INTO passkeys (id, member_id, public_key, rp_id, created) VALUES ('k', ?, 'pem', 'hub.example.com', 0)",
                        (self.member("short@example.com")["id"],))
        self.assertEqual(self.verify("remote-cloudflare", "locked-down")[1]["state"], "passed")

    def test_tailscale_uses_the_same_checks(self):
        self.finish_to_lockdown("remote-tailscale")
        self.assertEqual(self.verify("remote-tailscale", "locked-down")[1]["state"], "passed")
        self.assertTrue(self.accounts.remote())

    def test_remote_access_can_be_turned_off_and_has_to_be_proven_again(self):
        self.finish_to_lockdown()
        self.verify("remote-cloudflare", "locked-down")
        status, got = self.call("POST", "/api/admin/remote/off", {}, token=self.admin)
        self.assertEqual((status, got), (200, {"remote": False}))
        self.assertFalse(self.accounts.remote())
        self.assertEqual(self.state("remote-cloudflare", "locked-down")["state"], "todo")
        self.assertIn("remote-access", [e["action"] for e in self.accounts.audit_log()])

    def test_sessions_shorten_when_remote_access_goes_on(self):
        token = self.admin
        self.finish_to_lockdown()
        self.verify("remote-cloudflare", "locked-down")
        self.assertEqual(self.call("GET", "/api/me", token=token)[1]["session"]["expires"], self.clock[0] + 7 * 86400)


class HealthTest(SetupCase):
    def test_the_panel(self):
        self.admin_with()
        health = self.call("GET", "/api/admin/health", token=self.admin)[1]
        by = {c["id"]: c for c in health["checks"]}
        self.assertEqual(by["admins"]["state"], "ok")
        self.assertEqual(by["public-url"]["state"], "warn")
        self.assertEqual(by["remote"]["state"], "ok")
        self.assertIn("Off", by["remote"]["detail"])
        self.assertEqual(by["video"]["state"], "ok")
        self.assertEqual(by["cry"]["state"], "warn")
        self.assertEqual(by["mdns"]["state"], "warn")
        self.assertEqual(by["mdns"]["flow"], "hub-install")
        self.assertEqual(by["disk"]["state"], "ok")
        self.assertEqual(health["state"], "warn")
        self.assertEqual(len(health["flows"]), 5)
        self.assertEqual(self.call("GET", "/api/admin/health")[0], 401)

    def test_states_follow_what_is_wrong(self):
        self.admin_with()
        self.bridge.available = False
        _, member = self.invite(self.admin, "short@example.com", role="admin", password="tenletters1")
        self.verify("google", "public-url", {"public_url": "http://nope"})
        with mock.patch("shutil.disk_usage", return_value=mock.Mock(free=5 << 20)):
            health = self.call("GET", "/api/admin/health", token=self.admin)[1]
        by = {c["id"]: c for c in health["checks"]}
        self.assertEqual((by["video"]["state"], by["google"]["state"], by["disk"]["state"], by["admins"]["state"]), ("bad", "bad", "warn", "warn"))
        self.assertIn("short@example.com", by["admins"]["detail"])
        self.assertIn("public-url", by["google"]["detail"])
        self.assertEqual(health["state"], "bad")
        self.assertEqual(by["google"]["flow"], "google")

    def test_a_provider_that_is_on_without_a_finished_wizard_is_flagged(self):
        self.admin_with()
        self.hub.federation.gate = None                                          # as if it were switched on by hand
        self.hub.federation.update({"public_url": "https://hub.example.com", "google": {"client_id": CLIENT_ID, "client_secret": "s", "enabled": True}})
        by = {c["id"]: c for c in self.call("GET", "/api/admin/health", token=self.admin)[1]["checks"]}
        self.assertEqual(by["google"]["state"], "warn")

    def test_remote_access_that_stops_holding_is_bad(self):
        self.admin_with()
        self.accounts.set_remote(True)
        self.net.leaks["/api/settings"] = 200
        by = {c["id"]: c for c in self.call("GET", "/api/admin/health", token=self.admin)[1]["checks"]}
        self.assertEqual(by["remote"]["state"], "bad")
        self.assertIn("/api/settings answered 200", by["remote"]["detail"])

    def test_the_vault_key_file(self):
        self.admin_with()
        self.hub.federation.update({"google": {"client_id": CLIENT_ID, "client_secret": "s"}})
        by = {c["id"]: c for c in self.call("GET", "/api/admin/health", token=self.admin)[1]["checks"]}
        self.assertEqual(by["vault"]["state"], "ok")
        os.chmod(os.path.join(self.dir.name, "keys", "vault.key"), 0o644)
        by = {c["id"]: c for c in self.call("GET", "/api/admin/health", token=self.admin)[1]["checks"]}
        self.assertEqual(by["vault"]["state"], "warn")


class NetTest(unittest.TestCase):
    def test_hostnames(self):
        for good in ("hub.example.com", "a.b.example.org"):
            self.assertTrue(setup_module._is_public_host(good), good)
        for bad in ("", None, "localhost", "pi.local", "192.168.1.5", "hub", "x.lan", "hub.example.internal"):
            self.assertFalse(setup_module._is_public_host(bad), bad)

    def test_port_open_and_local_request_against_a_real_listener(self):
        import http.server
        import threading

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(204)
                self.end_headers()

            def log_message(self, *a):
                pass
        server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        net = Net(None)
        port = server.server_address[1]
        try:
            self.assertTrue(net.port_open("127.0.0.1", port))
            self.assertEqual(net.local_request(port, "GET", "/x")[0], 204)
        finally:
            server.shutdown()
            server.server_close()
        self.assertFalse(net.port_open("127.0.0.1", port))


if __name__ == "__main__":
    unittest.main()
