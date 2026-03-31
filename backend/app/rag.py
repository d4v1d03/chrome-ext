import json
import math
import os
import threading
from typing import Optional

import numpy as np

_STORE_PATH = os.environ.get("RAG_STORE_PATH", "/tmp/pwm_rag_store.json")
_LOCK = threading.Lock()


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    denom = (np.linalg.norm(a) * np.linalg.norm(b))
    if denom == 0:
        return 0.0
    return float(np.dot(a, b) / denom)


class VectorStore:
    def __init__(self, path: str = _STORE_PATH):
        self._path = path
        self._entries: dict[str, dict] = {}   # job_id → {embedding, metadata}
        self._load()

    def _load(self):
        if os.path.exists(self._path):
            try:
                with open(self._path) as f:
                    raw = json.load(f)
                self._entries = {
                    k: {"embedding": np.array(v["embedding"], dtype=np.float32),
                        "metadata": v["metadata"]}
                    for k, v in raw.items()
                }
            except Exception:
                self._entries = {}

    def _save(self):
        try:
            with open(self._path, "w") as f:
                json.dump(
                    {k: {"embedding": v["embedding"].tolist(),
                         "metadata": v["metadata"]}
                     for k, v in self._entries.items()},
                    f,
                )
        except Exception:
            pass

    def add(self, job_id: str, embedding: list[float], metadata: dict):
        with _LOCK:
            self._entries[job_id] = {
                "embedding": np.array(embedding, dtype=np.float32),
                "metadata": metadata,
            }
            self._save()

    def search(self, query_embedding: list[float], top_k: int = 5) -> list[dict]:
        if not self._entries:
            return []
        q = np.array(query_embedding, dtype=np.float32)
        scored = [
            {
                "job_id": jid,
                "score": _cosine(q, entry["embedding"]),
                **entry["metadata"],
            }
            for jid, entry in self._entries.items()
        ]
        scored.sort(key=lambda x: x["score"], reverse=True)
        return scored[:top_k]

    def get_related(self, job_id: str, top_k: int = 3) -> list[dict]:
        entry = self._entries.get(job_id)
        if not entry:
            return []
        results = self.search(entry["embedding"].tolist(), top_k=top_k + 1)
        return [r for r in results if r["job_id"] != job_id][:top_k]

    def remove(self, job_id: str):
        with _LOCK:
            self._entries.pop(job_id, None)
            self._save()

    def count(self) -> int:
        return len(self._entries)


_store: Optional[VectorStore] = None


def get_store() -> VectorStore:
    global _store
    if _store is None:
        _store = VectorStore()
    return _store
