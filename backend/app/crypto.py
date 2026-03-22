"""AES-256-GCM encryption helpers.

Encrypted blob layout: salt(16 bytes) | nonce(12 bytes) | ciphertext
"""
import os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes


def _derive_key(passphrase: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=100_000,
    )
    return kdf.derive(passphrase.encode("utf-8"))


def encrypt(data: bytes, passphrase: str) -> bytes:
    salt = os.urandom(16)
    nonce = os.urandom(12)
    key = _derive_key(passphrase, salt)
    ciphertext = AESGCM(key).encrypt(nonce, data, None)
    return salt + nonce + ciphertext


def decrypt(blob: bytes, passphrase: str) -> bytes:
    salt, nonce, ciphertext = blob[:16], blob[16:28], blob[28:]
    key = _derive_key(passphrase, salt)
    return AESGCM(key).decrypt(nonce, ciphertext, None)
