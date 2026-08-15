"""WebSocket endpoints streaming live job progress.

Analysis jobs and bulk import jobs are streamed the same way - subscribe first,
send a DB snapshot, forward pub/sub frames until a terminal status - so the two
routes share `_stream_job_progress` and differ only in their Redis channel and
in how a snapshot frame is built. The frames themselves stay job-specific
(accuracies for analysis, counters for imports).
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable

import redis.asyncio as aioredis
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.config import settings
from app.db import SessionLocal
from app.models.analysis_job import AnalysisJob
from app.models.import_job import ImportJob
from app.routers.games import parse_uuid

logger = logging.getLogger(__name__)

router = APIRouter(tags=["ws"])

TERMINAL_STATUSES = {"completed", "failed"}


def _analysis_snapshot(job_id: str) -> dict | None:
    """Current DB state of an analysis job, shaped like its progress messages."""
    session = SessionLocal()
    try:
        job = session.get(AnalysisJob, parse_uuid(job_id, "job_id"))
        if job is None:
            return None
        return {
            "job_id": str(job.id),
            "status": job.status.value,
            "progress_pct": job.progress_pct,
            "white_accuracy": job.white_accuracy,
            "black_accuracy": job.black_accuracy,
            "error": job.error_message,
        }
    finally:
        session.close()


def _import_snapshot(job_id: str) -> dict | None:
    """Current DB state of an import job, shaped like its progress messages."""
    session = SessionLocal()
    try:
        job = session.get(ImportJob, parse_uuid(job_id, "job_id"))
        if job is None:
            return None
        return {
            "job_id": str(job.id),
            "status": job.status.value,
            "progress_pct": job.progress_pct,
            "games_found": job.games_found,
            "games_imported": job.games_imported,
            "games_skipped": job.games_skipped,
            "error": job.error_message,
        }
    finally:
        session.close()


@router.websocket("/ws/analysis/{job_id}")
async def analysis_progress(websocket: WebSocket, job_id: str) -> None:
    await _stream_job_progress(
        websocket,
        job_id=job_id,
        channel=f"analysis:{job_id}",
        snapshot=_analysis_snapshot,
        not_found_message="Analysis job not found.",
    )


@router.websocket("/ws/import/{job_id}")
async def import_progress(websocket: WebSocket, job_id: str) -> None:
    await _stream_job_progress(
        websocket,
        job_id=job_id,
        channel=f"import:{job_id}",
        snapshot=_import_snapshot,
        not_found_message="Import job not found.",
    )


async def _stream_job_progress(
    websocket: WebSocket,
    *,
    job_id: str,
    channel: str,
    snapshot: Callable[[str], dict | None],
    not_found_message: str,
) -> None:
    await websocket.accept()

    client = aioredis.Redis.from_url(settings.REDIS_URL)
    pubsub = client.pubsub()

    try:
        # Subscribe *before* reading the DB so no message published between the
        # snapshot and the subscription is lost.
        await pubsub.subscribe(channel)

        try:
            initial = snapshot(job_id)
        except Exception:  # noqa: BLE001 - bad UUID or DB hiccup
            logger.warning("Could not load job %s for websocket", job_id, exc_info=True)
            initial = None

        if initial is None:
            await websocket.send_json(
                {
                    "error": "NOT_FOUND",
                    "message": not_found_message,
                    "detail": {"job_id": job_id},
                }
            )
            await websocket.close()
            return

        await websocket.send_json(initial)
        if initial.get("status") in TERMINAL_STATUSES:
            await websocket.close()
            return

        async for message in pubsub.listen():
            if message.get("type") != "message":
                continue

            payload = _decode(message.get("data"))
            if payload is None:
                continue

            await websocket.send_json(payload)
            if payload.get("status") in TERMINAL_STATUSES:
                break

        await websocket.close()

    except WebSocketDisconnect:
        logger.debug("Websocket client disconnected from job %s", job_id)
    except Exception:  # noqa: BLE001
        logger.exception("Websocket error for job %s", job_id)
    finally:
        try:
            await pubsub.unsubscribe(channel)
            await pubsub.aclose()
        except Exception:  # noqa: BLE001
            pass
        try:
            await client.aclose()
        except Exception:  # noqa: BLE001
            pass


def _decode(raw: object) -> dict | None:
    if raw is None:
        return None
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8", errors="replace")
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError):
        return None
    return payload if isinstance(payload, dict) else None
