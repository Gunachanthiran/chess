"""Celery application.

Run the worker with:

    celery -A app.celery_app worker --loglevel=info --concurrency=2

Concurrency matters here: a single analysis job runs for minutes, so a
serialised worker leaves every queued job waiting behind the one in front of
it. Each task run is self-contained - its own DB session, its own Stockfish
subprocess, its own Redis client - so several can run side by side. Keep the
level low all the same: every concurrent job spawns a Stockfish process that
will happily eat a core.
"""

from celery import Celery
from celery.signals import worker_process_init

from app.config import settings

celery_app = Celery(
    "chessscope",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=["app.tasks.analyze_game", "app.tasks.bulk_import"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    worker_prefetch_multiplier=1,
)


@worker_process_init.connect
def _reset_db_connections(**_kwargs) -> None:
    """Give every forked worker child its own database connections.

    The prefork pool forks after `app.db` has been imported, so children inherit
    the parent's connection pool. Sockets cannot be shared across processes;
    disposing the pool here drops the inherited handles so each child opens its
    own. Harmless under non-forking pools, where the pool is empty anyway.
    """
    from app.db import engine

    engine.dispose()
