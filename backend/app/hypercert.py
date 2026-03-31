import hashlib
import json
import re
import uuid
from datetime import datetime, timezone
from urllib.parse import urlparse


# ── Impact type keyword classifier ───────────────────────────────────────────

_IMPACT_KEYWORDS: list[tuple[str, list[str]]] = [
    ("environmental", ["climate", "carbon", "emission", "forest", "ocean", "biodiversity",
                        "sustainability", "renewable", "energy", "pollution", "green"]),
    ("health",        ["health", "medical", "disease", "vaccine", "hospital", "mental",
                        "wellbeing", "nutrition", "pandemic", "medicine", "drug"]),
    ("education",     ["education", "school", "learning", "student", "teacher", "literacy",
                        "university", "training", "course", "curriculum"]),
    ("research",      ["research", "study", "paper", "journal", "science", "data", "analysis",
                        "findings", "experiment", "discovery", "publish"]),
    ("social",        ["community", "poverty", "inequality", "gender", "rights", "refugee",
                        "humanitarian", "welfare", "social", "justice", "inclusion"]),
    ("technological", ["technology", "software", "ai", "blockchain", "open source", "crypto",
                        "digital", "platform", "developer", "code", "innovation"]),
    ("economic",      ["economy", "finance", "investment", "gdp", "market", "trade", "fund",
                        "grant", "startup", "business", "revenue"]),
    ("governance",    ["policy", "government", "regulation", "law", "election", "democracy",
                        "transparency", "accountability", "public", "reform"]),
]

def _classify_impact_type(text: str) -> str:
    low = text.lower()
    scores = {itype: sum(1 for kw in kws if kw in low)
              for itype, kws in _IMPACT_KEYWORDS}
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else "other"


def _deterministic_score(seed: str, lo: int, hi: int) -> int:
    """Stable score derived from text so the same page always gives same result."""
    h = int(hashlib.md5(seed.encode()).hexdigest()[:8], 16)
    return lo + (h % (hi - lo + 1))


# ── Mock / demo Hypercert (no AI needed) ─────────────────────────────────────

def generate_mock_hypercert(
    url: str,
    title: str,
    text_snippet: str,
    evidence_cids: list[str],
    job_id: str,
) -> dict:
    now     = datetime.now(timezone.utc)
    year    = now.strftime("%Y")
    created = now.isoformat()
    seed    = url + title

    # Parse URL for context
    parsed   = urlparse(url) if url else urlparse("https://unknown.org")
    domain   = parsed.netloc.replace("www.", "") or "unknown source"
    path_parts = [p for p in parsed.path.split("/") if p and len(p) > 2]
    topics   = list(dict.fromkeys(                         # dedup, preserve order
        [w.replace("-", " ").replace("_", " ")
         for p in path_parts[:3] for w in [p]]
    ))[:4] or ["web content"]

    # Classify impact type from title + snippet
    combined     = f"{title} {text_snippet}"
    impact_type  = _classify_impact_type(combined)

    # Extract a plausible "actor" — the domain org name
    org = domain.split(".")[0].capitalize() if domain else "Unknown"

    # Derive action verb from title
    action_words = re.findall(r'\b(launch|publish|fund|build|create|support|develop|report|'
                               r'improve|reduce|increase|release|open|share|announce)\w*\b',
                               title.lower())
    action = (action_words[0].capitalize() + "ed") if action_words else "Published"

    # Build key points from title words
    words = [w for w in title.split() if len(w) > 4][:6]
    key_points = [
        f"{action} by {org} via {domain}",
        f"Impact area: {impact_type.replace('_', ' ').title()}",
        f"Source: {domain} — archived on {now.strftime('%Y-%m-%d')}",
        f"Topics: {', '.join(topics)}",
        f"Evidence stored on Filecoin ({len(evidence_cids)} CID(s))",
    ]

    # Scores — deterministic from URL so they stay consistent on regeneration
    impact_score      = _deterministic_score(seed + "impact",      45, 88)
    confidence_score  = _deterministic_score(seed + "confidence",  52, 91)
    novelty_score     = _deterministic_score(seed + "novelty",     30, 85)
    credibility_score = _deterministic_score(seed + "credibility", 48, 90)

    summary = (
        f"{title} — archived from {domain} on {now.strftime('%B %d, %Y')}. "
        f"This page has been classified as {impact_type.replace('_',' ')} content "
        f"with an impact score of {impact_score}/100. "
        f"The content was saved and encrypted to decentralised storage as part of "
        f"the FilImpact archive."
    )

    evidence = [{"type": "url", "src": url, "label": "Original webpage"}]
    for cid in evidence_cids:
        evidence.append({"type": "filecoin", "src": f"ipfs://{cid}",
                          "label": "Encrypted archive on Filecoin"})

    return {
        "hypercert_id":   str(uuid.uuid4()),
        "job_id":         job_id,
        "schema_version": "1.0",
        "created_at":     created,
        "status":         "simulated",
        "mock":           True,        # flag so UI can show "Demo Mode"

        "work": {
            "title":        title[:100] or "Untitled",
            "description":  f"{action} by {org}: {title[:120]}",
            "contributors": [org],
            "scope":        {"description": f"{domain} — {impact_type}", "areas": topics},
            "timeframe":    {"start": year, "end": year},
        },
        "impact": {
            "description": (
                f"Potential {impact_type.replace('_',' ')} impact documented at {domain}. "
                f"Content preserved permanently via Filecoin decentralised storage."
            ),
            "contributors": ["Web Archive Community"],
            "scope": {"description": impact_type.replace("_", " ").title(),
                      "areas": [impact_type]},
            "timeframe": {"start": year, "end": None},
        },
        "rights": {
            "description": "CC0 — open data",
            "uri": "https://creativecommons.org/publicdomain/zero/1.0/",
        },
        "metadata": {
            "name":        (title[:60] or "Untitled"),
            "description": summary[:300],
            "external_url": url,
            "impact_type":  impact_type,
            "impact_score": impact_score,
            "confidence_score": confidence_score,
            "evidence": evidence,
            "properties": {
                "source_domain":    domain,
                "credibility_score": credibility_score,
                "novelty_score":    novelty_score,
                "generated_by":     "FilImpact — demo mode (no AI)",
                "pwm_job_id":       job_id,
            },
        },

        "summary":    summary,
        "key_points": key_points,
        "topics":     topics,
        "scores": {
            "impact":      impact_score,
            "confidence":  confidence_score,
            "novelty":     novelty_score,
            "credibility": credibility_score,
        },
    }


# ── Schema builder ────────────────────────────────────────────────────────────

def build_hypercert(
    generator_output: dict,
    page_url: str,
    evidence_cids: list[str],
    job_id: str,
) -> dict:
    payload = generator_output.get("hypercert_payload", {})
    work    = payload.get("work", {})
    impact  = payload.get("impact", {})
    meta    = payload.get("metadata", {})
    rights  = payload.get("rights", {
        "description": "CC0 — open data",
        "uri": "https://creativecommons.org/publicdomain/zero/1.0/",
    })

    # Normalise evidence: always include the page URL + any CIDs
    evidence = [{"type": "url", "src": page_url, "label": "Original webpage"}]
    for cid in evidence_cids:
        evidence.append({
            "type": "filecoin",
            "src": f"ipfs://{cid}",
            "label": "Encrypted archive on Filecoin",
        })

    return {
        # Hypercerts spec top-level fields
        "hypercert_id": str(uuid.uuid4()),
        "job_id": job_id,
        "schema_version": "1.0",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "status": "simulated",   # change to "minted" after real tx

        # Core claim data
        "work": {
            "title":        work.get("title", meta.get("name", "Untitled")),
            "description":  work.get("description", ""),
            "contributors": _ensure_list(work.get("contributors", [])),
            "scope":        work.get("scope", {"description": "", "areas": []}),
            "timeframe":    work.get("timeframe", {"start": None, "end": None}),
        },
        "impact": {
            "description": impact.get("description", ""),
            "contributors": _ensure_list(impact.get("contributors", [])),
            "scope":        impact.get("scope", {"description": "", "areas": []}),
            "timeframe":    impact.get("timeframe", {"start": None, "end": None}),
        },
        "rights": rights,

        # Rich metadata
        "metadata": {
            "name":        meta.get("name", work.get("title", "Untitled"))[:100],
            "description": meta.get("description", "")[:500],
            "external_url": page_url,
            "impact_type":  meta.get("impact_type", "other"),
            "impact_score": _clamp(meta.get("impact_score", 0)),
            "confidence_score": _clamp(meta.get("confidence_score", 0)),
            "evidence": evidence,
            "properties": {
                **meta.get("properties", {}),
                "generated_by": "FilImpact agentic pipeline",
                "pwm_job_id": job_id,
            },
        },

        # Human-readable summary from generator
        "summary":    generator_output.get("summary", ""),
        "key_points": generator_output.get("key_points", []),
        "topics":     generator_output.get("topics", []),
    }


def simulate_mint(hypercert: dict) -> dict:
    return {
        "simulation": True,
        "hypercert_id": hypercert["hypercert_id"],
        "message": (
            "Impact claim generated. Click 'Publish to Hypercerts Protocol' to create "
            "real ATProto records on your PDS."
        ),
        "payload_preview": json.dumps(hypercert["metadata"], indent=2)[:500],
    }


# ── Helpers ───────────────────────────────────────────────────────────────────

def _ensure_list(v) -> list:
    if isinstance(v, list):
        return v
    if isinstance(v, str):
        return [v] if v else []
    return []


def _clamp(v, lo: int = 0, hi: int = 100) -> int:
    try:
        return max(lo, min(hi, int(v)))
    except (TypeError, ValueError):
        return 0


def _fake_cid(uid: str) -> str:
    h = hashlib.sha256(uid.encode()).hexdigest()[:40]
    return f"Qm{h}"
