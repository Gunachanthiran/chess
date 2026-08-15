"""The Celery task that bulk-imports a player's games from Lichess or Chess.com.

Structurally a sibling of `analyze_game`: its own session, its own Redis client,
status driven pending -> running -> completed/failed, progress published to
`import:{job_id}` for the `/ws/import/{job_id}` websocket.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import UTC, datetime

import redis

from app.celery_app import celery_app
from app.config import settings
from app.db import SessionLocal
from app.errors import ChessScopeError, NotFoundError, ValidationError
from app.models.analysis_job import JobStatus
from app.models.game import GameSource
from app.models.import_job import ImportJob
from app.services import chesscom_client, game_service, lichess_client, pgn_service

logger = logging.getLogger(__name__)

# Progress is published at most this many times over a run, plus the terminal
# frame - a 500-game import should not emit 500 pub/sub messages.
MAX_PROGRESS_FRAMES = 20


def _channel(job_id: str) -> str:
    return f"import:{job_id}"


def _publish(client: redis.Redis, job_id: str, payload: dict) -> None:
    """Best-effort progress publish; a dead Redis must not fail the import."""
    try:
        client.publish(_channel(job_id), json.dumps(payload))
    except Exception:  # noqa: BLE001
        logger.warning("Failed to publish progress for import %s", job_id, exc_info=True)


def _progress_payload(job_id: str, job: ImportJob, status: str) -> dict:
    return {
        "job_id": job_id,
        "status": status,
        "progress_pct": job.progress_pct,
        "games_found": job.games_found,
        "games_imported": job.games_imported,
        "games_skipped": job.games_skipped,
        "error": job.error_message,
    }


def _fetch_pgns(job: ImportJob) -> list[str]:
    """The individual PGNs to import, from whichever site the job names."""
    if job.source is GameSource.lichess:
        blob = lichess_client.fetch_games_bulk_pgn(
            job.username,
            since_ms=job.since_ms,
            until_ms=job.until_ms,
            max_games=job.max_games,
        )
        return pgn_service.split_pgn_games(blob)[: job.max_games]

    if job.source is GameSource.chess_com:
        pgns = chesscom_client.fetch_games_bulk(
            job.username,
            since_ms=job.since_ms,
            until_ms=job.until_ms,
            max_games=job.max_games,
        )
        # Chess.com hands back one PGN per game already, but each is re-parsed
        # through the same splitter so both sources yield identical shapes.
        cleaned: list[str] = []
        for pgn in pgns:
            cleaned.extend(pgn_service.split_pgn_games(pgn))
        return cleaned[: job.max_games]

    raise ValidationError(
        f"Source '{job.source.value}' cannot be bulk imported.",
        {"source": job.source.value},
    )


def _external_ids(source: GameSource, pgn: str) -> tuple[str | None, str | None]:
    """`(lichess_game_id, chess_com_game_id)` for one PGN."""
    if source is GameSource.lichess:
        return pgn_service.lichess_game_id_from_pgn(pgn), None
    if source is GameSource.chess_com:
        return None, pgn_service.chess_com_game_id_from_pgn(pgn)
    return None, None


@celery_app.task(name="bulk_import")
def bulk_import(job_id: str) -> dict:
    """Fetch a player's games from an external site and store the new ones."""
    session = SessionLocal()
    redis_client = redis.Redis.from_url(settings.REDIS_URL)

    try:
        job = session.get(ImportJob, _as_uuid(job_id))
        if job is None:
            raise NotFoundError(f"Import job {job_id} not found.")

        job.status = JobStatus.running
        job.started_at = datetime.now(UTC)
        job.progress_pct = 0
        job.games_found = 0
        job.games_imported = 0
        job.games_skipped = 0
        job.error_message = None
        session.commit()

        _publish(redis_client, job_id, _progress_payload(job_id, job, "running"))

        pgns = _fetch_pgns(job)
        total = len(pgns)
        job.games_found = total
        session.commit()
        _publish(redis_client, job_id, _progress_payload(job_id, job, "running"))

        publish_every = max(1, total // MAX_PROGRESS_FRAMES)

        for index, pgn in enumerate(pgns, start=1):
            lichess_game_id, chess_com_game_id = _external_ids(job.source, pgn)
            try:
                _, created = game_service.import_game_from_pgn(
                    session,
                    pgn,
                    job.source,
                    lichess_game_id=lichess_game_id,
                    chess_com_game_id=chess_com_game_id,
                    imported_username=job.username,
                )
            except ChessScopeError as exc:
                # One unimportable game (illegal moves, no moves, ...) is
                # skipped; the rest of the batch still lands.
                session.rollback()
                logger.warning(
                    "Skipping game %s/%s in import %s: %s", index, total, job_id, exc
                )
                job.games_skipped += 1
            else:
                if created:
                    job.games_imported += 1
                else:
                    job.games_skipped += 1

            job.progress_pct = round(100 * index / total) if total else 100
            session.commit()

            if index % publish_every == 0:
                _publish(
                    redis_client, job_id, _progress_payload(job_id, job, "running")
                )

        job.status = JobStatus.completed
        job.progress_pct = 100
        job.completed_at = datetime.now(UTC)
        session.commit()

        payload = _progress_payload(job_id, job, "completed")
        _publish(redis_client, job_id, payload)
        return payload

    except Exception as exc:  # noqa: BLE001 - job status must always be recorded
        logger.exception("Import job %s failed", job_id)
        session.rollback()
        payload = {"job_id": job_id, "status": "failed", "error": str(exc)}
        try:
            job = session.get(ImportJob, _as_uuid(job_id))
            if job is not None:
                job.status = JobStatus.failed
                job.error_message = str(exc)
                job.completed_at = datetime.now(UTC)
                session.commit()
                payload = _progress_payload(job_id, job, "failed")
        except Exception:  # noqa: BLE001
            session.rollback()
            logger.exception("Could not mark import job %s as failed", job_id)

        _publish(redis_client, job_id, payload)
        raise

    finally:
        session.close()
        try:
            redis_client.close()
        except Exception:  # noqa: BLE001
            pass


def _as_uuid(value: str) -> uuid.UUID:
    return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))
