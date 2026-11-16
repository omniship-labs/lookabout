"""Accounts and access: sign-in, sessions, camera groups, and who may call each route.

The AccessTest class has one case per row of the Enforcement table in docs/hub-auth.md.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from lookabout_hub import accounts as acc  # noqa: E402
from lookabout_hub.pairing import Pairing  # noqa: E402
from support import JPEG, PASSWORD, HubCase  # noqa: E402


class PasswordTest(unittest.TestCase):
    def test_hash_and_check(self):
        stored = acc.hash_password("a long enough one")
        self.assertTrue(acc.check_password("a long enough one", stored))
        self.assertFalse(acc.check_password("another one entirely", stored))
        self.assertNotEqual(stored, acc.hash_password("a long enough one"))   # salted
        self.assertFalse(acc.check_password("x", "not-a-hash"))
        self.assertFalse(acc.check_password("x", "md5$1$1$1$00$00"))

    def test_rules(self):
        for bad in ("short", "1234567890", "aaaaaaaaaaaa", None, 12345678901):
            with self.assertRaises(acc.Problem, msg=bad):
                acc.check_new_password(bad)
        acc.check_new_password("tenletters1")

    def test_email(self):
        self.assertEqual(acc.clean_email("  Sam@Example.COM "), "sam@example.com")
        for bad in ("", "sam", "a@b@c", "@x.com", "sam@", "sa m@x.com", None):
            with self.assertRaises(acc.Problem, msg=bad):
                acc.clean_email(bad)


class SetupTest(HubCase):
    def test_a_new_hub_waits_for_its_first_admin(self):
        self.assertEqual(self.call("GET", "/api/hub")[1]["setup_required"], True)
        for method, path in (("GET", "/api/cameras"), ("GET", "/api/events"), ("GET", "/api/me"),
                             ("POST", "/api/cameras/x/webrtc")):
            status, body = self.call(method, path, body={} if method == "POST" else None)
            self.assertEqual((status, body["code"]), (423, "setup_required"), path)
        providers = self.call("GET", "/api/auth/providers")[1]
        self.assertEqual((providers["setup_required"], providers["providers"][0]["id"]), (True, "local"))

    def test_setup_code_is_shown_on_the_home_network(self):
        state = self.call("GET", "/api/setup/state")[1]
        self.assertEqual(state["setup_required"], True)
        self.assertRegex(state["setup_code"], r"^[A-Z2-9]{4}-[A-Z2-9]{4}$")
        self.assertEqual(state["setup_code"], self.call("GET", "/api/setup/state")[1]["setup_code"])
        self.signin()
        self.assertEqual(self.call("GET", "/api/setup/state")[1], {"setup_required": False, "setup_code": None, "devices": 0})

    def test_first_admin(self):
        body = {"name": "Sam", "email": "sam@example.com", "password": PASSWORD}
        status, wrong = self.call("POST", "/api/setup/first-admin", {**body, "setup_code": "AAAA-AAAA"})
        self.assertEqual((status, wrong["code"]), (403, "bad_code"))
        code = self.accounts.setup_code()
        status, _ = self.call("POST", "/api/setup/first-admin", {**body, "setup_code": code, "password": "short"})
        self.assertEqual(status, 400)           # the code is not used up by a rejected password
        status, _, headers = self.send("POST", "/api/setup/first-admin", {**body, "setup_code": code.lower()})
        self.assertEqual(status, 201)
        self.assertIn("lk_session=", headers["Set-Cookie"])
        self.assertIn("HttpOnly", headers["Set-Cookie"])
        self.assertIn("SameSite=Lax", headers["Set-Cookie"])
        self.assertIn("Max-Age=2592000", headers["Set-Cookie"])
        self.assertNotIn("Secure", headers["Set-Cookie"])
        status, again = self.call("POST", "/api/setup/first-admin", {**body, "setup_code": code})
        self.assertEqual((status, again["code"]), (409, "conflict"))

    def test_five_wrong_setup_codes_cancel_it(self):
        code = self.accounts.setup_code()
        for _ in range(5):
            self.call("POST", "/api/setup/first-admin", {"setup_code": "AAAA-AAAA", "email": "a@b.co", "password": PASSWORD})
        status, _ = self.call("POST", "/api/setup/first-admin", {"setup_code": code, "email": "a@b.co", "password": PASSWORD})
        self.assertEqual(status, 403)
        self.assertNotEqual(self.accounts.setup_code(), code)

    def test_cookie_is_secure_behind_https(self):
        code = self.accounts.setup_code()
        status, _, headers = self.send("POST", "/api/setup/first-admin",
                                       {"setup_code": code, "email": "a@b.co", "password": PASSWORD},
                                       headers={"X-Forwarded-Proto": "https"})
        self.assertEqual(status, 201)
        self.assertIn("; Secure", headers["Set-Cookie"])

    def test_pairing_keys_from_before_accounts(self):
        _, old = self.store.add_viewer("Old phone", "ios")
        camera = self.store.add_camera({"name": "Garage", "kind": "mjpeg", "address": "http://10.0.0.9"})
        self.bridge.add(camera, [camera])
        event = self.store.add_event("motion", camera, started=100, ended=110)
        self.assertEqual(self.call("GET", "/api/setup/state")[1]["devices"], 1)
        self.assertEqual(self.call("GET", "/api/cameras", token=old)[0], 200)             # can still watch
        self.assertEqual(self.call("GET", f"/api/cameras/{camera['id']}/snapshot.jpg?token={old}", raw=True)[0], 200)
        for method, path in (("POST", "/api/cameras"), ("PATCH", f"/api/cameras/{camera['id']}"),
                             ("PUT", f"/api/cameras/{camera['id']}/zones"), ("DELETE", f"/api/events/{event}"),
                             ("PATCH", "/api/settings"), ("GET", "/api/usb"), ("GET", "/api/household"),
                             ("POST", f"/api/cameras/{camera['id']}/ticket")):
            status, body = self.call(method, path, {}, token=old)
            self.assertEqual((status, body["code"]), (423, "setup_required"), path)
        self.assertEqual(self.call("GET", "/api/cameras", token="made-up")[0], 423)
        self.signin()                                    # the first admin ends every old key (Q8)
        self.assertEqual(self.call("GET", "/api/cameras", token=old)[0], 401)
        self.assertEqual(self.call("GET", f"/api/cameras/{camera['id']}/snapshot.jpg?token={old}")[0], 401)
        self.assertEqual(self.store.viewers(), [])


class SessionTest(HubCase):
    def login(self, password=PASSWORD, email="sam@example.com", headers=None):
        return self.send("POST", "/api/auth/login/local", {"email": email, "password": password}, headers=headers)

    def test_cookie_session_and_origin_check(self):
        self.signin()
        status, _, headers = self.login()
        self.assertEqual(status, 200)
        cookie = headers["Set-Cookie"].split(";")[0]
        host = self.base.split("//")[1]
        self.assertEqual(self.call("GET", "/api/me", headers={"Cookie": cookie})[0], 200)
        # A change made with the cookie must come from the hub's own page.
        patch = {"name": "Samantha"}
        status, body = self.call("PATCH", "/api/me", patch, headers={"Cookie": cookie})
        self.assertEqual((status, body["code"]), (403, "bad_origin"))
        status, body = self.call("PATCH", "/api/me", patch, headers={"Cookie": cookie, "Origin": "https://evil.example"})
        self.assertEqual((status, body["code"]), (403, "bad_origin"))
        status, body = self.call("PATCH", "/api/me", patch, headers={"Cookie": cookie, "Origin": "http://" + host})
        self.assertEqual((status, body["member"]["name"]), (200, "Samantha"))
        # Apps use bearer tokens, which no other website can send, so they need no Origin.
        token = self.signin()
        self.assertEqual(self.call("PATCH", "/api/me", {"name": "Sam"}, token=token)[0], 200)
        # A page on another site can't even sign in.
        status, body = self.call("POST", "/api/auth/login/local", {"email": "sam@example.com", "password": PASSWORD},
                                 headers={"Origin": "https://evil.example"})
        self.assertEqual((status, body["code"]), (403, "bad_origin"))
        # The public address, once set, counts as the hub's own.
        self.store.set_meta("public_url", "https://hub.example.com")
        status, _ = self.call("PATCH", "/api/me", patch, headers={"Cookie": cookie, "Origin": "https://hub.example.com"})
        self.assertEqual(status, 200)

    def test_logout_ends_the_session(self):
        self.signin()
        _, _, headers = self.login()
        cookie = headers["Set-Cookie"].split(";")[0]
        host = "http://" + self.base.split("//")[1]
        status, _, out = self.send("POST", "/api/auth/logout", {}, headers={"Cookie": cookie, "Origin": host})
        self.assertEqual(status, 200)
        self.assertIn("Max-Age=0", out["Set-Cookie"])
        self.assertEqual(self.call("GET", "/api/me", headers={"Cookie": cookie})[0], 401)

    def test_wrong_password_and_unknown_email_look_the_same(self):
        self.signin()
        one = self.login("not the password")
        two = self.login(email="nobody@example.com")
        self.assertEqual((one[0], two[0]), (401, 401))
        self.assertEqual(one[1], two[1])
        self.assertEqual(one[1]["code"], "bad_sign_in")

    def test_lockout_after_ten_failures_from_one_address(self):
        self.signin()
        for _ in range(10):
            self.assertEqual(self.login("wrong password")[0], 401)
        status, body, headers = self.login("wrong password")
        self.assertEqual((status, body["code"]), (429, "too_many_tries"))
        self.assertGreater(int(headers["Retry-After"]), 0)
        self.assertEqual(self.login()[0], 429)       # even the right password waits
        other = self.login(headers={"X-Forwarded-For": "192.168.1.50"})
        self.assertEqual(other[0], 200)              # the owner can still sign in from elsewhere
        self.clock[0] += 901
        self.assertEqual(self.login()[0], 200)

    def test_session_slides_and_expires(self):
        token = self.signin()
        day = 86400
        first = self.call("GET", "/api/me", token=token)[1]["session"]["expires"]
        self.clock[0] += 10 * day
        self.assertEqual(self.call("GET", "/api/me", token=token)[1]["session"]["expires"], first)   # not yet in the last 7 days
        self.clock[0] += 15 * day
        extended = self.call("GET", "/api/me", token=token)[1]["session"]["expires"]
        self.assertEqual(extended, self.clock[0] + 30 * day)
        self.clock[0] += 31 * day
        self.assertEqual(self.call("GET", "/api/me", token=token)[0], 401)

    def test_remote_access_shortens_sessions(self):
        token = self.signin()
        day = 86400
        self.accounts.set_remote(True)
        self.assertEqual(self.call("GET", "/api/me", token=token)[1]["session"]["expires"], self.clock[0] + 7 * day)
        self.assertEqual(self.signin() != token, True)
        again = self.call("POST", "/api/auth/login/local?app=1", {"email": "sam@example.com", "password": PASSWORD})[1]["token"]
        self.assertEqual(self.call("GET", "/api/me", token=again)[1]["session"]["expires"], self.clock[0] + 7 * day)
        self.assertEqual(self.call("GET", "/api/hub", token=again)[1]["cameras"], 0)
        brief = self.call("GET", "/api/hub")[1]
        self.assertEqual(sorted(brief), ["id", "name", "setup_required", "version"])   # nothing more for strangers
        self.accounts.set_remote(False)
        self.assertIn("cameras", self.call("GET", "/api/hub")[1])

    def test_no_other_site_may_read_the_hub(self):
        self.signin()
        status, _, headers = self.send("GET", "/api/hub", headers={"Origin": "https://pages.example"})
        self.assertEqual(status, 200)
        self.assertEqual([h for h in headers if h.lower().startswith("access-control")], [])
        status, _, headers = self.send("OPTIONS", "/api/cameras", headers={"Origin": "https://pages.example"})
        self.assertEqual(status, 405)
        self.assertEqual([h for h in headers if h.lower().startswith("access-control")], [])


class AccessTest(HubCase):
    """Cameras: cam1 and cam2 in groups, cam3 in none. Sam is the admin."""

    def setUp(self):
        super().setUp()
        self.admin = self.signin()
        self.cam1, self.cam2, self.cam3 = (self.camera(self.admin, f"10.0.0.{n}", f"Camera {n}") for n in (1, 2, 3))
        self.nursery = self.call("POST", "/api/household/groups", {"name": "Nursery", "cameras": [self.cam1["id"]]}, token=self.admin)[1]
        self.outside = self.call("POST", "/api/household/groups", {"name": "Outside", "cameras": [self.cam2["id"]]}, token=self.admin)[1]
        grant = lambda group, level: [{"group": group["id"], "level": level}]  # noqa: E731
        self.v_id, self.viewer = self.invite(self.admin, "vera@example.com", grants=grant(self.nursery, "view"))
        self.m_id, self.manager = self.invite(self.admin, "max@example.com", grants=grant(self.nursery, "manage"))
        self.o_id, self.other = self.invite(self.admin, "olga@example.com")
        self.event = self.store.add_event("motion", self.store.camera(self.cam1["id"]), started=100, ended=110)
        self.event3 = self.store.add_event("motion", self.store.camera(self.cam3["id"]), started=100, ended=110)

    # --- every route says who may use it ---------------------------------

    def test_no_session_is_401(self):
        cam = self.cam1["id"]
        for method, path in (("GET", "/api/cameras"), ("POST", "/api/cameras"), ("POST", "/api/cameras/test"),
                             ("PATCH", f"/api/cameras/{cam}"), ("DELETE", f"/api/cameras/{cam}"),
                             ("GET", f"/api/cameras/{cam}/snapshot.jpg"), ("GET", f"/api/cameras/{cam}/stream.mjpeg"),
                             ("POST", f"/api/cameras/{cam}/webrtc"), ("POST", f"/api/cameras/{cam}/ticket"),
                             ("GET", f"/api/cameras/{cam}/zones"), ("PUT", f"/api/cameras/{cam}/zones"), ("GET", "/api/usb"),
                             ("GET", "/api/events"), ("DELETE", f"/api/events/{self.event}"), ("GET", f"/api/clips/{self.event}.mp4"),
                             ("GET", "/api/settings"), ("PATCH", "/api/settings"), ("GET", "/api/me"), ("GET", "/api/household"),
                             ("POST", "/api/household/invites"), ("GET", "/api/admin/audit"), ("POST", "/api/pairing/code"),
                             ("GET", "/api/household/sessions"), ("POST", f"/api/groups/{self.nursery['id']}/shares")):
            status, body = self.call(method, path, body={} if method != "GET" else None)
            self.assertEqual((status, body["code"]), (401, "not_signed_in"), path)

    def test_member_without_the_camera_gets_404(self):
        cam = self.cam1["id"]
        for method, path, body in (("GET", f"/api/cameras/{cam}/snapshot.jpg", None), ("GET", f"/api/cameras/{cam}/stream.mjpeg", None),
                                   ("POST", f"/api/cameras/{cam}/webrtc", b"offer"), ("POST", f"/api/cameras/{cam}/ticket", {}),
                                   ("GET", f"/api/cameras/{cam}/zones", None), ("PUT", f"/api/cameras/{cam}/zones", {"zones": []}),
                                   ("PATCH", f"/api/cameras/{cam}", {"name": "x"}), ("DELETE", f"/api/events/{self.event}", None),
                                   ("GET", f"/api/clips/{self.event}.mp4", None)):
            for token in (self.other, self.viewer if "cam3" in path else self.other):
                status, got = self.call(method, path, body, token=token)
                self.assertEqual((status, got["code"]), (404, "not_found"), path)
        # a camera in no group is for admins only, and says the same as one that doesn't exist
        for token in (self.viewer, self.manager):
            for path in (f"/api/cameras/{self.cam3['id']}/snapshot.jpg", "/api/cameras/cam-nothing/snapshot.jpg"):
                self.assertEqual(self.call("GET", path, token=token)[0], 404, path)

    def test_view_reads_but_cannot_manage(self):
        cam = self.cam1["id"]
        self.assertEqual(self.call("GET", f"/api/cameras/{cam}/snapshot.jpg", token=self.viewer, raw=True), (200, JPEG))
        self.assertEqual(self.call("POST", f"/api/cameras/{cam}/webrtc", b"offer", token=self.viewer, raw=True)[0], 201)
        self.assertEqual(self.call("GET", f"/api/cameras/{cam}/zones", token=self.viewer)[0], 200)
        self.assertEqual(self.call("POST", f"/api/cameras/{cam}/ticket", {}, token=self.viewer)[0], 200)
        self.assertEqual(self.call("GET", "/api/settings", token=self.viewer)[0], 200)
        for method, path, body in (("PATCH", f"/api/cameras/{cam}", {"name": "x"}), ("PUT", f"/api/cameras/{cam}/zones", {"zones": []}),
                                   ("DELETE", f"/api/events/{self.event}", None)):
            status, got = self.call(method, path, body, token=self.viewer)
            self.assertEqual((status, got["code"]), (403, "manage_only"), path)
        self.assertIsNotNone(self.store.event(self.event))
        self.assertEqual(self.store.camera(cam)["name"], "Camera 1")

    def test_manage_changes_its_cameras_only(self):
        cam = self.cam1["id"]
        self.assertEqual(self.call("PATCH", f"/api/cameras/{cam}", {"name": "Baby"}, token=self.manager)[1]["name"], "Baby")
        self.assertEqual(self.call("PUT", f"/api/cameras/{cam}/zones", {"zones": [], "sensitivity": 70}, token=self.manager)[0], 200)
        self.assertEqual(self.call("DELETE", f"/api/events/{self.event}", token=self.manager)[0], 200)
        self.assertEqual(self.call("PATCH", f"/api/cameras/{self.cam2['id']}", {"name": "x"}, token=self.manager)[0], 404)
        self.assertEqual(self.call("DELETE", f"/api/events/{self.event3}", token=self.manager)[0], 404)

    def test_admin_only_routes(self):
        cam = self.cam1["id"]
        rows = (("POST", "/api/cameras", {"kind": "mjpeg", "name": "x", "address": "10.9.9.9"}),
                                   ("POST", "/api/cameras/test", {"kind": "mjpeg", "address": "10.0.0.9"}),
                                   ("DELETE", f"/api/cameras/{cam}", None), ("GET", "/api/usb", None),
                                   ("PATCH", "/api/settings", {"keep_days": 3}), ("GET", "/api/admin/audit", None),
                                   ("POST", "/api/household/invites", {"email": "x@y.zz"}), ("GET", "/api/household/sessions", None),
                                   ("POST", "/api/household/groups", {"name": "x"}), ("POST", "/api/pairing/code", {}),
                                   ("PATCH", f"/api/household/members/{self.v_id}", {"role": "admin"}),
                                   ("DELETE", f"/api/household/members/{self.v_id}", None),
                                   ("DELETE", f"/api/household/invites/{self.v_id}", None),
                                   ("PATCH", f"/api/household/groups/{self.nursery['id']}", {"name": "x"}),
                                   ("DELETE", f"/api/household/groups/{self.nursery['id']}", None))
        for method, path, body in rows:
            for token in (self.viewer, self.manager):
                status, got = self.call(method, path, body, token=token)
                self.assertEqual((status, got["code"]), (403, "admin_only"), path)
        for method, path, body in rows:      # last, because some of these remove the members above
            self.assertNotEqual(self.call(method, path, body, token=self.admin, raw=True)[0], 403, path)

    def test_admin_sees_everything(self):
        self.assertEqual({c["id"] for c in self.call("GET", "/api/cameras", token=self.admin)[1]["cameras"]},
                         {self.cam1["id"], self.cam2["id"], self.cam3["id"]})
        self.assertEqual(self.call("GET", f"/api/cameras/{self.cam3['id']}/snapshot.jpg", token=self.admin, raw=True), (200, JPEG))

    def test_lists_are_filtered(self):
        def names(token):
            return sorted(c["name"] for c in self.call("GET", "/api/cameras", token=token)[1]["cameras"])
        self.assertEqual((names(self.viewer), names(self.manager), names(self.other)), (["Camera 1"], ["Camera 1"], []))
        cameras = self.call("GET", "/api/cameras", token=self.manager)[1]["cameras"]
        self.assertEqual(cameras[0]["access"], "manage")
        self.assertEqual(self.call("GET", "/api/cameras", token=self.viewer)[1]["cameras"][0]["access"], "view")

        def events(token):
            return sorted(e["camera_id"] for e in self.call("GET", "/api/events", token=token)[1]["events"])
        self.assertEqual(events(self.viewer), [self.cam1["id"]])
        self.assertEqual(events(self.other), [])
        self.assertEqual(events(self.admin), sorted([self.cam1["id"], self.cam3["id"]]))

    def test_events_of_a_removed_camera_are_for_admins(self):
        self.call("DELETE", f"/api/cameras/{self.cam1['id']}", token=self.admin)
        self.assertEqual(self.call("GET", "/api/events", token=self.manager)[1]["events"], [])
        self.assertEqual(self.call("DELETE", f"/api/events/{self.event}", token=self.manager)[0], 403)
        self.assertEqual(self.call("DELETE", f"/api/events/{self.event}", token=self.admin)[0], 200)
        self.assertEqual(self.call("DELETE", "/api/events/99999", token=self.admin)[0], 404)

    def test_clips_follow_their_event(self):
        os.makedirs(os.path.join(self.dir.name, "clips"), exist_ok=True)
        for event in (self.event, self.event3):
            with open(os.path.join(self.dir.name, "clips", f"{event}.jpg"), "wb") as f:
                f.write(JPEG)
        self.hub.clips = type("Clips", (), {"path": lambda _s, name: os.path.join(self.dir.name, "clips", name)
                                            if os.path.isfile(os.path.join(self.dir.name, "clips", name)) else None,
                                            "remove": lambda *_a: None})()
        self.assertEqual(self.call("GET", f"/api/clips/{self.event}.jpg", token=self.viewer, raw=True), (200, JPEG))
        self.assertEqual(self.call("GET", f"/api/clips/{self.event3}.jpg", token=self.viewer)[0], 404)
        self.assertEqual(self.call("GET", f"/api/clips/{self.event3}.jpg", token=self.admin, raw=True), (200, JPEG))
        self.assertEqual(self.call("GET", "/api/clips/notanevent.jpg", token=self.admin)[0], 404)
        self.assertEqual(self.call("GET", "/api/clips/999.jpg", token=self.admin)[0], 404)

    # --- tickets -----------------------------------------------------------

    def test_ticket_is_for_one_camera_and_a_few_routes(self):
        cam1, cam2 = self.cam1["id"], self.cam2["id"]
        made = self.call("POST", f"/api/cameras/{cam1}/ticket", {}, token=self.viewer)[1]
        ticket = made["ticket"]
        self.assertEqual(made["expires"], self.clock[0] + 300)
        self.assertEqual(self.call("GET", f"/api/cameras/{cam1}/snapshot.jpg?ticket={ticket}", raw=True), (200, JPEG))
        self.assertEqual(self.call("GET", f"/api/cameras/{cam1}/snapshot.jpg?ticket={ticket}", raw=True), (200, JPEG))   # reusable
        self.assertEqual(self.call("GET", f"/api/cameras/{cam2}/snapshot.jpg?ticket={ticket}")[0], 401)   # another camera
        self.assertEqual(self.call("GET", f"/api/cameras/{cam1}/zones?ticket={ticket}")[0], 401)           # not a ticket route
        self.assertEqual(self.call("GET", f"/api/cameras?ticket={ticket}")[0], 401)
        self.assertEqual(self.call("GET", f"/api/cameras/{cam1}/snapshot.jpg?ticket=nope")[0], 401)
        self.assertEqual(self.call("GET", f"/api/cameras/{cam1}/snapshot.jpg?token={self.viewer}")[0], 401)   # no session in a URL
        self.clock[0] += 301
        self.assertEqual(self.call("GET", f"/api/cameras/{cam1}/snapshot.jpg?ticket={ticket}")[0], 401)

    def test_ticket_ends_with_the_member(self):
        cam = self.cam1["id"]
        ticket = self.call("POST", f"/api/cameras/{cam}/ticket", {}, token=self.viewer)[1]["ticket"]
        self.call("DELETE", f"/api/household/members/{self.v_id}", token=self.admin)
        self.assertEqual(self.call("GET", f"/api/cameras/{cam}/snapshot.jpg?ticket={ticket}")[0], 401)

    # --- groups, grants and sharing -----------------------------------------

    def test_changes_to_grants_apply_at_once(self):
        cam = self.cam1["id"]
        self.assertEqual(self.call("GET", f"/api/cameras/{cam}/snapshot.jpg", token=self.other, raw=True)[0], 404)
        self.call("PATCH", f"/api/household/members/{self.o_id}",
                  {"grants": [{"group": self.nursery["id"], "level": "view"}]}, token=self.admin)
        self.assertEqual(self.call("GET", f"/api/cameras/{cam}/snapshot.jpg", token=self.other, raw=True)[0], 200)
        self.call("PATCH", f"/api/household/groups/{self.nursery['id']}", {"cameras": [self.cam3["id"]]}, token=self.admin)       # the group now holds another camera
        self.assertEqual(self.call("GET", f"/api/cameras/{cam}/snapshot.jpg", token=self.other)[0], 404)
        self.assertEqual(self.call("GET", f"/api/cameras/{self.cam3['id']}/snapshot.jpg", token=self.other, raw=True)[0], 200)

    def test_the_higher_grant_wins_and_a_camera_can_be_in_two_groups(self):
        self.call("PATCH", f"/api/household/groups/{self.outside['id']}", {"cameras": [self.cam2["id"], self.cam1["id"]]}, token=self.admin)
        self.call("PATCH", f"/api/household/members/{self.v_id}", {"grants": [
            {"group": self.nursery["id"], "level": "view"}, {"group": self.outside["id"], "level": "manage"}]}, token=self.admin)
        me = self.call("GET", "/api/me", token=self.viewer)[1]
        self.assertEqual(me["cameras"], {self.cam1["id"]: "manage", self.cam2["id"]: "manage"})
        self.assertEqual([(g["name"], g["level"]) for g in me["groups"]], [("Nursery", "view"), ("Outside", "manage")])

    def test_me(self):
        me = self.call("GET", "/api/me", token=self.admin)[1]
        self.assertEqual((me["member"]["role"], me["cameras"], me["groups"]), ("admin", "all", "all"))
        self.assertEqual(me["sign_in"], {"password": True, "passkeys": 0, "google": None, "apple": None, "address": "127.0.0.1"})
        self.assertEqual(me["household"]["name"], "Test hub")
        self.assertEqual(self.call("GET", "/api/me", token=self.other)[1]["cameras"], {})
        self.assertNotIn("password", str(self.call("GET", "/api/me", token=self.admin)[1]).replace("'password': True", ""))

    def test_groups(self):
        status, bad = self.call("POST", "/api/household/groups", {"name": "x", "cameras": ["cam-nope"]}, token=self.admin)
        self.assertEqual(status, 400)
        self.assertEqual(self.call("POST", "/api/household/groups", {"name": " "}, token=self.admin)[0], 400)
        self.assertEqual(self.call("PATCH", "/api/household/groups/g-nope", {"name": "x"}, token=self.admin)[0], 404)
        self.assertEqual(self.call("PATCH", f"/api/household/groups/{self.outside['id']}", {"name": " "}, token=self.admin)[0], 400)
        renamed = self.call("PATCH", f"/api/household/groups/{self.outside['id']}", {"name": "Garden"}, token=self.admin)[1]
        self.assertEqual((renamed["name"], renamed["cameras"]), ("Garden", [self.cam2["id"]]))
        # Removing a group takes its grants with it; the cameras stay, for admins.
        self.call("DELETE", f"/api/household/groups/{self.nursery['id']}", token=self.admin)
        self.assertEqual(self.call("GET", "/api/cameras", token=self.viewer)[1]["cameras"], [])
        self.assertEqual(self.call("DELETE", "/api/household/groups/g-nope", token=self.admin)[0], 404)
        self.assertEqual(len(self.call("GET", "/api/cameras", token=self.admin)[1]["cameras"]), 3)

    def test_a_removed_camera_leaves_its_groups(self):
        self.call("DELETE", f"/api/cameras/{self.cam1['id']}", token=self.admin)
        household = self.call("GET", "/api/household", token=self.admin)[1]
        self.assertEqual([g["cameras"] for g in household["groups"] if g["id"] == self.nursery["id"]], [[]])

    def test_new_cameras_are_admin_only_until_grouped(self):
        new = self.camera(self.admin, "10.0.0.50", "New")
        self.assertEqual(self.call("GET", f"/api/cameras/{new['id']}/snapshot.jpg", token=self.manager)[0], 404)
        grouped = self.camera(self.admin, "10.0.0.51", "Grouped", groups=[self.nursery["id"]])
        self.assertEqual(self.call("GET", f"/api/cameras/{grouped['id']}/snapshot.jpg", token=self.viewer, raw=True)[0], 200)
        status, bad = self.call("POST", "/api/cameras", {"kind": "mjpeg", "name": "x", "address": "10.0.0.52", "groups": ["g-nope"]}, token=self.admin)
        self.assertEqual(status, 400)
        self.assertEqual(len(self.store.cameras()), 5)

    def test_a_manager_shares_a_group_as_view_only(self):
        nursery = self.nursery["id"]
        status, _ = self.call("POST", f"/api/groups/{nursery}/shares", {"member": self.o_id}, token=self.manager)
        self.assertEqual(status, 201)
        self.assertEqual(self.call("GET", f"/api/cameras/{self.cam1['id']}/snapshot.jpg", token=self.other, raw=True)[0], 200)
        self.assertEqual(self.call("PATCH", f"/api/cameras/{self.cam1['id']}", {"name": "x"}, token=self.other)[1]["code"], "manage_only")
        status, dup = self.call("POST", f"/api/groups/{nursery}/shares", {"member": self.o_id}, token=self.manager)
        self.assertEqual((status, dup["code"]), (409, "conflict"))
        self.assertEqual(self.call("POST", f"/api/groups/{nursery}/shares", {"member": "m-nope"}, token=self.manager)[0], 404)
        # Only the manager's own shares can be taken back by them.
        grants = self.call("GET", "/api/household", token=self.admin)[1]["members"]
        olga = next(m for m in grants if m["id"] == self.o_id)
        self.assertEqual(olga["grants"], [{"group": nursery, "level": "view", "by": self.m_id}])
        status, got = self.call("DELETE", f"/api/groups/{nursery}/shares/{self.v_id}", token=self.manager)
        self.assertEqual((status, got["code"]), (403, "not_yours"))        # an admin gave Vera hers
        self.assertEqual(self.call("DELETE", f"/api/groups/{nursery}/shares/{self.o_id}", token=self.manager)[0], 200)
        self.assertEqual(self.call("GET", f"/api/cameras/{self.cam1['id']}/snapshot.jpg", token=self.other)[0], 404)
        self.assertEqual(self.call("DELETE", f"/api/groups/{nursery}/shares/{self.v_id}", token=self.admin)[0], 200)
        self.assertEqual(self.call("DELETE", f"/api/groups/{nursery}/shares/{self.o_id}", token=self.admin)[0], 404)

    def test_who_may_share(self):
        nursery, outside = self.nursery["id"], self.outside["id"]
        status, got = self.call("POST", f"/api/groups/{nursery}/shares", {"member": self.o_id}, token=self.viewer)
        self.assertEqual((status, got["code"]), (403, "manage_only"))
        self.assertEqual(self.call("POST", f"/api/groups/{outside}/shares", {"member": self.o_id}, token=self.manager)[0], 404)
        self.assertEqual(self.call("POST", "/api/groups/g-nope/shares", {"member": self.o_id}, token=self.manager)[0], 404)
        self.assertEqual(self.call("POST", f"/api/groups/{outside}/shares", {"member": self.o_id}, token=self.admin)[0], 201)

    # --- household ---------------------------------------------------------

    def test_household_for_members_and_admins(self):
        mine = self.call("GET", "/api/household", token=self.viewer)[1]
        self.assertEqual(sorted(m["name"] for m in mine["members"]), ["Sam", "max", "olga", "vera"])
        self.assertNotIn("email", str(mine))
        self.assertNotIn("grants", str(mine))
        self.assertEqual([g["name"] for g in mine["groups"]], ["Nursery"])
        full = self.call("GET", "/api/household", token=self.admin)[1]
        self.assertIn("vera@example.com", str(full))
        self.assertEqual(len(full["groups"]), 2)

    def test_the_last_admin_stays(self):
        sam = self.call("GET", "/api/me", token=self.admin)[1]["member"]["id"]
        for method, body in (("PATCH", {"role": "member"}), ("DELETE", None)):
            status, got = self.call(method, f"/api/household/members/{sam}", body, token=self.admin)
            self.assertEqual((status, got["code"]), (409, "conflict"))
        self.call("PATCH", f"/api/household/members/{self.m_id}", {"role": "admin"}, token=self.admin)
        self.assertEqual(len(self.call("GET", "/api/cameras", token=self.manager)[1]["cameras"]), 3)   # now sees all
        self.assertEqual(self.call("PATCH", f"/api/household/members/{sam}", {"role": "member"}, token=self.admin)[0], 200)

    def test_changing_and_removing_members(self):
        base = "/api/household/members"
        self.assertEqual(self.call("PATCH", f"{base}/m-nope", {"name": "x"}, token=self.admin)[0], 404)
        self.assertEqual(self.call("PATCH", f"{base}/{self.v_id}", {"role": "boss"}, token=self.admin)[0], 400)
        self.assertEqual(self.call("PATCH", f"{base}/{self.v_id}", {"grants": [{"group": "g-nope", "level": "view"}]}, token=self.admin)[0], 400)
        self.assertEqual(self.call("PATCH", f"{base}/{self.v_id}", {"grants": [{"group": self.nursery["id"], "level": "owner"}]}, token=self.admin)[0], 400)
        self.assertEqual(self.call("PATCH", f"{base}/{self.v_id}", {"grants": "all"}, token=self.admin)[0], 400)
        self.assertEqual(self.call("PATCH", f"{base}/{self.v_id}", {"name": "Vera P."}, token=self.admin)[1]["name"], "Vera P.")
        self.assertEqual(self.call("DELETE", f"{base}/m-nope", token=self.admin)[0], 404)
        self.assertEqual(self.call("DELETE", f"{base}/{self.v_id}", token=self.admin)[0], 200)
        self.assertEqual(self.call("GET", "/api/me", token=self.viewer)[0], 401)       # their sessions end with them

    def test_invites(self):
        status, made = self.call("POST", "/api/household/invites", {"email": "Alex@Example.com", "role": "member",
                                                                    "grants": [{"group": self.nursery["id"], "level": "view"}]}, token=self.admin)
        self.assertEqual((status, made["status"], made["email"]), (201, "invited", "alex@example.com"))
        host = self.base.split("//")[1]
        self.assertTrue(made["invite_link"].startswith(f"http://{host}/#/join?invite="))
        self.assertEqual(made["expires"], self.clock[0] + 7 * 86400)
        invite = made["invite_link"].split("invite=")[1]
        self.assertEqual(self.call("POST", "/api/household/invites", {"email": "alex@example.com"}, token=self.admin)[0], 409)
        self.assertEqual(self.call("POST", "/api/household/invites", {"email": "nope"}, token=self.admin)[0], 400)
        self.assertEqual(self.call("POST", "/api/household/invites", {"email": "q@r.st", "role": "boss"}, token=self.admin)[0], 400)
        self.assertEqual(self.call("POST", "/api/household/invites", {"email": "q@r.st", "grants": [{"group": "g-x", "level": "view"}]}, token=self.admin)[0], 400)
        self.assertEqual(self.call("POST", "/api/auth/login/local", {"email": "alex@example.com", "password": PASSWORD})[0], 401)   # not yet
        self.assertEqual(self.call("POST", "/api/auth/join", {"invite": invite, "name": "Alex", "password": "short"})[0], 400)
        status, joined, headers = self.send("POST", "/api/auth/join", {"invite": invite, "name": "Alex", "password": PASSWORD})
        self.assertEqual((status, joined["me"]["name"]), (201, "Alex"))
        self.assertIn("lk_session=", headers["Set-Cookie"])
        status, got = self.call("POST", "/api/auth/join", {"invite": invite, "name": "Again", "password": PASSWORD})
        self.assertEqual((status, got["code"]), (404, "bad_invite"))                     # one use only
        alex = self.call("POST", "/api/auth/login/local?app=1", {"email": "alex@example.com", "password": PASSWORD})[1]["token"]
        self.assertEqual(len(self.call("GET", "/api/cameras", token=alex)[1]["cameras"]), 1)

    def test_invites_run_out_and_can_be_cancelled(self):
        made = self.call("POST", "/api/household/invites", {"email": "late@example.com"}, token=self.admin)[1]
        invite = made["invite_link"].split("invite=")[1]
        self.clock[0] += 8 * 86400
        self.assertEqual(self.call("POST", "/api/auth/join", {"invite": invite, "password": PASSWORD})[0], 404)
        gone = self.call("POST", "/api/household/invites", {"email": "gone@example.com"}, token=self.admin)[1]
        self.assertEqual(self.call("DELETE", f"/api/household/invites/{gone['id']}", token=self.admin)[0], 200)
        self.assertEqual(self.call("DELETE", f"/api/household/invites/{gone['id']}", token=self.admin)[0], 404)
        self.assertEqual(self.call("DELETE", f"/api/household/invites/{self.v_id}", token=self.admin)[0], 404)   # not pending
        self.assertEqual(self.call("PATCH", f"/api/household/members/{made['id']}", {"role": "admin"}, token=self.admin)[0], 409)

    # --- devices, passwords, pairing, audit ---------------------------------

    def test_devices(self):
        listed = self.call("GET", "/api/me/sessions", token=self.viewer)[1]["sessions"]
        self.assertEqual([(s["kind"], s["you"]) for s in listed], [("app", True)])
        self.assertNotIn("token", str(listed))
        again = self.call("POST", "/api/auth/login/local?app=1", {"email": "vera@example.com", "password": PASSWORD,
                                                                  "device": "Kitchen tablet"})[1]["token"]
        listed = self.call("GET", "/api/me/sessions", token=self.viewer)[1]["sessions"]
        self.assertEqual(sorted(s["device"] for s in listed), ["", "Kitchen tablet"])
        tablet = next(s for s in listed if s["device"])
        self.assertEqual(self.call("DELETE", f"/api/me/sessions/{tablet['id']}", token=self.viewer)[0], 200)
        self.assertEqual(self.call("GET", "/api/me", token=again)[0], 401)
        self.assertEqual(self.call("DELETE", f"/api/me/sessions/{tablet['id']}", token=self.viewer)[0], 404)
        everyone = self.call("GET", "/api/household/sessions", token=self.admin)[1]["sessions"]
        self.assertEqual(sorted({s["member"] for s in everyone}), ["Sam", "max", "olga", "vera"])
        theirs = next(s for s in everyone if s["member"] == "olga")
        self.assertEqual(self.call("DELETE", f"/api/household/sessions/{theirs['id']}", token=self.admin)[0], 200)
        self.assertEqual(self.call("GET", "/api/me", token=self.other)[0], 401)
        self.assertEqual(self.call("DELETE", "/api/household/sessions/s-nope", token=self.admin)[0], 404)
        # a member can't end someone else's device through their own list
        mine = next(s for s in self.call("GET", "/api/me/sessions", token=self.manager)[1]["sessions"])
        self.assertEqual(self.call("DELETE", f"/api/me/sessions/{mine['id']}", token=self.viewer)[0], 404)

    def test_password_and_name(self):
        self.assertEqual(self.call("PATCH", "/api/me", {"name": "  "}, token=self.viewer)[0], 400)
        self.assertEqual(self.call("PATCH", "/api/me", {"name": "Vera P"}, token=self.viewer)[1]["member"]["name"], "Vera P")
        status, got = self.call("PUT", "/api/me/password", {"current": "wrong", "new": "a brand new password"}, token=self.viewer)
        self.assertEqual((status, got["code"]), (403, "wrong_password"))
        self.assertEqual(self.call("PUT", "/api/me/password", {"current": PASSWORD, "new": "short"}, token=self.viewer)[0], 400)
        self.assertEqual(self.call("PUT", "/api/me/password", {"current": PASSWORD, "new": "a brand new password"}, token=self.viewer)[0], 200)
        self.assertEqual(self.call("POST", "/api/auth/login/local", {"email": "vera@example.com", "password": PASSWORD})[0], 401)
        self.assertEqual(self.call("POST", "/api/auth/login/local?app=1", {"email": "vera@example.com", "password": "a brand new password"})[0], 200)

    def test_pairing_codes_make_app_sessions_for_a_member(self):
        status, made = self.call("POST", "/api/pairing/code", {"member": self.v_id}, token=self.admin)
        self.assertEqual((status, made["member"]), (200, self.v_id))
        status, paired = self.call("POST", "/api/pair", {"code": made["code"], "name": "Vera's phone"})
        self.assertEqual((status, paired["member"]["email"]), (200, "vera@example.com"))
        self.assertEqual(len(self.call("GET", "/api/cameras", token=paired["token"])[1]["cameras"]), 1)   # her view, not the admin's
        self.assertEqual(self.call("POST", "/api/pair", {"code": made["code"], "name": "again"})[1]["code"], "bad_code")
        self.assertEqual(self.call("POST", "/api/pair", {"code": "AAAA-AAAA"})[0], 403)
        self.assertEqual(self.call("POST", "/api/pairing/code", {"member": "m-nope"}, token=self.admin)[0], 404)
        mine = self.call("POST", "/api/pairing/code", {}, token=self.admin)[1]       # no member named: for the admin
        self.assertEqual(self.call("GET", "/api/me", token=self.call("POST", "/api/pair", {"code": mine["code"]})[1]["token"])[1]["member"]["role"], "admin")

    def test_audit_log(self):
        self.call("POST", "/api/auth/login/local", {"email": "sam@example.com", "password": "nope nope nope"})
        self.call("PATCH", f"/api/household/members/{self.o_id}", {"name": "Olga"}, token=self.admin)
        log = self.call("GET", "/api/admin/audit", token=self.admin)[1]["audit"]
        actions = [e["action"] for e in log]
        for wanted in ("first-admin", "sign-in", "sign-in-failed", "invite", "invite-accepted", "member-changed", "camera-added", "group-added"):
            self.assertIn(wanted, actions)
        self.assertEqual(log, sorted(log, key=lambda e: e["at"], reverse=True))        # newest first
        self.clock[0] += 91 * 86400
        self.accounts.audit("", "later")
        self.assertEqual([e["action"] for e in self.accounts.audit_log()], ["later"])   # kept 90 days


class PairingPayloadTest(unittest.TestCase):
    def test_code_carries_who_it_is_for(self):
        pairing = Pairing()
        code, _ = pairing.new_code("m-1")
        self.assertEqual(pairing.claim("AAAA-AAAA"), (False, None))
        self.assertEqual(pairing.claim(code), (True, "m-1"))
        self.assertEqual(pairing.claim(code), (False, None))


if __name__ == "__main__":
    unittest.main()
