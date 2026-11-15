"""Sign in with Google or Apple, using the owner's own keys (docs/hub-auth.md).

Nothing goes through an OmniShip service: the hub sends the browser to the
provider, takes the answer back at its own public address, and checks the ID
token against the provider's published keys.
"""

import hashlib
import hmac
import json
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

from .accounts import Problem
from .webauthn import PasskeyError, b64u_decode, b64u_encode

STATE_SECONDS = 600
PROVIDERS = {
    "google": {
        "label": "Continue with Google",
        "authorize": "https://accounts.google.com/o/oauth2/v2/auth",
        "token": "https://oauth2.googleapis.com/token",
        "jwks": "https://www.googleapis.com/oauth2/v3/certs",
        "issuers": ("https://accounts.google.com", "accounts.google.com"),
    },
    "apple": {
        "label": "Continue with Apple",
        "authorize": "https://appleid.apple.com/auth/authorize",
        "token": "https://appleid.apple.com/auth/token",
        "jwks": "https://appleid.apple.com/auth/keys",
        "issuers": ("https://appleid.apple.com",),
    },
}


class SignInError(Exception):
    """A provider sign-in that can't go on. `code` goes back to the sign-in screen."""

    def __init__(self, message, code="sign_in_failed"):
        super().__init__(message)
        self.message, self.code = message, code


class Http:
    """The hub's only requests to the providers: fixed addresses, short timeouts."""

    def get_json(self, url):
        with urllib.request.urlopen(url, timeout=8) as response:   # noqa: S310 (addresses are fixed above)
            return json.loads(response.read(1 << 20))

    def post_form(self, url, data):
        body = urllib.parse.urlencode(data).encode()
        request = urllib.request.Request(url, data=body, headers={"Content-Type": "application/x-www-form-urlencoded"})
        try:
            with urllib.request.urlopen(request, timeout=8) as response:   # noqa: S310
                return json.loads(response.read(1 << 20))
        except urllib.error.HTTPError as err:
            return json.loads(err.read(1 << 16) or b"{}")


def _json_b64(part):
    return json.loads(b64u_decode(part))


def verify_id_token(token, jwks, issuers, audience, nonce, now):
    """The claims of a Google or Apple ID token, once its signature and claims check out."""
    try:
        head, body, sig = token.split(".")
        header, claims, signature = _json_b64(head), _json_b64(body), b64u_decode(sig)
        if not isinstance(header, dict) or not isinstance(claims, dict):
            raise ValueError
    except (ValueError, AttributeError, TypeError, PasskeyError):
        raise SignInError("The provider's answer wasn't valid.") from None
    if header.get("alg") != "RS256":          # never "none", never a key the provider didn't publish
        raise SignInError("The provider's answer wasn't valid.")
    jwk = next((k for k in (jwks or {}).get("keys", []) if k.get("kid") == header.get("kid") and k.get("kty") == "RSA"), None)
    if not jwk:
        raise SignInError("The provider's signing key wasn't found. Try again in a minute.")
    try:
        key = rsa.RSAPublicNumbers(int.from_bytes(b64u_decode(jwk["e"]), "big"),
                                   int.from_bytes(b64u_decode(jwk["n"]), "big")).public_key()
        key.verify(signature, f"{head}.{body}".encode(), padding.PKCS1v15(), hashes.SHA256())
    except (InvalidSignature, KeyError, ValueError, PasskeyError):
        raise SignInError("The provider's answer didn't check out.") from None
    aud = claims.get("aud")
    if claims.get("iss") not in issuers or (audience not in aud if isinstance(aud, list) else aud != audience):
        raise SignInError("That sign-in was for a different app.")
    if not isinstance(claims.get("exp"), (int, float)) or claims["exp"] < now:
        raise SignInError("That sign-in ran out. Try again.")
    if not hmac.compare_digest(str(claims.get("nonce") or ""), nonce):
        raise SignInError("That sign-in didn't start here. Try again.")
    if not claims.get("sub"):
        raise SignInError("The provider's answer wasn't valid.")
    return claims


def apple_client_secret(team_id, services_id, key_id, key_pem, now):
    """Apple wants the "client secret" to be a short JWT signed with the .p8 key."""
    head = b64u_encode(json.dumps({"alg": "ES256", "kid": key_id}, separators=(",", ":")).encode())
    body = b64u_encode(json.dumps({"iss": team_id, "iat": int(now), "exp": int(now) + 600, "aud": "https://appleid.apple.com",
                                   "sub": services_id}, separators=(",", ":")).encode())
    key = serialization.load_pem_private_key(key_pem.encode(), password=None)
    r, s = decode_dss_signature(key.sign(f"{head}.{body}".encode(), ec.ECDSA(hashes.SHA256())))
    return f"{head}.{body}.{b64u_encode(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))}"


def safe_return(path):
    """Only a path on the hub itself: never another site."""
    path = str(path or "/")
    return path if path.startswith("/") and not path.startswith("//") and "\\" not in path and len(path) < 200 else "/"


def pkce_ok(verifier, challenge):
    digest = b64u_encode(hashlib.sha256(str(verifier).encode()).digest())
    return hmac.compare_digest(digest, str(challenge))


class Federation:
    """Provider settings, and the redirect-and-return dance for Google and Apple."""

    def __init__(self, accounts, vault, http=None, clock=time.time):
        self.accounts, self.vault, self.http, self._clock = accounts, vault, http or Http(), clock
        self.store = accounts.store
        self._lock = threading.Lock()
        self._states, self._codes = {}, {}      # in memory: a restart just makes people start again

    # --- settings ----------------------------------------------------------

    def _saved(self):
        return json.loads(self.store.meta("providers", "{}"))

    def _save(self, saved):
        self.store.set_meta("providers", json.dumps(saved))

    def public_url(self):
        return self.store.meta("public_url") or ""

    def enabled(self, provider):
        return bool(self._saved().get(provider, {}).get("enabled"))

    def local(self):
        saved = self._saved().get("local", {})
        return {"password": saved.get("password", True), "passkey": saved.get("passkey", True)}

    def redirect_uri(self, provider):
        return f"{self.public_url()}/api/auth/callback/{provider}" if self.public_url() else ""

    def settings(self):
        """What an admin sees. Secrets only ever come back as has_secret / has_key."""
        saved, url = self._saved(), self.public_url()
        google, apple = saved.get("google", {}), saved.get("apple", {})
        return {
            "public_url": url,
            "local": {"enabled": True, **self.local()},
            "google": {"enabled": bool(google.get("enabled")), "client_id": google.get("client_id", ""),
                       "has_secret": bool(google.get("secret")), "redirect_uri": self.redirect_uri("google")},
            "apple": {"enabled": bool(apple.get("enabled")), "services_id": apple.get("services_id", ""),
                      "team_id": apple.get("team_id", ""), "key_id": apple.get("key_id", ""),
                      "has_key": bool(apple.get("key")), "redirect_uri": self.redirect_uri("apple"),
                      "secret_expires": None},
        }

    def list_for_sign_in(self):
        local, found = self.local(), []
        found.append({"id": "local", "password": local["password"], "passkey": local["passkey"]})
        found += [{"id": p, "label": PROVIDERS[p]["label"]} for p in ("google", "apple") if self.enabled(p)]
        return found

    def update(self, patch):
        """Applies the parts of `patch` that are there. Raises Problem (400, or 409 with what is missing)."""
        if not isinstance(patch, dict):
            raise Problem(400, "Those settings can't be saved.")
        saved = self._saved()
        if "public_url" in patch:
            url = str(patch["public_url"] or "").strip().rstrip("/")
            parts = urllib.parse.urlsplit(url)
            if url and (parts.scheme not in ("http", "https") or not parts.netloc or parts.path or parts.query or parts.fragment):
                raise Problem(400, "The public address should look like https://hub.example.com.")
            self.store.set_meta("public_url", url)
        local = patch.get("local") or {}
        if local:
            now = {**self.local(), **{k: bool(v) for k, v in local.items() if k in ("password", "passkey")}}
            if not now["password"] and not self.accounts.every_admin_has_other_way(password_off=True, passkey_on=now["passkey"]):
                raise Problem(409, "Every admin needs a passkey or a Google or Apple account before passwords can be turned off.")
            if not now["password"] and not now["passkey"] and not self.accounts.every_admin_has_other_way(password_off=True, passkey_on=False):
                raise Problem(409, "Turning off both would lock out an admin.")
            saved["local"] = now
        if "google" in patch:
            current, new = saved.get("google", {}), patch["google"] or {}
            current["client_id"] = str(new.get("client_id", current.get("client_id", ""))).strip()[:200]
            if new.get("client_secret"):
                current["secret"] = self.vault.seal(str(new["client_secret"]).strip()[:400])
            current["enabled"] = bool(new["enabled"]) if "enabled" in new else current.get("enabled", False)
            if current["enabled"]:
                self._need_https()
                if not current["client_id"].endswith(".apps.googleusercontent.com") or not current.get("secret"):
                    raise Problem(409, "Add Google's client ID (it ends in .apps.googleusercontent.com) and secret first.")
            saved["google"] = current
        if "apple" in patch:
            current, new = saved.get("apple", {}), patch["apple"] or {}
            for field in ("services_id", "team_id", "key_id"):
                current[field] = str(new.get(field, current.get(field, ""))).strip()[:100]
            if new.get("key"):
                pem = str(new["key"]).strip()
                try:
                    if not isinstance(serialization.load_pem_private_key(pem.encode(), password=None), ec.EllipticCurvePrivateKey):
                        raise ValueError
                except (ValueError, TypeError):
                    raise Problem(400, "That isn't an Apple .p8 key. It should start with -----BEGIN PRIVATE KEY-----.") from None
                current["key"] = self.vault.seal(pem)
            current["enabled"] = bool(new["enabled"]) if "enabled" in new else current.get("enabled", False)
            if current["enabled"]:
                self._need_https()
                if not all(current.get(f) for f in ("services_id", "team_id", "key_id", "key")):
                    raise Problem(409, "Add Apple's Services ID, Team ID, Key ID and key first.")
            saved["apple"] = current
        self._save(saved)
        return self.settings()

    def _need_https(self):
        if not self.public_url().startswith("https://"):
            raise Problem(409, "Set the hub's public https address first. Google and Apple only call back to https.")

    # --- the redirect and the return -----------------------------------------

    def begin(self, provider, return_to="/", purpose="login", member_id=None, app_challenge=None):
        """(address to send the browser to, state). Raises Problem when the provider isn't switched on."""
        if provider not in PROVIDERS or not self.enabled(provider):
            raise Problem(404, "That way of signing in isn't switched on.")
        saved = self._saved()[provider]
        state, nonce, verifier = (secrets.token_urlsafe(24) for _ in range(3))
        now = self._clock()
        with self._lock:
            self._states = {k: v for k, v in self._states.items() if v["expires"] > now}
            self._states[state] = {"provider": provider, "nonce": nonce, "verifier": verifier, "purpose": purpose,
                                   "member": member_id, "return_to": safe_return(return_to),
                                   "app_challenge": app_challenge, "expires": now + STATE_SECONDS}
        query = {"client_id": saved.get("client_id") or saved.get("services_id"), "redirect_uri": self.redirect_uri(provider),
                 "response_type": "code", "state": state, "nonce": nonce}
        if provider == "google":
            query.update(scope="openid email profile", code_challenge=b64u_encode(hashlib.sha256(verifier.encode()).digest()),
                         code_challenge_method="S256", prompt="select_account")
        else:
            query.update(scope="name email", response_mode="form_post")
        return f"{PROVIDERS[provider]['authorize']}?{urllib.parse.urlencode(query)}", state

    def finish(self, provider, params, cookie_state):
        """Checks what came back. Returns {member, return_to, app_challenge, purpose}; raises SignInError."""
        state = str(params.get("state") or "")
        with self._lock:
            found = self._states.pop(state, None)
        if (not found or found["provider"] != provider or found["expires"] < self._clock()
                or not hmac.compare_digest(state, str(cookie_state or ""))):
            raise SignInError("That sign-in didn't start here, or it ran out. Try again.", "bad_state")
        if params.get("error"):
            raise SignInError("The sign-in was cancelled.", "cancelled")
        if not params.get("code") or not self.enabled(provider):
            raise SignInError("The provider's answer wasn't valid.")
        saved = self._saved()[provider]
        form = {"grant_type": "authorization_code", "code": params["code"], "redirect_uri": self.redirect_uri(provider)}
        if provider == "google":
            form.update(client_id=saved["client_id"], client_secret=self.vault.open(saved["secret"]), code_verifier=found["verifier"])
        else:
            form.update(client_id=saved["services_id"], client_secret=apple_client_secret(
                saved["team_id"], saved["services_id"], saved["key_id"], self.vault.open(saved["key"]), self._clock()))
        try:
            answer = self.http.post_form(PROVIDERS[provider]["token"], form)
            token = answer.get("id_token")
            if not token:
                raise SignInError("The provider didn't accept the sign-in. Check the client ID and secret.", "provider_refused")
            claims = verify_id_token(token, self.http.get_json(PROVIDERS[provider]["jwks"]), PROVIDERS[provider]["issuers"],
                                     form["client_id"], found["nonce"], self._clock())
        except (OSError, ValueError):
            raise SignInError("The hub couldn't reach the provider. Try again.", "unreachable") from None
        verified = claims.get("email_verified") in (True, "true")
        member = self.accounts.resolve_identity(provider, claims["sub"], str(claims.get("email") or "").lower(), verified,
                                                str(claims.get("name") or ""), found["purpose"], found["member"])
        return {"member": member, "return_to": found["return_to"], "app_challenge": found["app_challenge"],
                "purpose": found["purpose"]}

    # --- apps: a one-time code in place of a cookie ----------------------------

    def app_code(self, member_id, challenge):
        code, now = secrets.token_urlsafe(24), self._clock()
        with self._lock:
            self._codes = {k: v for k, v in self._codes.items() if v[2] > now}
            self._codes[hashlib.sha256(code.encode()).hexdigest()] = (member_id, challenge, now + 300)
        return code

    def swap_code(self, code, verifier):
        """The member a one-time app code was made for. Raises Problem; the code is used up either way."""
        with self._lock:
            found = self._codes.pop(hashlib.sha256(str(code).encode()).hexdigest(), None)
        if not found or found[2] < self._clock() or not pkce_ok(verifier, found[1]):
            raise Problem(403, "That sign-in code is wrong or has run out. Sign in again.", "bad_code")
        return found[0]
