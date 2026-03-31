import asyncio
import json
from datetime import datetime, timezone

from celery import Celery

from app.config import settings
from app.crypto import encrypt
from app.storage import get_storage

celery_app = Celery(
    "filimpact",
    broker=settings.redis_url,
    backend=settings.redis_url,
)
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    result_expires=86_400,
    task_track_started=True,
    worker_prefetch_multiplier=1,
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@celery_app.task(bind=True, name="tasks.process_full_save")
def process_full_save(self, job_id: str, page_data: dict, encryption_secret: str):
    try:
        self.update_state(state="PROGRESS", meta={"step": "packaging"})
        archive = {
            "job_id": job_id,
            "mode": "full",
            "metadata": {
                "url": page_data["url"],
                "title": page_data["title"],
                "timestamp": page_data["timestamp"],
                "html_size": page_data.get("html_size", 0),
                "archived_at": _now(),
            },
            "content": {
                "html": page_data["html"],
                "text": page_data["text"],
            },
        }
        raw = json.dumps(archive, ensure_ascii=False).encode("utf-8")

        self.update_state(state="PROGRESS", meta={"step": "encrypting"})
        encrypted = encrypt(raw, encryption_secret)

        self.update_state(state="PROGRESS", meta={"step": "storing"})
        cid = get_storage().store(encrypted, {
            "job_id": job_id,
            "url": page_data["url"],
            "title": page_data["title"],
            "mode": "full",
        })

        return {
            "status": "complete",
            "cid":    cid,
            "mode":   "full",
            "url":    page_data["url"],
            "title":  page_data["title"],
        }
    except Exception as exc:
        raise self.retry(exc=exc, max_retries=0)


@celery_app.task(bind=True, name="tasks.process_ai_summary")
def process_ai_summary(
    self, job_id: str, page_data: dict, encryption_secret: str, openai_api_key: str
):
    try:
        from app.ai import extract_summary, generate_embeddings
        from app.rag import get_store

        self.update_state(state="PROGRESS", meta={"step": "ai_extraction"})
        summary = asyncio.run(
            extract_summary(
                html=page_data["html"],
                text=page_data["text"],
                url=page_data["url"],
                title=page_data["title"],
                api_key=openai_api_key,
            )
        )

        self.update_state(state="PROGRESS", meta={"step": "embedding"})
        embeddings = asyncio.run(
            generate_embeddings(text=page_data["text"], api_key=openai_api_key)
        )

        self.update_state(state="PROGRESS", meta={"step": "packaging"})
        archive = {
            "job_id": job_id,
            "mode": "ai_summary",
            "metadata": {
                "url": page_data["url"],
                "title": page_data["title"],
                "timestamp": page_data["timestamp"],
                "archived_at": _now(),
            },
            "summary": summary,
            "embeddings": embeddings,
        }
        raw = json.dumps(archive, ensure_ascii=False).encode("utf-8")

        self.update_state(state="PROGRESS", meta={"step": "encrypting"})
        encrypted = encrypt(raw, encryption_secret)

        self.update_state(state="PROGRESS", meta={"step": "storing"})
        cid = get_storage().store(encrypted, {
            "job_id": job_id,
            "url": page_data["url"],
            "title": page_data["title"],
            "mode": "ai_summary",
        })

        get_store().add(
            job_id,
            embeddings,
            {
                "url":            page_data["url"],
                "title":          page_data["title"],
                "mode":           "ai_summary",
                "topics":         ", ".join(summary.get("topics", [])),
                "summary_snippet": (summary.get("summary", "") or "")[:200],
            },
        )

        return {
            "status":  "complete",
            "cid":     cid,
            "mode":    "ai_summary",
            "summary": summary,
            "url":     page_data["url"],
            "title":   page_data["title"],
        }
    except Exception as exc:
        raise self.retry(exc=exc, max_retries=0)


@celery_app.task(bind=True, name="tasks.process_agentic_pipeline")
def process_agentic_pipeline(
    self, job_id: str, page_data: dict, encryption_secret: str, openai_api_key: str
):
    try:
        from app.agents import extractor, validator, scorer, generator
        from app.ai import generate_embeddings
        from app.rag import get_store

        store = get_store()

        self.update_state(state="PROGRESS", meta={"step": "agent_extracting"})
        extracted = asyncio.run(extractor.run(page_data, api_key=openai_api_key))

        self.update_state(state="PROGRESS", meta={"step": "agent_rag_lookup"})
        query_embedding = asyncio.run(
            generate_embeddings(text=page_data["text"], api_key=openai_api_key)
        )
        related_pages = store.search(query_embedding, top_k=3)

        self.update_state(state="PROGRESS", meta={"step": "agent_validating"})
        validated = asyncio.run(
            validator.run(extracted, related_pages, api_key=openai_api_key)
        )

        self.update_state(state="PROGRESS", meta={"step": "agent_scoring"})
        scored = asyncio.run(
            scorer.run(extracted, validated, related_pages, api_key=openai_api_key)
        )

        # Store partial first so the CID can be passed to Agent 4 as evidence
        self.update_state(state="PROGRESS", meta={"step": "storing"})
        partial_archive = {
            "job_id": job_id,
            "mode": "agentic",
            "metadata": {
                "url": page_data["url"],
                "title": page_data["title"],
                "timestamp": page_data["timestamp"],
                "archived_at": _now(),
            },
            "extracted": extracted,
            "validated": validated,
            "scored": scored,
        }
        raw_partial = json.dumps(partial_archive, ensure_ascii=False).encode("utf-8")
        enc_partial  = encrypt(raw_partial, encryption_secret)
        cid = get_storage().store(enc_partial, {
            "job_id": job_id,
            "url": page_data["url"],
            "title": page_data["title"],
            "mode": "agentic",
        })

        self.update_state(state="PROGRESS", meta={"step": "agent_generating"})
        generated = asyncio.run(
            generator.run(extracted, validated, scored, evidence_cids=[cid], api_key=openai_api_key)
        )

        self.update_state(state="PROGRESS", meta={"step": "encrypting_final"})
        final_archive = {
            **partial_archive,
            "generated": generated,
            "hypercert_payload": generated.get("hypercert_payload"),
            "cid": cid,
        }
        raw_final = json.dumps(final_archive, ensure_ascii=False).encode("utf-8")
        enc_final  = encrypt(raw_final, encryption_secret)
        final_cid  = get_storage().store(enc_final, {
            "job_id": job_id,
            "url": page_data["url"],
            "title": page_data["title"],
            "mode": "agentic",
            "final": True,
        })

        get_store().add(
            job_id,
            query_embedding,
            {
                "url":            page_data["url"],
                "title":          page_data["title"],
                "mode":           "agentic",
                "topics":         ", ".join(generated.get("topics", [])),
                "summary_snippet": (generated.get("summary", "") or "")[:200],
                "impact_score":   scored.get("impact_score", 0),
                "impact_type":    scored.get("impact_type", "other"),
                "cid":            final_cid,
            },
        )

        return {
            "status":    "complete",
            "cid":       final_cid,
            "mode":      "agentic",
            "summary":   generated.get("summary"),
            "key_points": generated.get("key_points", []),
            "topics":    generated.get("topics", []),
            "scores": {
                "impact":      scored.get("impact_score"),
                "confidence":  scored.get("confidence_score"),
                "novelty":     scored.get("novelty_score"),
                "credibility": validated.get("credibility_score"),
            },
            "impact_type":       scored.get("impact_type"),
            "hypercert_payload": generated.get("hypercert_payload"),
        }

    except Exception as exc:
        raise self.retry(exc=exc, max_retries=0)
