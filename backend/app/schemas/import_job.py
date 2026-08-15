"""Pydantic schemas for bulk import jobs."""

import uuid
from datetime import datetime

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator

from app.models.analysis_job import JobStatus
from app.models.game import GameSource

DEFAULT_MAX_GAMES = 100
MAX_GAMES_CEILING = 500

IMPORTABLE_SOURCES = {GameSource.lichess, GameSource.chess_com}


class CreateImportRequest(BaseModel):
    """`{source, username, since?, until?, max_games?}`.

    `since`/`until` are epoch **milliseconds**, the unit both external clients
    take; they are also accepted under their storage names `since_ms`/`until_ms`.
    """

    source: GameSource
    username: str = Field(min_length=1, max_length=255)
    since_ms: int | None = Field(
        default=None,
        ge=0,
        validation_alias=AliasChoices("since_ms", "since"),
    )
    until_ms: int | None = Field(
        default=None,
        ge=0,
        validation_alias=AliasChoices("until_ms", "until"),
    )
    max_games: int = Field(
        default=DEFAULT_MAX_GAMES, ge=1, le=MAX_GAMES_CEILING
    )

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("source")
    @classmethod
    def _source_must_be_importable(cls, value: GameSource) -> GameSource:
        if value not in IMPORTABLE_SOURCES:
            allowed = ", ".join(sorted(source.value for source in IMPORTABLE_SOURCES))
            raise ValueError(f"'source' must be one of: {allowed}.")
        return value

    @field_validator("username")
    @classmethod
    def _username_must_not_be_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("'username' must not be blank.")
        return stripped


class ImportJobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    source: GameSource
    username: str
    since_ms: int | None
    until_ms: int | None
    max_games: int
    status: JobStatus
    progress_pct: int
    celery_task_id: str | None
    games_found: int
    games_imported: int
    games_skipped: int
    error_message: str | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None


class ImportJobResponse(BaseModel):
    job: ImportJobOut
