"""A software passkey for the tests: makes credentials and signs sign-ins the way a device would."""

import hashlib
import json
import os

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec, ed25519, padding, rsa
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature  # noqa: F401

from lookabout_hub.webauthn import b64u_decode, b64u_encode


def cbor(value):
    def head(major, n):
        if n < 24:
            return bytes([major << 5 | n])
        for info, width in ((24, 1), (25, 2), (26, 4), (27, 8)):
            if n < 1 << (8 * width):
                return bytes([major << 5 | info]) + n.to_bytes(width, "big")
    if isinstance(value, bool):
        return b"\xf5" if value else b"\xf4"
    if isinstance(value, int):
        return head(0, value) if value >= 0 else head(1, -1 - value)
    if isinstance(value, bytes):
        return head(2, len(value)) + value
    if isinstance(value, str):
        return head(3, len(value.encode())) + value.encode()
    if isinstance(value, list):
        return head(4, len(value)) + b"".join(cbor(v) for v in value)
    return head(5, len(value)) + b"".join(cbor(k) + cbor(v) for k, v in value.items())


class Authenticator:
    def __init__(self, rp_id="127.0.0.1", kind="es256", counter=0):
        self.rp_id, self.kind, self.counter = rp_id, kind, counter
        self.credential_id = os.urandom(16)
        if kind == "es256":
            self.key = ec.generate_private_key(ec.SECP256R1())
        elif kind == "eddsa":
            self.key = ed25519.Ed25519PrivateKey.generate()
        else:
            self.key = rsa.generate_private_key(65537, 2048)

    @property
    def id(self):
        return b64u_encode(self.credential_id)

    def cose(self):
        if self.kind == "es256":
            n = self.key.public_key().public_numbers()
            return {1: 2, 3: -7, -1: 1, -2: n.x.to_bytes(32, "big"), -3: n.y.to_bytes(32, "big")}
        if self.kind == "eddsa":
            from cryptography.hazmat.primitives import serialization
            raw = self.key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
            return {1: 1, 3: -8, -1: 6, -2: raw}
        n = self.key.public_key().public_numbers()
        return {1: 3, 3: -257, -1: n.n.to_bytes(256, "big"), -2: n.e.to_bytes(3, "big")}

    def _auth_data(self, flags, attested, rp_id=None):
        data = hashlib.sha256((rp_id or self.rp_id).encode()).digest() + bytes([flags]) + self.counter.to_bytes(4, "big")
        if attested:
            data += bytes(16) + len(self.credential_id).to_bytes(2, "big") + self.credential_id + cbor(self.cose())
        return data

    def create(self, challenge, origin, flags=0x45, kind="webauthn.create", rp_id=None):
        client = json.dumps({"type": kind, "challenge": challenge, "origin": origin}).encode()
        attestation = cbor({"fmt": "none", "attStmt": {}, "authData": self._auth_data(flags, True, rp_id)})
        return {"id": self.id, "response": {"clientDataJSON": b64u_encode(client), "attestationObject": b64u_encode(attestation)}}

    def sign(self, data):
        if self.kind == "es256":
            return self.key.sign(data, ec.ECDSA(hashes.SHA256()))
        if self.kind == "eddsa":
            return self.key.sign(data)
        return self.key.sign(data, padding.PKCS1v15(), hashes.SHA256())

    def get(self, challenge, origin, counter=None, flags=0x05, kind="webauthn.get", rp_id=None, sign_with=None):
        self.counter = self.counter + 1 if counter is None else counter
        client = json.dumps({"type": kind, "challenge": challenge, "origin": origin}).encode()
        auth = self._auth_data(flags, False, rp_id)
        signer = sign_with or self
        signature = signer.sign(auth + hashlib.sha256(client).digest())
        return {"id": self.id, "response": {"clientDataJSON": b64u_encode(client), "authenticatorData": b64u_encode(auth),
                                            "signature": b64u_encode(signature), "userHandle": ""}}


__all__ = ["Authenticator", "cbor", "b64u_decode"]
