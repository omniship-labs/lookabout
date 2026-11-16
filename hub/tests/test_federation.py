"""Google and Apple sign-in, provider settings, the vault and the app token exchange.

The providers are stood in for: a fake Http hands out ID tokens signed with a key
made here, so everything the hub checks is checked, but no real Google or Apple
account has been used.
"""

import hashlib
import json
import os
import sys
import time
import unittest
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from cryptography.hazmat.primitives import hashes, serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa  # noqa: E402
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature  # noqa: E402

from lookabout_hub import oidc  # noqa: E402
from lookabout_hub.accounts import Accounts  # noqa: E402
from lookabout_hub.oidc import Federation  # noqa: E402
from lookabout_hub.vault import Vault  # noqa: E402
from lookabout_hub.webauthn import b64u_encode  # noqa: E402
from support import PASSWORD, HubCase  # noqa: E402

KEY = rsa.generate_private_key(65537, 2048)
OTHER_KEY = rsa.generate_private_key(65537, 2048)
APPLE_KEY = ec.generate_private_key(ec.SECP256R1())
APPLE_PEM = APPLE_KEY.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                    serialization.NoEncryption()).decode()
CLIENT_ID = "1234-abc.apps.googleusercontent.com"
SERVICES_ID = "dev.example.lookabout"


def jwks(key=KEY, kid="k1"):
    n = key.public_key().public_numbers()
    return {"keys": [{"kty": "RSA", "kid": kid, "alg": "RS256", "use": "sig",
                      "n": b64u_encode(n.n.to_bytes(256, "big")), "e": b64u_encode(n.e.to_bytes(3, "big"))}]}


def id_token(claims, key=KEY, kid="k1", alg="RS256"):
    head = b64u_encode(json.dumps({"alg": alg, "kid": kid}).encode())
    body = b64u_encode(json.dumps(claims).encode())
    signature = key.sign(f"{head}.{body}".encode(), padding.PKCS1v15(), hashes.SHA256()) if alg == "RS256" else b""
    return f"{head}.{body}.{b64u_encode(signature)}"


class FakeHttp:
    """Stands in for Google and Apple. `claims` is what the next ID token says; None keys use the defaults."""

    def __init__(self):
        self.posted, self.fetched = [], []
        self.claims, self.key, self.fail, self.refuse = {}, KEY, False, False

    def post_form(self, url, data):
        self.posted.append((url, data))
        if self.fail:
            raise OSError("no network")
        return {"error": "invalid_client"} if self.refuse else {"id_token": self.token}

    def get_json(self, url):
        self.fetched.append(url)
        if self.fail:
            raise OSError("no network")
        return jwks()


class ProviderCase(HubCase):
    def setUp(self):
        super().setUp()
        self.http = FakeHttp()
        self.federation = Federation(self.accounts, Vault(os.path.join(self.dir.name, "keys")), http=self.http,
                                     clock=lambda: self.clock[0])
        self.hub.federation = self.federation
        self.admin = self.signin()
        self.host = self.base.split("//")[1]

    def configure(self, google=True, apple=False):
        patch = {"public_url": "https://hub.example.com"}
        if google:
            patch["google"] = {"client_id": CLIENT_ID, "client_secret": "GOCSPX-secret-value", "enabled": True}
        if apple:
            patch["apple"] = {"services_id": SERVICES_ID, "team_id": "TEAM123456", "key_id": "KEY1234567", "key": APPLE_PEM, "enabled": True}
        status, got = self.call("PUT", "/api/admin/auth/providers", patch, token=self.admin)
        self.assertEqual(status, 200, got)
        return got

    def start(self, provider="google", token=None, path=None, **body):
        status, got, headers = self.send("POST", path or f"/api/auth/login/{provider}", body, token=token)
        self.assertEqual(status, 200, got)
        query = {k: v[0] for k, v in parse_qs(urlsplit(got["redirect"]).query).items()}
        cookie = headers["Set-Cookie"].split(";")[0]
        return got["redirect"], query, cookie, headers["Set-Cookie"]

    def claims(self, query, provider="google", **over):
        base = {"iss": "https://accounts.google.com" if provider == "google" else "https://appleid.apple.com",
                "aud": CLIENT_ID if provider == "google" else SERVICES_ID, "sub": "sub-1", "email": "sam@gmail.com",
                "email_verified": True, "nonce": query["nonce"], "exp": self.clock[0] + 600, "name": "Sam G"}
        return {**base, **over}

    def come_back(self, provider, query, cookie, claims=None, key=KEY, kid="k1", alg="RS256", code="the-code", state=None, **extra):
        self.http.token = id_token(claims or self.claims(query, provider), key=key, kid=kid, alg=alg)
        params = {"code": code, "state": state or query["state"], **extra}
        headers = {"Cookie": cookie} if cookie else {}
        if provider == "google":
            qs = "&".join(f"{k}={v}" for k, v in params.items())
            return self.send("GET", f"/api/auth/callback/google?{qs}", headers=headers)
        body = "&".join(f"{k}={v}" for k, v in params.items()).encode()
        return self.send("POST", "/api/auth/callback/apple", body, headers={**headers, "Origin": "https://appleid.apple.com",
                                                                          "Content-Type": "application/x-www-form-urlencoded"})

    def error_of(self, headers):
        location = headers["Location"]
        self.assertTrue(location.startswith("/#/signin?error="), location)
        return parse_qs(urlsplit(location[2:]).query)["error"][0]

    def member(self, email="sam@gmail.com"):
        return next(m for m in self.accounts.members() if m["email"] == email)

    def invited(self, email="sam@gmail.com", grants=()):
        return self.call("POST", "/api/household/invites", {"email": email, "grants": list(grants)}, token=self.admin)[1]


class SettingsTest(ProviderCase):
    def test_nothing_is_on_at_first(self):
        got = self.call("GET", "/api/admin/auth/providers", token=self.admin)[1]
        self.assertEqual(got["google"], {"enabled": False, "client_id": "", "has_secret": False, "redirect_uri": ""})
        self.assertEqual(got["local"], {"enabled": True, "password": True, "passkey": True})
        self.assertEqual([p["id"] for p in self.call("GET", "/api/auth/providers")[1]["providers"]], ["local"])
        for provider in ("google", "apple"):
            self.assertEqual(self.call("POST", f"/api/auth/login/{provider}", {})[0], 404)

    def test_only_admins(self):
        _, member = self.invite(self.admin, "olga@example.com")
        for method in ("GET", "PUT"):
            status, got = self.call(method, "/api/admin/auth/providers", {}, token=member)
            self.assertEqual((status, got["code"]), (403, "admin_only"))
        self.assertEqual(self.call("GET", "/api/admin/auth/providers")[0], 401)

    def test_switching_on_needs_what_it_needs(self):
        put = lambda patch: self.call("PUT", "/api/admin/auth/providers", patch, token=self.admin)  # noqa: E731
        status, got = put({"google": {"client_id": CLIENT_ID, "client_secret": "s", "enabled": True}})
        self.assertEqual((status, "https" in got["error"]), (409, True))            # no public address yet
        self.assertEqual(put({"public_url": "http://hub.local:8787"})[0], 200)
        self.assertEqual(put({"google": {"enabled": True}})[0], 409)                 # still not https
        self.assertEqual(put({"public_url": "https://hub.example.com"})[0], 200)
        status, got = put({"google": {"enabled": True}})
        self.assertEqual((status, "client ID" in got["error"]), (409, True))
        status, got = put({"google": {"client_id": "nope", "client_secret": "s", "enabled": True}})
        self.assertEqual(status, 409)
        self.assertEqual(put({"google": {"client_id": CLIENT_ID, "client_secret": "s", "enabled": True}})[0], 200)
        self.assertEqual(put({"apple": {"enabled": True}})[0], 409)
        self.assertEqual(put({"apple": {"services_id": "a", "team_id": "b", "key_id": "c", "key": "not a key"}})[0], 400)
        self.assertEqual(put({"apple": {"key": APPLE_PEM.replace("PRIVATE", "NOPE")}})[0], 400)
        self.assertEqual(put({"apple": {"services_id": "a", "team_id": "b", "key_id": "c", "key": APPLE_PEM, "enabled": True}})[0], 200)
        for bad in ("ftp://hub", "https://hub.example.com/path", "hub.example.com", "https://"):
            self.assertEqual(put({"public_url": bad})[0], 400, bad)
        self.assertEqual(put({"public_url": ""})[0], 200)
        self.assertEqual(put([])[0], 400)

    def test_secrets_are_write_only_and_encrypted(self):
        got = self.configure(apple=True)
        self.assertEqual((got["google"]["has_secret"], got["apple"]["has_key"]), (True, True))
        self.assertEqual(got["google"]["redirect_uri"], "https://hub.example.com/api/auth/callback/google")
        self.assertEqual(got["apple"]["redirect_uri"], "https://hub.example.com/api/auth/callback/apple")
        text = json.dumps(self.call("GET", "/api/admin/auth/providers", token=self.admin)[1])
        self.assertNotIn("GOCSPX", text)
        self.assertNotIn("BEGIN", text)
        stored = self.store.meta("providers")
        self.assertNotIn("GOCSPX", stored)
        self.assertNotIn("BEGIN", stored)
        key_file = os.path.join(self.dir.name, "keys", "vault.key")
        self.assertEqual(os.stat(key_file).st_mode & 0o777, 0o600)
        # Sending the client ID again without the secret keeps the secret.
        self.call("PUT", "/api/admin/auth/providers", {"google": {"client_id": CLIENT_ID}}, token=self.admin)
        self.assertTrue(self.call("GET", "/api/admin/auth/providers", token=self.admin)[1]["google"]["has_secret"])
        self.assertEqual([p["id"] for p in self.call("GET", "/api/auth/providers")[1]["providers"]], ["local", "google", "apple"])
        self.call("PUT", "/api/admin/auth/providers", {"google": {"enabled": False}}, token=self.admin)
        self.assertEqual([p["id"] for p in self.call("GET", "/api/auth/providers")[1]["providers"]], ["local", "apple"])

    def test_vault(self):
        vault = Vault(os.path.join(self.dir.name, "v"))
        sealed = vault.seal("secret")
        self.assertNotIn("secret", sealed)
        self.assertEqual(vault.open(sealed), "secret")
        self.assertEqual(Vault(os.path.join(self.dir.name, "v")).open(sealed), "secret")      # the key file persists
        self.assertEqual(Vault(os.path.join(self.dir.name, "w")).open(sealed), "")             # another key can't open it
        self.assertEqual(vault.open("junk"), "")


class GoogleTest(ProviderCase):
    def setUp(self):
        super().setUp()
        self.configure()

    def test_the_address_the_browser_is_sent_to(self):
        url, query, cookie, raw = self.start(return_to="/cameras")
        self.assertTrue(url.startswith("https://accounts.google.com/o/oauth2/v2/auth?"))
        self.assertEqual((query["client_id"], query["response_type"], query["code_challenge_method"]), (CLIENT_ID, "code", "S256"))
        self.assertEqual(query["redirect_uri"], "https://hub.example.com/api/auth/callback/google")
        self.assertTrue(query["scope"].startswith("openid email"))
        self.assertEqual(cookie, f"lk_oauth={query['state']}")
        self.assertIn("HttpOnly", raw)
        self.assertIn("SameSite=Lax", raw)
        self.assertEqual(self.call("POST", "/api/auth/login/google", {"app": True})[0], 400)         # an app needs a challenge

    def test_an_invited_person_signs_in_with_their_verified_email(self):
        self.invited(grants=[])
        _, query, cookie, _ = self.start(return_to="/cameras")
        status, _, headers = self.come_back("google", query, cookie)
        self.assertEqual((status, headers["Location"]), (302, "/cameras"))
        self.assertIn("lk_session=", ";".join(v for k, v in headers.items() if k == "Set-Cookie"))
        self.assertIn("Max-Age=0", ";".join(v for k, v in headers.items() if k == "Set-Cookie"))      # the state cookie is cleared
        url, form = self.http.posted[0]
        self.assertEqual(url, "https://oauth2.googleapis.com/token")
        self.assertEqual((form["client_secret"], form["client_id"], form["grant_type"]), ("GOCSPX-secret-value", CLIENT_ID, "authorization_code"))
        self.assertEqual(hashlib.sha256(form["code_verifier"].encode()).digest(), __import__("base64").urlsafe_b64decode(query["code_challenge"] + "=="))
        self.assertEqual(self.http.fetched, ["https://www.googleapis.com/oauth2/v3/certs"])
        member = self.member()
        self.assertEqual((member["status"], member["name"], member["email"]), ("active", "Sam G", "sam@gmail.com"))
        self.assertEqual(self.accounts.identities(member["id"]), {"google": "sam@gmail.com"})
        # Next time the identity is enough, whatever the email says now.
        _, query, cookie, _ = self.start()
        status, _, headers = self.come_back("google", query, cookie, claims=self.claims(query, email="new@gmail.com", email_verified=False))
        self.assertEqual((status, headers["Location"]), (302, "/"))

    def test_strangers_and_unverified_emails_are_turned_away(self):
        _, query, cookie, _ = self.start()
        status, _, headers = self.come_back("google", query, cookie)
        self.assertEqual(self.error_of(headers), "not_invited")
        self.assertIn("Ask%20an%20admin", headers["Location"])
        self.assertEqual(len(self.accounts.members()), 1)                  # nobody was made
        self.invited()
        _, query, cookie, _ = self.start()
        status, _, headers = self.come_back("google", query, cookie, claims=self.claims(query, email_verified=False))
        self.assertEqual(self.error_of(headers), "not_invited")
        self.assertEqual(self.member()["status"], "invited")
        _, query, cookie, _ = self.start()
        _, _, headers = self.come_back("google", query, cookie, claims=self.claims(query, email_verified="true"))   # strings count too
        self.assertEqual(headers["Location"], "/")

    def test_an_invite_that_ran_out_does_not_match(self):
        self.invited()
        self.clock[0] += 8 * 86400
        _, query, cookie, _ = self.start()
        self.assertEqual(self.error_of(self.come_back("google", query, cookie, claims=self.claims(query))[2]), "not_invited")

    def test_the_token_is_checked(self):
        self.invited()
        for label, flaw in (("nonce", {"claims": dict(nonce="other")}), ("audience", {"claims": dict(aud="someone-else")}),
                            ("issuer", {"claims": dict(iss="https://evil.example")}), ("expired", {"claims": dict(exp=1)}),
                            ("no sub", {"claims": dict(sub="")}), ("key", {"key": OTHER_KEY}), ("kid", {"kid": "unknown"}),
                            ("alg none", {"alg": "none"})):
            _, query, cookie, _ = self.start()
            extra = dict(flaw)
            over = extra.pop("claims", None)
            claims = self.claims(query, **over) if over is not None else None
            status, _, headers = self.come_back("google", query, cookie, claims=claims, **extra)
            self.assertEqual((label, status, self.error_of(headers)), (label, 302, "sign_in_failed"))
        self.assertEqual(self.member()["status"], "invited")

    def test_a_list_of_audiences_counts(self):
        self.invited()
        _, query, cookie, _ = self.start()
        _, _, headers = self.come_back("google", query, cookie, claims=self.claims(query, aud=["other", CLIENT_ID]))
        self.assertEqual(headers["Location"], "/")

    def test_state_must_match_the_cookie_and_is_used_once(self):
        self.invited()
        _, query, cookie, _ = self.start()
        for label, args in (("no cookie", dict(cookie="")), ("other cookie", dict(cookie="lk_oauth=abc")), ("other state", dict(state="abc"))):
            _, other, own_cookie, _ = self.start()
            args.setdefault("cookie", own_cookie)
            _, _, headers = self.come_back("google", other, args.pop("cookie"), **args)
            self.assertEqual((label, self.error_of(headers)), (label, "bad_state"))
        status, _, headers = self.come_back("google", query, cookie)
        self.assertEqual(headers["Location"], "/")
        self.assertEqual(self.error_of(self.come_back("google", query, cookie)[2]), "bad_state")        # used up

    def test_state_runs_out(self):
        _, query, cookie, _ = self.start()
        self.clock[0] += 601
        self.assertEqual(self.error_of(self.come_back("google", query, cookie)[2]), "bad_state")

    def test_cancelled_refused_and_unreachable(self):
        _, query, cookie, _ = self.start()
        _, _, headers = self.send("GET", f"/api/auth/callback/google?state={query['state']}&error=access_denied", headers={"Cookie": cookie})
        self.assertEqual(self.error_of(headers), "cancelled")
        _, query, cookie, _ = self.start()
        self.http.refuse = True
        self.assertEqual(self.error_of(self.come_back("google", query, cookie)[2]), "provider_refused")
        self.http.refuse = False
        _, query, cookie, _ = self.start()
        self.http.fail = True
        self.assertEqual(self.error_of(self.come_back("google", query, cookie)[2]), "unreachable")
        _, query, cookie, _ = self.start()
        self.http.fail = False
        _, _, headers = self.send("GET", f"/api/auth/callback/google?state={query['state']}", headers={"Cookie": cookie})
        self.assertEqual(self.error_of(headers), "sign_in_failed")        # no code

    def test_nobody_can_be_sent_to_another_site(self):
        self.invited()
        for bad in ("//evil.example", "https://evil.example", "/\\evil", "x" * 300, None, ""):
            self.accounts.store._run("UPDATE members SET status = 'invited', invite_expires = ? WHERE email = 'sam@gmail.com'",
                                     (self.clock[0] + 1000,))
            self.accounts.store._run("DELETE FROM identities")
            _, query, cookie, _ = self.start(return_to=bad)
            _, _, headers = self.come_back("google", query, cookie)
            self.assertEqual(headers["Location"], "/", bad)

    def test_switched_off_after_starting(self):
        _, query, cookie, _ = self.start()
        self.call("PUT", "/api/admin/auth/providers", {"google": {"enabled": False}}, token=self.admin)
        self.assertEqual(self.error_of(self.come_back("google", query, cookie)[2]), "sign_in_failed")

    def test_an_app_trades_a_one_time_code_for_a_session(self):
        self.invited()
        verifier = "v" * 50
        challenge = b64u_encode(hashlib.sha256(verifier.encode()).digest())
        _, query, cookie, _ = self.start(app=True, code_challenge=challenge)
        status, _, headers = self.come_back("google", query, cookie)
        self.assertEqual(status, 302)
        self.assertNotIn("lk_session=", str(headers.get_all("Set-Cookie")))
        location = headers["Location"]
        self.assertTrue(location.startswith("lookabout://hub/signed-in?code="))
        code = location.split("code=")[1]
        status, got = self.call("POST", "/api/auth/token", {"code": code, "code_verifier": "wrong"})
        self.assertEqual((status, got["code"]), (403, "bad_code"))
        self.assertEqual(self.call("POST", "/api/auth/token", {"code": code, "code_verifier": verifier})[0], 403)   # used up by the wrong try
        _, query, cookie, _ = self.start(app=True, code_challenge=challenge)
        code = self.come_back("google", query, cookie)[2]["Location"].split("code=")[1]
        status, got = self.call("POST", "/api/auth/token", {"code": code, "code_verifier": verifier, "device": "Pixel"})
        self.assertEqual((status, got["me"]["email"]), (200, "sam@gmail.com"))
        self.assertEqual(self.call("GET", "/api/me", token=got["token"])[1]["session"]["kind"], "app")
        self.assertEqual(self.call("POST", "/api/auth/token", {"code": code, "code_verifier": verifier})[0], 403)
        _, query, cookie, _ = self.start(app=True, code_challenge=challenge)
        code = self.come_back("google", query, cookie)[2]["Location"].split("code=")[1]
        self.clock[0] += 301
        self.assertEqual(self.call("POST", "/api/auth/token", {"code": code, "code_verifier": verifier})[0], 403)

    def test_linking_and_unlinking(self):
        _, member = self.invite(self.admin, "olga@example.com")
        _, query, cookie, _ = self.start(token=member, path="/api/me/link/google", return_to="/account")
        status, _, headers = self.come_back("google", query, cookie, claims=self.claims(query, sub="olga-sub", email="olga@gmail.com"))
        self.assertEqual((status, headers["Location"]), (302, "/account"))
        me = self.call("GET", "/api/me", token=member)[1]
        self.assertEqual(me["sign_in"]["google"], "olga@gmail.com")
        _, query, cookie, _ = self.start()                                     # and now she can use it to sign in
        self.assertEqual(self.come_back("google", query, cookie, claims=self.claims(query, sub="olga-sub"))[2]["Location"], "/")
        # Someone else can't claim the same Google account.
        _, query, cookie, _ = self.start(token=self.admin, path="/api/me/link/google")
        _, _, headers = self.come_back("google", query, cookie, claims=self.claims(query, sub="olga-sub"))
        self.assertEqual(self.error_of(headers), "already_linked")
        self.assertEqual(self.call("DELETE", "/api/me/link/google", token=member)[0], 200)
        self.assertEqual(self.call("DELETE", "/api/me/link/google", token=member)[0], 404)
        self.assertEqual(self.call("POST", "/api/me/link/google", {})[0], 401)

    def test_the_last_way_in_stays(self):
        self.call("PUT", "/api/admin/auth/providers", {"local": {"password": False}}, token=self.admin)
        # (refused: no admin has anything but a password yet)
        self.assertEqual(self.call("GET", "/api/admin/auth/providers", token=self.admin)[1]["local"]["password"], True)
        _, query, cookie, _ = self.start(token=self.admin, path="/api/me/link/google")
        self.come_back("google", query, cookie, claims=self.claims(query, sub="sam-sub"))
        self.assertEqual(self.call("PUT", "/api/admin/auth/providers", {"local": {"password": False}}, token=self.admin)[0], 200)
        status, got = self.call("DELETE", "/api/me/link/google", token=self.admin)
        self.assertEqual((status, got["code"]), (409, "conflict"))
        self.assertEqual(self.call("POST", "/api/auth/login/local", {"email": "sam@example.com", "password": PASSWORD})[0], 403)


class AppleTest(ProviderCase):
    def setUp(self):
        super().setUp()
        self.configure(google=False, apple=True)

    def test_apple_posts_its_answer_from_its_own_site(self):
        self.invited()
        url, query, cookie, raw = self.start("apple", return_to="/cameras")
        self.assertTrue(url.startswith("https://appleid.apple.com/auth/authorize?"))
        self.assertEqual((query["response_mode"], query["client_id"], query["scope"]), ("form_post", SERVICES_ID, "name email"))
        self.assertNotIn("code_challenge", query)
        self.assertIn("SameSite=None; Secure", raw)                       # it has to cross sites
        status, _, headers = self.come_back("apple", query, cookie)
        self.assertEqual((status, headers["Location"]), (302, "/cameras"))
        member = self.member()
        self.assertEqual(self.accounts.identities(member["id"]), {"apple": "sam@gmail.com"})

    def test_the_client_secret_is_a_signed_jwt(self):
        self.invited()
        _, query, cookie, _ = self.start("apple")
        self.come_back("apple", query, cookie)
        url, form = self.http.posted[0]
        self.assertEqual((url, form["client_id"]), ("https://appleid.apple.com/auth/token", SERVICES_ID))
        self.assertNotIn("code_verifier", form)
        head, body, signature = form["client_secret"].split(".")
        pad = lambda t: t + "=" * (-len(t) % 4)  # noqa: E731
        import base64
        header, claims = json.loads(base64.urlsafe_b64decode(pad(head))), json.loads(base64.urlsafe_b64decode(pad(body)))
        self.assertEqual((header, claims["iss"], claims["sub"], claims["aud"]), ({"alg": "ES256", "kid": "KEY1234567"},
                                                                                 "TEAM123456", SERVICES_ID, "https://appleid.apple.com"))
        self.assertEqual(claims["exp"] - claims["iat"], 600)
        raw = base64.urlsafe_b64decode(pad(signature))
        self.assertEqual(len(raw), 64)
        APPLE_KEY.public_key().verify(encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big")),
                                      f"{head}.{body}".encode(), ec.ECDSA(hashes.SHA256()))

    def test_only_apples_route_skips_the_origin_check(self):
        status, got, _ = self.send("POST", "/api/auth/callback/apple", b"state=x", headers={"Origin": "https://evil.example"})
        self.assertEqual(status, 302)                                      # refused in the sign-in sense, not as bad_origin
        status, got, _ = self.send("POST", "/api/auth/login/apple", {}, headers={"Origin": "https://evil.example"})
        self.assertEqual((status, got["code"]), (403, "bad_origin"))
        status, got, _ = self.send("POST", "/api/auth/token", {}, headers={"Origin": "https://evil.example"})
        self.assertEqual((status, got["code"]), (403, "bad_origin"))

    def test_apple_without_an_email_cannot_match_an_invite(self):
        self.invited()
        _, query, cookie, _ = self.start("apple")
        claims = self.claims(query, "apple")
        del claims["email"]
        self.assertEqual(self.error_of(self.come_back("apple", query, cookie, claims=claims)[2]), "not_invited")


class UnitTest(unittest.TestCase):
    def test_safe_return(self):
        self.assertEqual([oidc.safe_return(x) for x in ("/a", "/", "//x", "http://x", "", None, "/a\\b")], ["/a", "/", "/", "/", "/", "/", "/"])

    def test_pkce(self):
        challenge = b64u_encode(hashlib.sha256(b"verifier").digest())
        self.assertTrue(oidc.pkce_ok("verifier", challenge))
        self.assertFalse(oidc.pkce_ok("other", challenge))
        self.assertFalse(oidc.pkce_ok("verifier", ""))

    def test_malformed_tokens(self):
        for token in ("", "a.b", "a.b.c.d", None, "!!.!!.!!"):
            with self.assertRaises(oidc.SignInError):
                oidc.verify_id_token(token, jwks(), ("x",), "a", "n", time.time())


if __name__ == "__main__":
    unittest.main()
