"""Daily background sync: pull each connected account's newest games without
the user needing to click "Sync latest games" on the dashboard themselves.

Runs on `celery beat`'s own schedule (see `celery_app.py`'s `beat_schedule`),
never from a user action - `beat` has to actually be running for this to
fire at all (a separate process from the worker; see `scripts/start-worker.sh`
and the README for how it's started).
"""

from __future__ import annotations

import logging

from sqlalchemy import select

from app.celery_app import celery_app
from app.db import SessionLocal
from app.models.account_connection import AccountConnection
from app.models.analysis_job import JobStatus
from app.models.game import Game, GameSource
from app.models.import_job import ImportJob
from app.tasks.bulk_import import bulk_import

logger = logging.getLogger(__name__)


def _latest_played_at_ms(session, source: GameSource) -> int | None:
    """Epoch ms of the most recently *played* game already on file for this
    source, or `None` when there isn't one yet (a first-ever sync pulls
    `bulk_import`'s own default lookback instead).

    Mirrors `DashboardPage.tsx`'s own `startNextSync` exactly - "only pull
    what's newer than the most recent game we already have for this
    source" - so a scheduled sync never re-walks a connected account's
    entire archive history, the same reason the manual button doesn't.
    """
    game = session.execute(
        select(Game)
        .where(Game.source == source)
        .order_by(Game.played_at.desc().nullslast(), Game.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    if game is None:
        return None
    when = game.played_at or game.created_at
    return int(when.timestamp() * 1000)


def build_sync_jobs(session, connections: list[AccountConnection]) -> list[ImportJob]:
    """One unsaved `ImportJob` per connection, `since_ms` already resolved -
    split out from the task below so it's testable against a real (rolled-
    back) database session directly, the same way `test_bulk_import.py`'s
    `TestImportDedup` tests `game_service` functions rather than the
    `bulk_import` task wrapper itself. Never touches the session beyond
    reading from it - the caller owns add/commit and the actual `.delay()`.
    """
    return [
        ImportJob(
            source=connection.source,
            username=connection.username,
            since_ms=_latest_played_at_ms(session, connection.source),
            status=JobStatus.pending,
            progress_pct=0,
            games_found=0,
            games_imported=0,
            games_skipped=0,
        )
        for connection in connections
    ]


@celery_app.task(name="sync_all_connections")
def sync_all_connections() -> dict:
    """Queues one `bulk_import` job per connected account - the scheduled
    equivalent of the dashboard's "Sync latest games" button, minus the
    button. An account with nothing connected queues nothing; this is a
    routine no-op then, not an error.
    """
    session = SessionLocal()
    try:
        connections = session.scalars(select(AccountConnection)).all()
        jobs = build_sync_jobs(session, connections)

        queued = []
        for job in jobs:
            session.add(job)
            session.commit()
            session.refresh(job)

            async_result = bulk_import.delay(str(job.id))
            job.celery_task_id = async_result.id
            session.commit()

            queued.append(
                {"source": job.source.value, "username": job.username, "job_id": str(job.id)}
            )

        logger.info("Scheduled sync queued %d import job(s).", len(queued))
        return {"queued": queued}
    finally:
        session.close()
