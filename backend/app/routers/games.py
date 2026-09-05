"""Game upload and retrieval."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, defer

from app.db import get_db
from app.errors import NotFoundError, ValidationError
from app.models.analysis_job import AnalysisJob, JobStatus
from app.models.game import Game, GameSource
from app.schemas.game import (
    GameListResponse,
    GameOut,
    GameResponse,
    GameStatsOut,
    GameSummaryOut,
    OpeningPerformanceListResponse,
    OpeningPerformanceOut,
    PGNUploadRequest,
)

# `create_game_from_pgn` moved to app.services.game_service (the bulk import task
# needs it too); re-exported here so existing callers keep working unchanged.
from app.services.game_service import create_game_from_pgn
from app.services.game_stats import GameStatsRow, compute_stats
from app.services.opening_stats import OpeningStatsRow, compute_opening_performance

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


def _latest_completed_job_accuracy_subquery(side: str):
    """Correlated scalar subquery: `white_accuracy`/`black_accuracy` off the
    same latest-completed job `_latest_completed_job_id_subquery` finds —
    joining back to it by id rather than duplicating the ordering logic."""
    column = AnalysisJob.white_accuracy if side == "white" else AnalysisJob.black_accuracy
    return (
        select(column)
        .where(AnalysisJob.id == _latest_completed_job_id_subquery())
        .correlate(Game)
        .scalar_subquery()
    )


def _game_out(game: Game, latest_completed_job_id, white_accuracy=None, black_accuracy=None) -> GameOut:
    return GameOut.model_validate(game).model_copy(
        update={
            "latest_completed_job_id": latest_completed_job_id,
            "white_accuracy": white_accuracy,
            "black_accuracy": black_accuracy,
        }
    )


def _game_summary_out(
    game: Game, latest_completed_job_id, white_accuracy=None, black_accuracy=None
) -> GameSummaryOut:
    """Like `_game_out`, but for `GameSummaryOut` — critically, this never
    touches `game.pgn`, so it never triggers the deferred column's lazy
    load (see the `defer(Game.pgn)` in `list_games` below)."""
    return GameSummaryOut.model_validate(game).model_copy(
        update={
            "latest_completed_job_id": latest_completed_job_id,
            "white_accuracy": white_accuracy,
            "black_accuracy": black_accuracy,
        }
    )


@router.get("", response_model=GameListResponse)
def list_games(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    source: GameSource | None = Query(default=None),
    db: Session = Depends(get_db),
) -> GameListResponse:
    # `defer(Game.pgn)`: no page anywhere reads a listed game's PGN text, so
    # this saves real memory/bandwidth, not just JSON payload size — up to
    # `limit` (200) rows' worth of PGN text (a few KB each for a long game)
    # never gets fetched from Postgres or held in Python at all, rather than
    # being fetched and then discarded. Confirmed as a real contributor to
    # `chessscope-api` hitting its 512MB limit on Render's free tier.
    base_query = select(Game).options(defer(Game.pgn))
    count_query = select(func.count()).select_from(Game)
    if source is not None:
        base_query = base_query.where(Game.source == source)
        count_query = count_query.where(Game.source == source)

    total = db.scalar(count_query) or 0
    rows = db.execute(
        base_query.add_columns(
            _latest_completed_job_id_subquery().label("latest_completed_job_id"),
            _latest_completed_job_accuracy_subquery("white").label("white_accuracy"),
            _latest_completed_job_accuracy_subquery("black").label("black_accuracy"),
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
        games=[
            _game_summary_out(game, latest_completed_job_id, white_accuracy, black_accuracy)
            for game, latest_completed_job_id, white_accuracy, black_accuracy in rows
        ],
        total=total,
    )


@router.get("/stats", response_model=GameStatsOut)
def game_stats(db: Session = Depends(get_db)) -> GameStatsOut:
    """Dashboard stats widget: total/analysed counts, recent-form accuracy,
    current day streak. Registered *before* `/{game_id}` below - otherwise
    FastAPI would match "stats" as a `game_id` and fail UUID parsing.

    One query, `defer(Game.pgn)`'d for the same reason `list_games` does -
    every game gets pulled (the maths genuinely needs the whole history, see
    `game_stats.compute_stats`), so skipping the one large/unused column
    matters here more than anywhere else in this router.
    """
    rows = db.execute(
        select(Game)
        .options(defer(Game.pgn))
        .add_columns(
            _latest_completed_job_accuracy_subquery("white").label("white_accuracy"),
            _latest_completed_job_accuracy_subquery("black").label("black_accuracy"),
        )
    ).all()

    return compute_stats(
        [
            GameStatsRow(
                played_at=game.played_at,
                created_at=game.created_at,
                white_name=game.white_name,
                black_name=game.black_name,
                imported_username=game.imported_username,
                white_accuracy=white_accuracy,
                black_accuracy=black_accuracy,
            )
            for game, white_accuracy, black_accuracy in rows
        ]
    )


@router.get("/openings", response_model=OpeningPerformanceListResponse)
def opening_performance(db: Session = Depends(get_db)) -> OpeningPerformanceListResponse:
    """Every analysed game grouped by opening name, with your own side's
    win/loss/draw record and average accuracy - "which openings should I
    stop playing". Registered before `/{game_id}` for the same reason
    `/stats` is.

    Same one-query, `defer(Game.pgn)`'d shape as `/stats` above - the
    aggregation needs every game's result and opening, not a page of them.
    """
    rows = db.execute(
        select(Game)
        .options(defer(Game.pgn))
        .add_columns(
            _latest_completed_job_accuracy_subquery("white").label("white_accuracy"),
            _latest_completed_job_accuracy_subquery("black").label("black_accuracy"),
        )
    ).all()

    performances = compute_opening_performance(
        [
            OpeningStatsRow(
                opening_name=game.opening_name,
                eco=game.eco,
                result=game.result,
                white_name=game.white_name,
                black_name=game.black_name,
                imported_username=game.imported_username,
                white_accuracy=white_accuracy,
                black_accuracy=black_accuracy,
            )
            for game, white_accuracy, black_accuracy in rows
        ]
    )

    return OpeningPerformanceListResponse(
        openings=[
            OpeningPerformanceOut(
                opening_name=performance.opening_name,
                eco=performance.eco,
                games=performance.games,
                wins=performance.wins,
                losses=performance.losses,
                draws=performance.draws,
                score_pct=performance.score_pct,
                avg_accuracy=performance.avg_accuracy,
            )
            for performance in performances
        ]
    )


@router.get("/{game_id}", response_model=GameResponse)
def get_game(game_id: str, db: Session = Depends(get_db)) -> GameResponse:
    game_pk = parse_uuid(game_id, "game_id")
    row = db.execute(
        select(Game)
        .where(Game.id == game_pk)
        .add_columns(
            _latest_completed_job_id_subquery().label("latest_completed_job_id"),
            _latest_completed_job_accuracy_subquery("white").label("white_accuracy"),
            _latest_completed_job_accuracy_subquery("black").label("black_accuracy"),
        )
    ).first()
    if row is None:
        raise NotFoundError("Game not found.", {"game_id": game_id})

    game, latest_completed_job_id, white_accuracy, black_accuracy = row
    return GameResponse(
        game=_game_out(game, latest_completed_job_id, white_accuracy, black_accuracy)
    )
