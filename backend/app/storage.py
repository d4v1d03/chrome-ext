import base64
import json
import os
import subprocess
from typing import Optional

# Path to the sidecar script relative to this file:
# backend/app/storage.py  →  ../../synapse_sidecar.js
_SIDECAR_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "synapse_sidecar.mjs")
_SIDECAR_PATH = os.path.normpath(_SIDECAR_PATH)


class MockStorage:

    _store: dict = {}
    _counter: int = 0

    def store(self, data: bytes, metadata: dict) -> str:
        MockStorage._counter += 1
        cid = f"mock-cid-{MockStorage._counter:06d}-{os.urandom(4).hex()}"
        MockStorage._store[cid] = {"data": data, "metadata": metadata}
        return cid

    def retrieve(self, cid: str) -> Optional[bytes]:
        entry = MockStorage._store.get(cid)
        return entry["data"] if entry else None


class FilecoinStorage:

    def __init__(self, private_key: str, network: str = "calibration"):
        self.private_key = private_key
        self.network = network

    def store(self, data: bytes, metadata: dict) -> str:
        payload = json.dumps({
            "privateKey": self.private_key,
            "network":    self.network,
            "dataB64":    base64.b64encode(data).decode("ascii"),
            "metadata":   metadata,
        })

        result = subprocess.run(
            ["node", _SIDECAR_PATH],
            input=payload,
            capture_output=True,
            text=True,
            timeout=120,        # uploads can take a while on Calibration
        )

        try:
            out = json.loads(result.stdout)
        except json.JSONDecodeError:
            stderr = result.stderr[:400] if result.stderr else "(no stderr)"
            raise RuntimeError(f"Sidecar returned non-JSON: {result.stdout!r} | stderr: {stderr}")

        if "error" in out:
            raise RuntimeError(f"Filecoin upload failed: {out['error']}")

        return out["cid"]

    def retrieve(self, cid: str) -> Optional[bytes]:
        # Retrieval via sidecar not implemented yet — data can be fetched
        # via ipfs.io/ipfs/<cid> or synapse.storage.download() in the extension
        return None


def get_storage():
    from app.config import settings

    if settings.filecoin_private_key:
        return FilecoinStorage(settings.filecoin_private_key, settings.filecoin_network)
    return MockStorage()
