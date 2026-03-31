import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.models import (
    HypercertResponse,
    JobStatus,
    PublishResponse,
    RelatedResponse,
    SaveRequest,
    SaveResponse,
    ScoresData,
    SearchResponse,
)
from app.tasks import (
    celery_app,
    process_agentic_pipeline,
    process_ai_summary,
    process_full_save,
)

app = FastAPI(
    title="FilImpact API",
    version="2.0.0",
    description="Agentic AI + RAG + Hypercert backend for FilImpact.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def verify_api_key(x_api_key: Optional[str] = Header(None)) -> None:
    if settings.backend_api_key and x_api_key != settings.backend_api_key:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@app.get("/health", tags=["meta"])
async def health():
    from app.rag import get_store
    return {
        "status": "ok",
        "timestamp": _now(),
        "rag_entries": get_store().count(),
        "version": "2.0.0",
    }


@app.post("/api/save", response_model=SaveResponse, tags=["archive"])
async def save_page(
    request: SaveRequest,
    _: None = Depends(verify_api_key),
):
    job_id = str(uuid.uuid4())
    page_data = request.page.model_dump()

    if request.mode == "full":
        process_full_save.apply_async(
            args=[job_id, page_data, settings.encryption_secret],
            task_id=job_id,
        )
    elif request.mode == "ai_summary":
        _require_openai()
        process_ai_summary.apply_async(
            args=[job_id, page_data, settings.encryption_secret, settings.openai_api_key],
            task_id=job_id,
        )
    elif request.mode == "agentic":
        _require_openai()
        process_agentic_pipeline.apply_async(
            args=[job_id, page_data, settings.encryption_secret, settings.openai_api_key],
            task_id=job_id,
        )
    else:
        raise HTTPException(status_code=400, detail=f"Unknown mode: {request.mode!r}")

    return SaveResponse(job_id=job_id, status="queued", message="Processing started")


@app.get("/api/status/{job_id}", response_model=JobStatus, tags=["archive"])
async def get_status(
    job_id: str,
    _: None = Depends(verify_api_key),
):
    result = celery_app.AsyncResult(job_id)
    state  = result.state

    if state == "PENDING":
        return JobStatus(job_id=job_id, status="queued")
    if state in ("STARTED", "RECEIVED"):
        return JobStatus(job_id=job_id, status="processing")
    if state == "PROGRESS":
        meta = result.info or {}
        return JobStatus(job_id=job_id, status="processing", step=meta.get("step"))
    if state == "SUCCESS":
        data = result.result or {}
        scores_raw = data.get("scores")
        return JobStatus(
            job_id=job_id,
            status="complete",
            cid=data.get("cid"),
            mode=data.get("mode"),
            summary=data.get("summary"),
            key_points=data.get("key_points"),
            topics=data.get("topics"),
            scores=ScoresData(**scores_raw) if scores_raw else None,
            impact_type=data.get("impact_type"),
            hypercert_payload=data.get("hypercert_payload"),
        )
    if state == "FAILURE":
        return JobStatus(
            job_id=job_id,
            status="failed",
            error=str(result.info) if result.info else "Unknown error",
        )
    return JobStatus(job_id=job_id, status=state.lower())


@app.get("/api/search", response_model=SearchResponse, tags=["rag"])
async def search_archives(
    q: str = Query(..., description="Natural language search query"),
    top_k: int = Query(5, ge=1, le=20),
    _: None = Depends(verify_api_key),
):
    _require_openai()
    from app.ai import generate_embeddings
    from app.rag import get_store

    embedding = await generate_embeddings(text=q, api_key=settings.openai_api_key)
    results   = get_store().search(embedding, top_k=top_k)

    return SearchResponse(
        query=q,
        results=results,
        total=len(results),
    )


@app.get("/api/related/{job_id}", response_model=RelatedResponse, tags=["rag"])
async def get_related(
    job_id: str,
    top_k: int = Query(3, ge=1, le=10),
    _: None = Depends(verify_api_key),
):
    from app.rag import get_store
    related = get_store().get_related(job_id, top_k=top_k)
    return RelatedResponse(job_id=job_id, related=related)


@app.post("/api/hypercert/{job_id}", response_model=HypercertResponse, tags=["hypercert"])
async def generate_hypercert(
    job_id: str,
    mock: bool = Query(False, description="Skip AI — generate demo Hypercert from page metadata only"),
    page_url: Optional[str] = Query(None),
    page_title: Optional[str] = Query(None),
    page_text: Optional[str] = Query(None),
    _: None = Depends(verify_api_key),
):
    result = celery_app.AsyncResult(job_id)

    if not mock and result.state != "SUCCESS":
        raise HTTPException(
            status_code=404,
            detail=(
                f"Job {job_id} is not complete yet (state={result.state}). "
                "Wait for the save to finish, or use ?mock=true for an instant demo claim."
            ),
        )

    from app.hypercert import build_hypercert, generate_mock_hypercert, simulate_mint

    data = result.result or {} if result.state == "SUCCESS" else {}
    cids = [c for c in [data.get("cid")] if c]
    url   = page_url   or data.get("url",   "")
    title = page_title or data.get("title", "")
    snippet = page_text or ""

    def _make_mock():
        hc = generate_mock_hypercert(
            url=url, title=title, text_snippet=snippet,
            evidence_cids=cids, job_id=job_id,
        )
        sim = simulate_mint(hc)
        return HypercertResponse(job_id=job_id, hypercert=hc, simulation=sim, generated_at=_now())

    if mock:
        return _make_mock()

    _require_openai()

    try:
        if data.get("mode") == "agentic" and data.get("hypercert_payload"):
            hc = build_hypercert(
                generator_output={
                    "hypercert_payload": data["hypercert_payload"],
                    "summary":    data.get("summary", ""),
                    "key_points": data.get("key_points", []),
                    "topics":     data.get("topics", []),
                },
                page_url=url,
                evidence_cids=cids,
                job_id=job_id,
            )

        else:
            from app.agents import extractor as ext_agent
            from app.agents import generator as gen_agent
            from app.agents import scorer as sc_agent
            from app.agents import validator as val_agent
            from app.ai import generate_embeddings
            from app.rag import get_store

            summary_obj = data.get("summary") or {}
            if isinstance(summary_obj, dict):
                text = summary_obj.get("summary", "") or " ".join(summary_obj.get("key_points", []))
            else:
                text = str(summary_obj)

            page_data_stub = {
                "url":   url,
                "title": title,
                "text":  text or title or "impact claim",
                "html":  "",
            }

            if not page_data_stub["url"]:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        "Cannot generate an AI Hypercert for a 'full' mode save: "
                        "no text content is available. Use ?mock=true for a demo claim, "
                        "or re-save this page using AI Summary or Agentic mode."
                    ),
                )

            extracted = await ext_agent.run(page_data_stub, api_key=settings.openai_api_key)
            query_emb = await generate_embeddings(text=page_data_stub["text"], api_key=settings.openai_api_key)
            related   = get_store().search(query_emb, top_k=3)
            validated = await val_agent.run(extracted, related, api_key=settings.openai_api_key)
            scored    = await sc_agent.run(extracted, validated, related, api_key=settings.openai_api_key)
            generated = await gen_agent.run(extracted, validated, scored, evidence_cids=cids, api_key=settings.openai_api_key)
            hc = build_hypercert(generator_output=generated, page_url=url, evidence_cids=cids, job_id=job_id)

        sim = simulate_mint(hc)
        return HypercertResponse(job_id=job_id, hypercert=hc, simulation=sim, generated_at=_now())

    except HTTPException:
        raise
    except Exception as exc:
        import traceback
        tb = traceback.format_exc()
        err_str = str(exc)
        if "429" in err_str or "insufficient_quota" in err_str or "401" in err_str or "invalid_api_key" in err_str:
            hc = generate_mock_hypercert(url=url, title=title, text_snippet=snippet,
                                          evidence_cids=cids, job_id=job_id)
            hc["mock_reason"] = f"AI unavailable ({err_str[:120]}). Showing demo claim."
            sim = simulate_mint(hc)
            return HypercertResponse(job_id=job_id, hypercert=hc, simulation=sim, generated_at=_now())
        raise HTTPException(
            status_code=500,
            detail=f"Hypercert generation failed: {exc}\n\n{tb[-800:]}",
        )


@app.get("/api/hypercert/{job_id}", response_model=HypercertResponse, tags=["hypercert"])
async def get_hypercert(
    job_id: str,
    mock: bool = Query(False),
    page_url: Optional[str] = Query(None),
    page_title: Optional[str] = Query(None),
    page_text: Optional[str] = Query(None),
    _: None = Depends(verify_api_key),
):
    return await generate_hypercert(job_id, mock=mock, page_url=page_url,
                                     page_title=page_title, page_text=page_text, _=_)


@app.post("/api/hypercert/{job_id}/publish", response_model=PublishResponse, tags=["hypercert"])
async def publish_hypercert(
    job_id: str,
    page_url:   Optional[str] = Query(None),
    page_title: Optional[str] = Query(None),
    _: None = Depends(verify_api_key),
):
    """
    Publish a Hypercert to the AT Protocol as real, linked records.

    Creates 4 record types on the configured PDS:
      - org.hypercerts.claim.activity     (core impact claim)
      - org.hypercerts.context.attachment (page URL + Filecoin CIDs as evidence)
      - org.hypercerts.context.measurement (AI scores)
      - org.hypercerts.context.evaluation  (agentic evaluation)

    Requires PDS_HANDLE and PDS_PASSWORD in .env.
    """
    if not settings.pds_handle or not settings.pds_password:
        raise HTTPException(
            status_code=400,
            detail="PDS_HANDLE and PDS_PASSWORD must be set in .env to publish to AT Protocol.",
        )

    result = celery_app.AsyncResult(job_id)
    if result.state != "SUCCESS":
        raise HTTPException(
            status_code=404,
            detail=f"Job not complete (state={result.state}). Wait for the save to finish first.",
        )

    data      = result.result or {}
    url       = page_url   or data.get("url",   "")
    title     = page_title or data.get("title", "")
    cid       = data.get("cid", "")
    scores    = data.get("scores") or {}
    hc_payload = data.get("hypercert_payload") or {}

    # Build a hypercert object — use existing payload if agentic, otherwise build from metadata
    if data.get("mode") == "agentic" and hc_payload:
        from app.hypercert import build_hypercert
        hc = build_hypercert(
            generator_output={
                "hypercert_payload": hc_payload,
                "summary":    data.get("summary", ""),
                "key_points": data.get("key_points", []),
                "topics":     data.get("topics", []),
            },
            page_url=url,
            evidence_cids=[c for c in [cid] if c],
            job_id=job_id,
        )
    else:
        from app.hypercert import generate_mock_hypercert
        summary_obj = data.get("summary") or {}
        snippet = (summary_obj.get("summary", "") if isinstance(summary_obj, dict) else str(summary_obj))[:300]
        hc = generate_mock_hypercert(
            url=url, title=title, text_snippet=snippet,
            evidence_cids=[c for c in [cid] if c], job_id=job_id,
        )
        scores = hc.get("scores", scores)

    from app.atproto_publisher import publish
    try:
        pub = publish(
            hypercert=hc,
            scores=scores,
            evidence_cids=[c for c in [cid] if c],
            page_url=url,
            page_title=title,
            pds_url=settings.pds_url,
            identifier=settings.pds_handle,
            password=settings.pds_password,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    # Build a viewer URL — certified.app can display ATProto hypercerts
    did_short  = pub.get("did", "").replace("did:plc:", "")
    viewer_url = f"https://certified.app/hypercert/{pub.get('activityUri', '').replace('at://', '')}" if pub.get("activityUri") else None

    return PublishResponse(
        job_id=job_id,
        activity_uri=pub["activityUri"],
        activity_cid=pub["activityCid"],
        did=pub.get("did", ""),
        pds_url=pub.get("pdsUrl", settings.pds_url),
        attachment_uris=pub.get("attachmentUris", []),
        measurement_uris=pub.get("measurementUris", []),
        evaluation_uri=pub.get("evaluationUri"),
        published_at=pub.get("publishedAt", _now()),
        explorer_url=viewer_url,
    )


@app.get("/api/debug/job/{job_id}", tags=["debug"])
async def debug_job(job_id: str):
    result = celery_app.AsyncResult(job_id)
    info = None
    try:
        info = result.info
        if hasattr(info, "__traceback__"):
            info = str(info)
    except Exception:
        info = str(result.info)

    return {
        "job_id":  job_id,
        "state":   result.state,
        "result":  result.result if result.state == "SUCCESS" else None,
        "error":   str(info) if result.state == "FAILURE" else None,
        "keys_in_result": list(result.result.keys()) if result.state == "SUCCESS" and result.result else [],
    }


@app.get("/api/view/{job_id}", tags=["archive"])
async def view_archive(
    job_id: str,
    _: None = Depends(verify_api_key),
):
    """Decrypt and return the readable content of a saved archive."""
    result = celery_app.AsyncResult(job_id)
    if result.state != "SUCCESS":
        raise HTTPException(status_code=404, detail=f"Job not complete (state={result.state})")

    data = result.result or {}
    cid  = data.get("cid", "")
    url  = data.get("url", "")
    mode = data.get("mode", "")

    from app.storage import get_storage
    from app.crypto import decrypt

    raw_bytes = get_storage().retrieve(cid)

    if raw_bytes is None:
        # Storage has no bytes (e.g. worker restarted and MockStorage was cleared)
        # Return whatever metadata we have from the Celery result
        summary_obj = data.get("summary") or {}
        text = ""
        if isinstance(summary_obj, dict):
            text = summary_obj.get("summary", "") or " ".join(summary_obj.get("key_points", []))
        elif isinstance(summary_obj, str):
            text = summary_obj

        return {
            "job_id":  job_id,
            "url":     url,
            "title":   data.get("title", ""),
            "mode":    mode,
            "cid":     cid,
            "warning": "Archive bytes not found in storage (MockStorage restarted). Showing metadata only.",
            "content": {
                "summary":    text[:2000] if text else None,
                "key_points": data.get("key_points", []),
                "topics":     data.get("topics", []),
            },
        }

    try:
        decrypted = decrypt(raw_bytes, settings.encryption_secret)
        import json as _json
        archive = _json.loads(decrypted.decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Decryption failed: {exc}")

    content = archive.get("content", {})
    summary = archive.get("summary", {})
    return {
        "job_id":  job_id,
        "url":     archive.get("metadata", {}).get("url", url),
        "title":   archive.get("metadata", {}).get("title", ""),
        "mode":    mode,
        "cid":     cid,
        "content": {
            "text":       (content.get("text", "") or "")[:5000],
            "summary":    summary.get("summary", "") if isinstance(summary, dict) else "",
            "key_points": summary.get("key_points", []) if isinstance(summary, dict) else [],
            "topics":     summary.get("topics", []) if isinstance(summary, dict) else [],
        },
    }


def _require_openai():
    if not settings.openai_api_key:
        raise HTTPException(
            status_code=400,
            detail="OPENAI_API_KEY is not configured on the server.",
        )
