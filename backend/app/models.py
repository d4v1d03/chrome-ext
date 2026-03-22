from pydantic import BaseModel
from typing import Optional


class PageData(BaseModel):
    url: str
    title: str
    html: str
    text: str
    timestamp: str
    html_size: int = 0


class SaveRequest(BaseModel):
    mode: str  # "full" | "ai_summary"
    page: PageData


class SaveResponse(BaseModel):
    job_id: str
    status: str
    message: str


class JobStatus(BaseModel):
    job_id: str
    status: str  # queued | processing | complete | failed
    step: Optional[str] = None
    cid: Optional[str] = None
    mode: Optional[str] = None
    summary: Optional[dict] = None
    error: Optional[str] = None
