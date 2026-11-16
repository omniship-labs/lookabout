"""Passkeys: the checks in webauthn.py, and registering and signing in through the hub."""

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from authenticator import Authenticator, cbor  # noqa: E402
from lookabout_hub import webauthn  # noqa: E402
from support import PASSWORD, HubCase  # noqa: E402


class WebauthnUnitTest(unittest.TestCase):
    def test_cbor(self):
        value = {"a": [1, -5, 300, 70000, 2 ** 33], "b": b"\x00\x01", "c": True, "e": "é", "f": {"x": False}}
        self.assertEqual(webauthn.cbor_decode(cbor(value))[0], value)
        self.assertEqual(webauthn.cbor_decode(b"\xf6")[0], None)
        self.assertEqual(webauthn.cbor_decode(b"\x1b" + (2 ** 40).to_bytes(8, "big"))[0], 2 ** 40)
        for bad in (b"", b"\x5f", b"\x45ab", b"\x9f", b"\xfb" + bytes(8), b"\x65abc", b"\x99\xff\xff"):
            with self.assertRaises(webauthn.PasskeyError, msg=bad):
                webauthn.cbor_decode(bad)
        with self.assertRaises(webauthn.PasskeyError):                       # nested far too deep
            webauthn.cbor_decode(b"\x81" * 20 + b"\x00")

    def test_base64url(self):
        self.assertEqual(webauthn.b64u_decode(webauthn.b64u_encode(b"\xfb\xff\x00")), b"\xfb\xff\x00")
        with self.assertRaises(webauthn.PasskeyError):
            webauthn.b64u_decode("***")

    def test_auth_data(self):
        with self.assertRaises(webauthn.PasskeyError):
            webauthn.parse_auth_data(b"short")
        with self.assertRaises(webauthn.PasskeyError):
            webauthn.parse_auth_data(bytes(32) + b"\x41" + bytes(4) + b"\x00" * 10)         # claims a credential, has none
        with self.assertRaises(webauthn.PasskeyError):
            webauthn.parse_auth_data(bytes(32) + b"\x41" + bytes(4) + bytes(16) + (500).to_bytes(2, "big") + b"x")

    def test_unsupported_keys_are_refused(self):
        for cose in ({1: 2, 3: -7, -1: 2, -2: b"x", -3: b"y"}, {1: 4, 3: -7}, {}, {1: 2, 3: -7, -1: 1}, None):
            with self.assertRaises(webauthn.PasskeyError, msg=cose):
                webauthn.cose_to_pem(cose)

    def test_every_supported_key_kind_signs_in(self):
        for kind in ("es256", "eddsa", "rs256"):
            device = Authenticator(kind=kind)
            ok = lambda origin: origin == "https://hub.example.com"  # noqa: E731
            made = device.create("c1", "https://hub.example.com", rp_id="hub.example.com")
            parsed = webauthn.verify_registration(webauthn.b64u_decode(made["response"]["clientDataJSON"]),
                                                  webauthn.b64u_decode(made["response"]["attestationObject"]), "c1", ok)
            self.assertEqual((parsed["rp_id"], parsed["credential_id"]), ("hub.example.com", device.id), kind)
            got = device.get("c2", "https://hub.example.com", rp_id="hub.example.com")["response"]
            counter = webauthn.verify_assertion(webauthn.b64u_decode(got["clientDataJSON"]), webauthn.b64u_decode(got["authenticatorData"]),
                                                webauthn.b64u_decode(got["signature"]), "c2", ok, parsed["public_key"], 0, "hub.example.com")
            self.assertEqual(counter, 1, kind)


class PasskeyRouteTest(HubCase):
    def setUp(self):
        super().setUp()
        self.admin = self.signin()
        self.origin = self.base           # http://127.0.0.1:<port>, the address this hub is opened on
        self.device = Authenticator()

    def register(self, device=None, token=None, name=None, **flaws):
        device = device or self.device
        token = token or self.admin
        status, got = self.call("POST", "/api/me/passkeys/options", {}, token=token)
        self.assertEqual(status, 200, got)
        options = got["options"]
        credential = device.create(options["challenge"], flaws.pop("origin", self.origin), **flaws)
        return self.call("POST", "/api/me/passkeys", {"credential": credential, "name": name}, token=token), options

    def sign_in(self, device=None, app=True, **flaws):
        device = device or self.device
        options = self.call("POST", "/api/auth/passkey/options", {})[1]["options"]
        challenge = flaws.pop("challenge", options["challenge"])
        credential = device.get(challenge, flaws.pop("origin", self.origin), **flaws)
        return self.send("POST", f"/api/auth/login/passkey{'?app=1' if app else ''}", {"credential": credential, "device": "Laptop"})

    def test_registering_and_signing_in(self):
        (status, got), options = self.register(name="Sam's Mac")
        self.assertEqual(status, 201, got)
        self.assertEqual(options["rp"]["id"], "127.0.0.1")
        self.assertEqual(options["user"]["name"], "sam@example.com")
        self.assertEqual([p["alg"] for p in options["pubKeyCredParams"]], [-7, -8, -257])
        self.assertEqual(options["authenticatorSelection"]["residentKey"], "required")
        self.assertEqual((got["passkeys"][0]["name"], got["passkeys"][0]["rp_id"]), ("Sam's Mac", "127.0.0.1"))
        self.assertNotIn("public_key", json.dumps(got))
        listed = self.call("GET", "/api/me/passkeys", token=self.admin)[1]
        self.assertEqual((len(listed["passkeys"]), listed["this_address"]), (1, "127.0.0.1"))
        me = self.call("GET", "/api/me", token=self.admin)[1]
        self.assertEqual((me["sign_in"]["passkeys"], me["sign_in"]["address"]), (1, "127.0.0.1"))

        status, signed, _ = self.sign_in()
        self.assertEqual((status, signed["me"]["email"]), (200, "sam@example.com"))
        self.assertEqual(self.call("GET", "/api/me", token=signed["token"])[1]["session"]["kind"], "app")
        status, _, headers = self.sign_in(app=False)
        self.assertEqual(status, 200)
        self.assertIn("lk_session=", headers["Set-Cookie"])
        self.assertEqual(self.accounts.passkey(self.device.id)["counter"], 2)

    def test_a_short_password_is_enough_with_a_passkey(self):
        _, token = self.invite(self.admin, "short@example.com", role="admin", password="tenletters1")
        member = self.member("short@example.com")
        self.assertFalse(self.accounts.strong(member))
        (status, _), _ = self.register(Authenticator(), token=token)
        self.assertEqual(status, 201)
        self.assertTrue(self.accounts.strong(member))

    def test_no_passkey_without_a_session(self):
        for method, path in (("POST", "/api/me/passkeys/options"), ("POST", "/api/me/passkeys"), ("GET", "/api/me/passkeys"),
                             ("DELETE", "/api/me/passkeys/x")):
            self.assertEqual(self.call(method, path, {})[0], 401, path)

    def test_bad_registrations(self):
        for flaw, wanted in ((dict(origin="https://evil.example"), "different address"), (dict(flags=0x40), "confirmed"),
                             (dict(flags=0x01), "confirmed"), (dict(kind="webauthn.get"), "wasn't for this"),
                             (dict(rp_id="other.example"), "different address")):
            (status, got), _ = self.register(Authenticator(), **flaw)
            self.assertEqual(status, 400, flaw)
            self.assertIn(wanted, got["error"], flaw)
        self.assertEqual(self.accounts.passkeys(self.member()["id"]), [])

    def test_a_challenge_is_used_once_and_only_for_its_member(self):
        options = self.call("POST", "/api/me/passkeys/options", {}, token=self.admin)[1]["options"]
        credential = self.device.create(options["challenge"], self.origin)
        _, other = self.invite(self.admin, "olga@example.com")
        status, got = self.call("POST", "/api/me/passkeys", {"credential": credential}, token=other)
        self.assertEqual(status, 400)                                       # someone else's challenge
        status, _ = self.call("POST", "/api/me/passkeys", {"credential": credential}, token=self.admin)
        self.assertEqual(status, 400)                                       # and a failed try uses it up
        status, got = self.call("POST", "/api/me/passkeys", {"credential": self.device.create("made-up", self.origin)}, token=self.admin)
        self.assertEqual((status, "ran out" in got["error"]), (400, True))

    def test_challenges_run_out(self):
        options = self.call("POST", "/api/me/passkeys/options", {}, token=self.admin)[1]["options"]
        self.clock[0] += 301
        status, got = self.call("POST", "/api/me/passkeys", {"credential": self.device.create(options["challenge"], self.origin)}, token=self.admin)
        self.assertEqual((status, "ran out" in got["error"]), (400, True))

    def test_junk_answers(self):
        shapes = ({}, {"credential": "x"}, {"credential": {"id": 5, "response": {}}},
                  {"credential": {"id": "a", "response": {"clientDataJSON": "***"}}})
        for body in shapes:
            self.assertEqual(self.call("POST", "/api/me/passkeys", body, token=self.admin)[0], 400, body)
            self.assertEqual(self.call("POST", "/api/auth/login/passkey", body)[0], 400, body)
        well_formed = {"credential": {"id": "a", "response": {"clientDataJSON": "e30", "attestationObject": "e30",
                                                              "authenticatorData": "e30", "signature": "e30"}}}
        self.assertEqual(self.call("POST", "/api/me/passkeys", well_formed, token=self.admin)[0], 400)
        self.assertEqual(self.call("POST", "/api/auth/login/passkey", well_formed)[0], 401)

    def test_one_passkey_per_address(self):
        self.assertEqual(self.register()[0][0], 201)
        (status, got), _ = self.register(Authenticator())
        self.assertEqual(status, 409)
        self.assertIn("127.0.0.1", got["error"])
        listed = self.accounts.passkeys(self.member()["id"])
        options = self.call("POST", "/api/me/passkeys/options", {}, token=self.admin)[1]["options"]
        self.assertEqual([c["id"] for c in options["excludeCredentials"]], [listed[0]["id"]])
        (status, _), _ = self.register(self.device)
        self.assertEqual(status, 409)

    def test_signing_in_checks_everything(self):
        self.register()
        good = Authenticator()
        for flaw in (dict(origin="https://evil.example"), dict(kind="webauthn.create"), dict(flags=0x00), dict(rp_id="other.example"),
                     dict(challenge="made-up"), dict(sign_with=good)):
            status, got, _ = self.sign_in(**flaw)
            self.assertEqual((status, got["code"]), (401, "bad_sign_in"), flaw)
        # Not one of ours at all.
        status, got, _ = self.sign_in(Authenticator())
        self.assertEqual(status, 401)
        self.assertEqual(self.sign_in()[0], 200)                         # the real one still works

    def test_a_replayed_answer_and_a_copied_key_are_refused(self):
        self.register()
        options = self.call("POST", "/api/auth/passkey/options", {})[1]["options"]
        credential = self.device.get(options["challenge"], self.origin)
        self.assertEqual(self.call("POST", "/api/auth/login/passkey?app=1", {"credential": credential})[0], 200)
        self.assertEqual(self.call("POST", "/api/auth/login/passkey?app=1", {"credential": credential})[0], 401)   # challenge used
        status, got, _ = self.sign_in(counter=1)                           # the counter went backwards
        self.assertEqual(status, 401)
        self.assertIn("copied", got["error"])
        self.assertEqual(self.sign_in(counter=5)[0], 200)

    def test_lockout(self):
        self.register()
        for _ in range(10):
            self.assertEqual(self.sign_in(challenge="made-up")[0], 401)
        status, got, headers = self.sign_in()
        self.assertEqual((status, got["code"]), (429, "too_many_tries"))
        self.assertIn("Retry-After", headers)

    def test_a_removed_member_cannot_sign_in(self):
        _, token = self.invite(self.admin, "olga@example.com")
        olga = Authenticator()
        self.assertEqual(self.register(olga, token=token)[0][0], 201)
        self.assertEqual(self.sign_in(olga)[0], 200)
        member_id = next(m["id"] for m in self.accounts.members() if m["email"] == "olga@example.com")
        self.call("DELETE", f"/api/household/members/{member_id}", token=self.admin)
        self.assertEqual(self.sign_in(olga)[0], 401)
        self.assertIsNone(self.accounts.passkey(olga.id))

    def test_removing_a_passkey_keeps_one_way_in(self):
        self.register()
        self.assertEqual(self.call("DELETE", "/api/me/passkeys/nope", token=self.admin)[0], 404)
        self.assertEqual(self.call("PUT", "/api/admin/auth/providers", {"local": {"password": False}}, token=self.admin)[0], 200)
        status, got = self.call("DELETE", f"/api/me/passkeys/{self.device.id}", token=self.admin)
        self.assertEqual((status, got["code"]), (409, "conflict"))          # passwords are off: it is the only way in
        self.assertEqual(self.call("POST", "/api/auth/login/local", {"email": "sam@example.com", "password": PASSWORD})[1]["code"], "password_off")
        self.call("PUT", "/api/admin/auth/providers", {"local": {"password": True}}, token=self.admin)
        self.assertEqual(self.call("DELETE", f"/api/me/passkeys/{self.device.id}", token=self.admin)[0], 200)
        self.assertEqual(self.sign_in()[0], 401)

    def test_passwords_cannot_be_turned_off_on_their_own(self):
        status, got = self.call("PUT", "/api/admin/auth/providers", {"local": {"password": False}}, token=self.admin)
        self.assertEqual(status, 409)                                       # no admin has a passkey yet
        self.register()
        self.assertEqual(self.call("PUT", "/api/admin/auth/providers", {"local": {"password": False}}, token=self.admin)[0], 200)
        status, got = self.call("PUT", "/api/admin/auth/providers", {"local": {"passkey": False}}, token=self.admin)
        self.assertEqual(status, 409)                                       # that would leave no way in
        provider = self.call("GET", "/api/auth/providers")[1]["providers"][0]
        self.assertEqual((provider["password"], provider["passkey"]), (False, True))

    def test_passkeys_can_be_turned_off(self):
        self.call("PUT", "/api/admin/auth/providers", {"local": {"passkey": False}}, token=self.admin)
        self.assertEqual(self.call("POST", "/api/auth/passkey/options", {})[1]["code"], "passkey_off")
        self.assertEqual(self.call("POST", "/api/auth/login/passkey", {"credential": {"id": "a", "response": {}}})[1]["code"], "passkey_off")


if __name__ == "__main__":
    unittest.main()
