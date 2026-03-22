"""Private Web Memory — FastAPI backend."""
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.models import JobStatus, SaveRequest, SaveResponse
from app.tasks import celery_app, process_ai_summary, process_full_save

app = FastAPI(
    title="Private Web Memory API",
    version="1.0.0",
    description="Backend for the Private Web Memory Chrome extension.",
)

app.add_middleware(
    CORSMiddleware,
    # Chrome extensions send requests from chrome-extension:// origins;
    # allow_origins="*" is required for them to reach this API.
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Auth ──────────────────────────────────────────────────────────────────────

def verify_api_key(x_api_key: Optional[str] = Header(None)) -> None:
    if settings.backend_api_key and x_api_key != settings.backend_api_key:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health", tags=["meta"])
async def health():
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}


@app.post("/api/save", response_model=SaveResponse, tags=["archive"])
async def save_page(
    request: SaveRequest,
    _: None = Depends(verify_api_key),
):
    """Queue a page for async processing.

    Returns a ``job_id`` immediately; poll ``/api/status/{job_id}`` for
    progress and the final CID.
    """
    job_id = str(uuid.uuid4())
    page_data = request.page.model_dump()

    if request.mode == "full":
        process_full_save.apply_async(
            args=[job_id, page_data, settings.encryption_secret],
            task_id=job_id,
        )
    elif request.mode == "ai_summary":
        if not settings.openai_api_key:
            raise HTTPException(
                status_code=400,
                detail="OpenAI API key not configured on the server. "
                       "Set OPENAI_API_KEY in your .env file.",
            )
        process_ai_summary.apply_async(
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
    """Return the current status of an async save job."""
    result = celery_app.AsyncResult(job_id)
    state = result.state

    if state == "PENDING":
        return JobStatus(job_id=job_id, status="queued")

    if state == "STARTED":
        return JobStatus(job_id=job_id, status="processing")

    if state == "PROGRESS":
        meta = result.info or {}
        return JobStatus(job_id=job_id, status="processing", step=meta.get("step"))

    if state == "SUCCESS":
        data = result.result or {}
        return JobStatus(
            job_id=job_id,
            status="complete",
            cid=data.get("cid"),
            mode=data.get("mode"),
            summary=data.get("summary"),
        )

    if state == "FAILURE":
        error = str(result.info) if result.info else "Unknown error"
        return JobStatus(job_id=job_id, status="failed", error=error)

    return JobStatus(job_id=job_id, status=state.lower())
