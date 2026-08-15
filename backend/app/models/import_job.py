"""The `import_jobs` table: one row per bulk game import from an external site.

Two deliberate reuses:

* `status` reuses `JobStatus` (pending/running/completed/failed) from
  `analysis_job` - the lifecycle is identical, so a second identical enum type
  would only be a duplicate to keep in sync.
* `source` reuses `GameSource` rather than declaring a narrower `ImportSource`,
  so the value stored here is exactly the value written onto the imported
  `games.source` column. `upload` is not importable and is rejected by the
  request schema (`app/schemas/import_job.py`) rather than by a second enum.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Enum, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.analysis_job import JobStatus
from app.models.game import GameSource


class ImportJob(Base):
    __tablename__ = "import_jobs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    source: Mapped[GameSource] = mapped_column(
        Enum(
            GameSource,
            name="game_source",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
    )
    username: Mapped[str] = mapped_column(String(255), nullable=False, index=True)

    # Epoch milliseconds: the unit both the Lichess and Chess.com clients take.
    since_ms: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    until_ms: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    max_games: Mapped[int] = mapped_column(Integer, nullable=False, default=100)

    status: Mapped[JobStatus] = mapped_column(
        Enum(
            JobStatus,
            name="job_status",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
        default=JobStatus.pending,
    )
    progress_pct: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    celery_task_id: Mapped[str | None] = mapped_column(String(255), nullable=True)

    games_found: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    games_imported: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    games_skipped: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
