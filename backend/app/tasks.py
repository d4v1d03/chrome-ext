"""Celery task definitions for async page processing."""
import asyncio
import json
from datetime import datetime, timezone

from celery import Celery

from app.config import settings
from app.crypto import encrypt
from app.storage import get_storage

celery_app = Celery(
    "private_web_memory",
    broker=settings.redis_url,
    backend=settings.redis_url,
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    result_expires=86_400,  # 24 hours
    task_track_started=True,
    worker_prefetch_multiplier=1,
)


def _archived_at() -> str:
    return datetime.now(timezone.utc).isoformat()


@celery_app.task(bind=True, name="tasks.process_full_save")
def process_full_save(self, job_id: str, page_data: dict, encryption_secret: str):
    """Encrypt the full HTML archive and write to storage."""
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
                "archived_at": _archived_at(),
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
        storage = get_storage()
        cid = storage.store(
            encrypted,
            {
                "job_id": job_id,
                "url": page_data["url"],
                "title": page_data["title"],
                "mode": "full",
            },
        )

        return {"status": "complete", "cid": cid, "mode": "full"}

    except Exception as exc:
        raise self.retry(exc=exc, max_retries=0)


@celery_app.task(bind=True, name="tasks.process_ai_summary")
def process_ai_summary(
    self,
    job_id: str,
    page_data: dict,
    encryption_secret: str,
    openai_api_key: str,
):
    """Run AI extraction, embed, encrypt, and store a compressed summary."""
    try:
        from app.ai import extract_summary, generate_embeddings

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
                "archived_at": _archived_at(),
            },
            "summary": summary,
            "embeddings": embeddings,
        }
        raw = json.dumps(archive, ensure_ascii=False).encode("utf-8")

        self.update_state(state="PROGRESS", meta={"step": "encrypting"})
        encrypted = encrypt(raw, encryption_secret)

        self.update_state(state="PROGRESS", meta={"step": "storing"})
        storage = get_storage()
        cid = storage.store(
            encrypted,
            {
                "job_id": job_id,
                "url": page_data["url"],
                "title": page_data["title"],
                "mode": "ai_summary",
            },
        )

        return {
            "status": "complete",
            "cid": cid,
            "mode": "ai_summary",
            "summary": summary,
        }

    except Exception as exc:
        raise self.retry(exc=exc, max_retries=0)
