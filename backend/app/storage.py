"""Storage layer.

MockStorage: in-process dict store, good for development.
FilecoinStorage: stub that delegates to Mock until a Node.js Synapse
                 sidecar is wired up for real on-chain storage.

Swap get_storage() return value to FilecoinStorage once you have
FILECOIN_PRIVATE_KEY in your .env and a sidecar running.
"""
import os
from typing import Optional


class MockStorage:
    """In-memory store. Data is lost on worker restart."""

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
    """
    Filecoin via Synapse SDK.
    Currently falls back to MockStorage; replace store() with an HTTP
    call to a Node.js sidecar (e.g. `node synapse-sidecar.js`) that
    wraps the @filoz/synapse-sdk once you're ready for production.
    """

    def __init__(self, private_key: str, network: str = "calibration"):
        self.private_key = private_key
        self.network = network
        self._mock = MockStorage()

    def store(self, data: bytes, metadata: dict) -> str:
        # TODO: POST to Node.js sidecar → returns pieceCid
        return self._mock.store(data, metadata)

    def retrieve(self, cid: str) -> Optional[bytes]:
        return self._mock.retrieve(cid)


def get_storage():
    from app.config import settings

    if settings.filecoin_private_key:
        return FilecoinStorage(settings.filecoin_private_key, settings.filecoin_network)
    return MockStorage()
