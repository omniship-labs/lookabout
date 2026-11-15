"""Passkeys (WebAuthn), checked on the hub.

Only what the hub needs: registering a credential and checking a sign-in
assertion, for ES256, EdDSA and RS256 keys. The attestation statement is not
checked (attestation "none"): a passkey here proves the person holds the key,
not which make of device it is.
"""

import base64
import hashlib
import json
import re
from urllib.parse import urlsplit

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, ed25519, padding, rsa

ALGORITHMS = (-7, -8, -257)       # ES256, EdDSA, RS256, in the order asked for
FLAG_USER_PRESENT, FLAG_ATTESTED = 0x01, 0x40


class PasskeyError(Exception):
    """Something about a passkey request is wrong; the message is for the person."""


def b64u_encode(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def b64u_decode(text):
    text = str(text)
    if not re.fullmatch(r"[A-Za-z0-9_-]*", text):          # b64decode would quietly skip anything else
        raise PasskeyError("That passkey answer wasn't valid.")
    try:
        return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
    except ValueError:
        raise PasskeyError("That passkey answer wasn't valid.") from None


def cbor_decode(data, i=0, depth=0):
    """Reads one CBOR value. Returns (value, next position). Handles what WebAuthn uses."""
    if depth > 8 or i >= len(data):
        raise PasskeyError("That passkey answer wasn't valid.")
    major, info = data[i] >> 5, data[i] & 31
    i += 1
    widths = {24: 1, 25: 2, 26: 4, 27: 8}
    if info < 24:
        n = info
    elif info in widths:
        n = int.from_bytes(data[i:i + widths[info]], "big")
        i += widths[info]
    else:
        raise PasskeyError("That passkey answer wasn't valid.")
    if major == 0:
        return n, i
    if major == 1:
        return -1 - n, i
    if major in (2, 3):
        if i + n > len(data):
            raise PasskeyError("That passkey answer wasn't valid.")
        raw = bytes(data[i:i + n])
        return (raw if major == 2 else raw.decode("utf-8", "replace")), i + n
    if major in (4, 5) and n <= 64:
        items = []
        for _ in range(n * (2 if major == 5 else 1)):
            item, i = cbor_decode(data, i, depth + 1)
            items.append(item)
        return (items if major == 4 else dict(zip(items[::2], items[1::2]))), i
    if major == 7 and n in (20, 21, 22):
        return {20: False, 21: True, 22: None}[n], i
    raise PasskeyError("That passkey answer wasn't valid.")


def parse_auth_data(data):
    """{rp_id_hash, flags, counter, credential_id, cose} from authenticator data."""
    if len(data) < 37:
        raise PasskeyError("That passkey answer wasn't valid.")
    out = {"rp_id_hash": data[:32], "flags": data[32], "counter": int.from_bytes(data[33:37], "big"),
           "credential_id": None, "cose": None}
    if out["flags"] & FLAG_ATTESTED:
        if len(data) < 55:
            raise PasskeyError("That passkey answer wasn't valid.")
        length = int.from_bytes(data[53:55], "big")
        if len(data) < 55 + length:
            raise PasskeyError("That passkey answer wasn't valid.")
        out["credential_id"] = bytes(data[55:55 + length])
        out["cose"], _ = cbor_decode(data, 55 + length)
    return out


def cose_to_pem(cose):
    """The credential's public key as PEM, from its COSE form."""
    try:
        kty, alg = cose.get(1), cose.get(3)
        if kty == 2 and alg == -7 and cose.get(-1) == 1:
            key = ec.EllipticCurvePublicNumbers(int.from_bytes(cose[-2], "big"), int.from_bytes(cose[-3], "big"),
                                                ec.SECP256R1()).public_key()
        elif kty == 1 and alg == -8 and cose.get(-1) == 6:
            key = ed25519.Ed25519PublicKey.from_public_bytes(cose[-2])
        elif kty == 3 and alg == -257:
            key = rsa.RSAPublicNumbers(int.from_bytes(cose[-2], "big"), int.from_bytes(cose[-1], "big")).public_key()
        else:
            raise PasskeyError("This passkey uses a kind of key the hub doesn't support.")
    except (AttributeError, KeyError, TypeError, ValueError):
        raise PasskeyError("That passkey answer wasn't valid.") from None
    return key.public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()


def _client_data(raw, kind, challenge, origin_ok):
    try:
        data = json.loads(raw)
    except ValueError:
        raise PasskeyError("That passkey answer wasn't valid.") from None
    if not isinstance(data, dict) or data.get("type") != kind:
        raise PasskeyError("That passkey answer wasn't for this.")
    if data.get("challenge") != challenge:
        raise PasskeyError("That passkey request ran out. Try again.")
    origin = str(data.get("origin") or "")
    if not origin_ok(origin):
        raise PasskeyError("That passkey was made for a different address.")
    return urlsplit(origin).hostname or ""


def _check_rp(parsed, rp_id, need_flags=FLAG_USER_PRESENT):
    if parsed["rp_id_hash"] != hashlib.sha256(rp_id.encode()).digest():
        raise PasskeyError("That passkey was made for a different address.")
    if parsed["flags"] & need_flags != need_flags:
        raise PasskeyError("The passkey wasn't confirmed on the device.")


def verify_registration(client_data_json, attestation_object, challenge, origin_ok):
    """A new credential: {credential_id, public_key, counter, rp_id}. Raises PasskeyError."""
    rp_id = _client_data(client_data_json, "webauthn.create", challenge, origin_ok)
    attestation, _ = cbor_decode(attestation_object)
    if not isinstance(attestation, dict) or not isinstance(attestation.get("authData"), bytes):
        raise PasskeyError("That passkey answer wasn't valid.")
    parsed = parse_auth_data(attestation["authData"])
    _check_rp(parsed, rp_id, FLAG_USER_PRESENT | FLAG_ATTESTED)
    if not parsed["credential_id"] or not isinstance(parsed["cose"], dict):
        raise PasskeyError("That passkey answer wasn't valid.")
    return {"credential_id": b64u_encode(parsed["credential_id"]), "public_key": cose_to_pem(parsed["cose"]),
            "counter": parsed["counter"], "rp_id": rp_id}


def verify_assertion(client_data_json, auth_data, signature, challenge, origin_ok, public_key_pem, stored_counter, rp_id):
    """Checks a sign-in and returns the credential's new counter. Raises PasskeyError."""
    seen_rp = _client_data(client_data_json, "webauthn.get", challenge, origin_ok)
    if seen_rp != rp_id:
        raise PasskeyError("That passkey was made for a different address.")
    parsed = parse_auth_data(auth_data)
    _check_rp(parsed, rp_id)
    signed = auth_data + hashlib.sha256(client_data_json).digest()
    key = serialization.load_pem_public_key(public_key_pem.encode())
    try:
        if isinstance(key, ec.EllipticCurvePublicKey):
            key.verify(signature, signed, ec.ECDSA(hashes.SHA256()))
        elif isinstance(key, ed25519.Ed25519PublicKey):
            key.verify(signature, signed)
        else:
            key.verify(signature, signed, padding.PKCS1v15(), hashes.SHA256())
    except InvalidSignature:
        raise PasskeyError("That passkey didn't check out.") from None
    # A counter that goes backwards means the passkey was copied.
    if (parsed["counter"] or stored_counter) and parsed["counter"] <= stored_counter:
        raise PasskeyError("That passkey looks copied, so the hub refused it.")
    return parsed["counter"]
