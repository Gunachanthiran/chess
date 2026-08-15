"""The single-user "which accounts are connected" state, and the bridge from
a fresh connection to an automatic full-history import.

No `users` table: this app is self-hosted and single-user (see the login-flow
plan), so `account_connections` has at most one row per source rather than one
per person. Login therefore reduces to "does a row exist for this source."
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.account_connection import AccountConnection
from app.models.analysis_job import JobStatus
from app.models.game import GameSource
from app.models.import_job import ImportJob
from app.schemas.import_job import MAX_GAMES_CEILING
from app.tasks.bulk_import import bulk_import

CONNECTABLE_SOURCES = {GameSource.lichess, GameSource.chess_com}


def get_status(db: Session) -> dict[GameSource, AccountConnection]:
    """`{source: connection}` for whichever of `CONNECTABLE_SOURCES` exist."""
    rows = db.scalars(
        select(AccountConnection).where(
            AccountConnection.source.in_(CONNECTABLE_SOURCES)
        )
    ).all()
    return {row.source: row for row in rows}


def is_any_connected(db: Session) -> bool:
    return len(get_status(db)) > 0


def upsert_connection(db: Session, source: GameSource, username: str) -> AccountConnection:
    """Insert or replace the singleton row for `source`.

    Reconnecting overwrites rather than accumulating rows — `source` is unique
    (migration 0004), so this is a plain find-then-set, not an upsert at the
    SQL level.
    """
    existing = db.scalar(
        select(AccountConnection).where(AccountConnection.source == source)
    )
    if existing is not None:
        existing.username = username
        db.commit()
        db.refresh(existing)
        return existing

    connection = AccountConnection(source=source, username=username)
    db.add(connection)
    db.commit()
    db.refresh(connection)
    return connection


def remove_connection(db: Session, source: GameSource) -> None:
    existing = db.scalar(
        select(AccountConnection).where(AccountConnection.source == source)
    )
    if existing is not None:
        db.delete(existing)
        db.commit()


def trigger_bulk_import(
    db: Session, source: GameSource, username: str, *, max_games: int = MAX_GAMES_CEILING
) -> ImportJob:
    """Queues the same kind of import `routers/imports.py::create_import`
    does for the manual Bulk Import form — connecting an account is meant to
    retrieve the *full* history, so this defaults to the server's own import
    cap rather than the form's smaller `50`-game default.
    """
    job = ImportJob(
        source=source,
        username=username,
        max_games=max_games,
        status=JobStatus.pending,
        progress_pct=0,
        games_found=0,
        games_imported=0,
        games_skipped=0,
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    async_result = bulk_import.delay(str(job.id))
    job.celery_task_id = async_result.id
    db.commit()
    db.refresh(job)

    return job
