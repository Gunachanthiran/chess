"""Game upload and retrieval."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.errors import NotFoundError, ValidationError
from app.models.analysis_job import AnalysisJob, JobStatus
from app.models.game import Game, GameSource
from app.schemas.game import (
    GameListResponse,
    GameOut,
    GameResponse,
    PGNUploadRequest,
)

# `create_game_from_pgn` moved to app.services.game_service (the bulk import task
# needs it too); re-exported here so existing callers keep working unchanged.
from app.services.game_service import create_game_from_pgn

router = APIRouter(prefix="/games", tags=["games"])

__all__ = ["router", "create_game_from_pgn", "parse_uuid"]


def parse_uuid(value: str, field: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except (ValueError, AttributeError, TypeError) as exc:
        raise ValidationError(
            f"'{field}' must be a valid UUID.", {field: value}
        ) from exc


@router.post("/upload", response_model=GameResponse, status_code=status.HTTP_201_CREATED)
def upload_game(payload: PGNUploadRequest, db: Session = Depends(get_db)) -> GameResponse:
    game = create_game_from_pgn(db, payload.pgn, GameSource.upload)
    return GameResponse(game=GameOut.model_validate(game))


def _latest_completed_job_id_subquery():
    """Correlated scalar subquery: the most recently completed `AnalysisJob`
    id for a `Game`, or NULL. One SQL query total (not N+1) since it runs as
    part of the main SELECT's plan rather than as a separate round trip per
    row."""
    return (
        select(AnalysisJob.id)
        .where(AnalysisJob.game_id == Game.id, AnalysisJob.status == JobStatus.completed)
        .order_by(AnalysisJob.completed_at.desc(), AnalysisJob.created_at.desc())
        .limit(1)
        .correlate(Game)
        .scalar_subquery()
    )


def _game_out(game: Game, latest_completed_job_id) -> GameOut:
    return GameOut.model_validate(game).model_copy(
        update={"latest_completed_job_id": latest_completed_job_id}
    )


@router.get("", response_model=GameListResponse)
def list_games(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    source: GameSource | None = Query(default=None),
    db: Session = Depends(get_db),
) -> GameListResponse:
    base_query = select(Game)
    count_query = select(func.count()).select_from(Game)
    if source is not None:
        base_query = base_query.where(Game.source == source)
        count_query = count_query.where(Game.source == source)

    total = db.scalar(count_query) or 0
    rows = db.execute(
        base_query.add_columns(
            _latest_completed_job_id_subquery().label("latest_completed_job_id")
        )
        # Most-recently-*played* first, not most-recently-*imported*: a bulk
        # import fetches newest-game-first but inserts them in that same
        # order, so the newest actual game is the *first* row written and
        # therefore gets the *earliest* `created_at` of the batch — sorting
        # by `created_at` alone showed the oldest games first, backwards from
        # what "recent" should mean. `created_at` stays as the tiebreak for
        # the (typically upload-only) rows with no parseable game date.
        .order_by(Game.played_at.desc().nullslast(), Game.created_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()

    return GameListResponse(
        games=[_game_out(game, latest_completed_job_id) for game, latest_completed_job_id in rows],
        total=total,
    )


@router.get("/{game_id}", response_model=GameResponse)
def get_game(game_id: str, db: Session = Depends(get_db)) -> GameResponse:
    game = db.get(Game, parse_uuid(game_id, "game_id"))
    if game is None:
        raise NotFoundError("Game not found.", {"game_id": game_id})

    latest_completed_job_id = db.scalar(
        select(AnalysisJob.id)
        .where(AnalysisJob.game_id == game.id, AnalysisJob.status == JobStatus.completed)
        .order_by(AnalysisJob.completed_at.desc(), AnalysisJob.created_at.desc())
        .limit(1)
    )
    return GameResponse(game=_game_out(game, latest_completed_job_id))
