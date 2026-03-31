"""Publishes Hypercert records to AT Protocol via the atproto_sidecar.mjs."""
import json
import os
import subprocess

_SIDECAR_PATH = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "atproto_sidecar.mjs")
)


def publish(
    hypercert: dict,
    scores: dict,
    evidence_cids: list[str],
    page_url: str,
    page_title: str,
    pds_url: str,
    identifier: str,
    password: str,
) -> dict:
    """
    Call the ATProto sidecar and return a dict with AT-URIs for all created records.
    Raises RuntimeError on failure.
    """
    payload = json.dumps({
        "pdsUrl":      pds_url,
        "identifier":  identifier,
        "password":    password,
        "hypercert":   hypercert,
        "scores":      scores,
        "evidenceCids": evidence_cids,
        "pageUrl":     page_url,
        "pageTitle":   page_title,
    })

    result = subprocess.run(
        ["node", _SIDECAR_PATH],
        input=payload,
        capture_output=True,
        text=True,
        timeout=60,
    )

    try:
        out = json.loads(result.stdout)
    except json.JSONDecodeError:
        stderr = (result.stderr or "")[:400]
        raise RuntimeError(f"ATProto sidecar returned non-JSON: {result.stdout!r} | stderr: {stderr}")

    if "error" in out:
        raise RuntimeError(f"ATProto publish failed: {out['error']}")

    return out
