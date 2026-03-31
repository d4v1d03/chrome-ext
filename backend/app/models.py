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
    mode: str  # "full" | "ai_summary" | "agentic"
    page: PageData


class SaveResponse(BaseModel):
    job_id: str
    status: str
    message: str


class ScoresData(BaseModel):
    impact:      Optional[int] = None
    confidence:  Optional[int] = None
    novelty:     Optional[int] = None
    credibility: Optional[int] = None


class JobStatus(BaseModel):
    job_id: str
    status: str          # queued | processing | complete | failed
    step: Optional[str] = None
    cid:  Optional[str] = None
    mode: Optional[str] = None
    # AI Summary fields
    summary:    Optional[dict] = None
    # Agentic pipeline fields
    key_points:      Optional[list] = None
    topics:          Optional[list] = None
    scores:          Optional[ScoresData] = None
    impact_type:     Optional[str] = None
    hypercert_payload: Optional[dict] = None
    error: Optional[str] = None


class SearchResult(BaseModel):
    job_id: str
    score:  float
    url:    Optional[str] = None
    title:  Optional[str] = None
    mode:   Optional[str] = None
    topics: Optional[str] = None
    summary_snippet: Optional[str] = None
    impact_score:    Optional[int] = None
    impact_type:     Optional[str] = None
    cid:             Optional[str] = None


class SearchResponse(BaseModel):
    query:   str
    results: list[SearchResult]
    total:   int


class RelatedResponse(BaseModel):
    job_id:  str
    related: list[SearchResult]


class HypercertResponse(BaseModel):
    job_id:      str
    hypercert:   dict
    simulation:  Optional[dict] = None
    generated_at: str


class PublishResponse(BaseModel):
    job_id:          str
    activity_uri:    str
    activity_cid:    str
    did:             str
    pds_url:         str
    attachment_uris: list[str]
    measurement_uris: list[str]
    evaluation_uri:  Optional[str] = None
    published_at:    str
    explorer_url:    Optional[str] = None
