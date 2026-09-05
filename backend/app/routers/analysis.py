"""Analysis job creation and result retrieval."""

from __future__ import annotations

import re

import chess
from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.errors import ConflictError, NotFoundError, ValidationError
from app.models.analysis_job import AnalysisJob, JobStatus
from app.models.game import Game
from app.models.move_analysis import MoveAnalysis
from app.routers.games import parse_uuid
from app.schemas.analysis_job import (
    AnalysisJobOut,
    AnalysisJobResponse,
    CreateJobRequest,
)
from app.schemas.move_analysis import (
    ExplorePositionRequest,
    ExplorePositionResponse,
    MoveAnalysisOut,
    MovesResponse,
    TopMoveOut,
)
from app.services.engine_pool import StockfishEngine
from app.services.pgn_export import build_annotated_pgn
from app.tasks.analyze_game import analyze_game

router = APIRouter(prefix="/analysis", tags=["analysis"])


def _get_job(db: Session, job_id: str) -> AnalysisJob:
    job = db.get(AnalysisJob, parse_uuid(job_id, "job_id"))
    if job is None:
        raise NotFoundError("Analysis job not found.", {"job_id": job_id})
    return job


@router.post(
    "/jobs", response_model=AnalysisJobResponse, status_code=status.HTTP_202_ACCEPTED
)
def create_job(
    payload: CreateJobRequest, db: Session = Depends(get_db)
) -> AnalysisJobResponse:
    game = db.get(Game, payload.game_id)
    if game is None:
        raise NotFoundError("Game not found.", {"game_id": str(payload.game_id)})

    job = AnalysisJob(game_id=game.id, status=JobStatus.pending, progress_pct=0)
    db.add(job)
    db.commit()
    db.refresh(job)

    async_result = analyze_game.delay(str(job.id))
    job.celery_task_id = async_result.id
    db.commit()
    db.refresh(job)

    return AnalysisJobResponse(job=AnalysisJobOut.model_validate(job))


@router.get("/jobs/{job_id}", response_model=AnalysisJobResponse)
def get_job(job_id: str, db: Session = Depends(get_db)) -> AnalysisJobResponse:
    job = _get_job(db, job_id)
    return AnalysisJobResponse(job=AnalysisJobOut.model_validate(job))


@router.get("/jobs/{job_id}/moves", response_model=MovesResponse)
def get_job_moves(job_id: str, db: Session = Depends(get_db)) -> MovesResponse:
    job = _get_job(db, job_id)

    if job.status is not JobStatus.completed:
        raise ConflictError(
            "Analysis is not finished yet.",
            {
                "job_id": job_id,
                "status": job.status.value,
                "progress_pct": job.progress_pct,
            },
            code="JOB_NOT_COMPLETED",
        )

    moves = db.scalars(
        select(MoveAnalysis)
        .where(MoveAnalysis.job_id == job.id)
        .order_by(MoveAnalysis.ply.asc())
    ).all()

    return MovesResponse(
        moves=[MoveAnalysisOut.model_validate(move) for move in moves],
        white_accuracy=job.white_accuracy,
        black_accuracy=job.black_accuracy,
    )


def _pgn_filename(game: Game) -> str:
    """A readable, filesystem-safe filename - browsers otherwise fall back
    to the URL's last path segment (the job's UUID), which tells a human
    nothing about which game they just downloaded."""
    raw = f"{game.white_name}_vs_{game.black_name}"
    safe = re.sub(r"[^A-Za-z0-9_-]+", "-", raw).strip("-")
    return f"{safe or 'game'}.pgn"


@router.get("/jobs/{job_id}/export.pgn")
def export_job_pgn(job_id: str, db: Session = Depends(get_db)) -> Response:
    """The analysed game as a real PGN, each move carrying a Lichess-style
    `[%eval ...]` comment and a standard NAG for anything worth flagging
    (see `pgn_export.build_annotated_pgn`) - openable in any chess GUI, or
    re-importable into Lichess/Chess.com with the same evaluation graph and
    move markers this app shows.
    """
    job = _get_job(db, job_id)

    if job.status is not JobStatus.completed:
        raise ConflictError(
            "Analysis is not finished yet.",
            {
                "job_id": job_id,
                "status": job.status.value,
                "progress_pct": job.progress_pct,
            },
            code="JOB_NOT_COMPLETED",
        )

    moves = db.scalars(
        select(MoveAnalysis)
        .where(MoveAnalysis.job_id == job.id)
        .order_by(MoveAnalysis.ply.asc())
    ).all()

    pgn_text = build_annotated_pgn(job.game, list(moves))

    return Response(
        content=pgn_text,
        media_type="application/x-chess-pgn",
        headers={"Content-Disposition": f'attachment; filename="{_pgn_filename(job.game)}"'},
    )


@router.post("/explore", response_model=ExplorePositionResponse)
def explore_position(payload: ExplorePositionRequest) -> ExplorePositionResponse:
    """On-demand read of one position the user reached by dragging pieces on
    the analysis board — "what happens if I play this" for a move that isn't
    necessarily anywhere in the game's own stored analysis.

    Deliberately not routed through the batch pipeline's `StockfishEngine.analyse()`
    (`ANALYSIS_TIME_LIMIT_S`, up to 30s on production) - that budget is sized
    for a background job, and this blocks a live click. `analyse_candidates()`
    is the same bounded-time search the "Stockfish recommends" panel and the
    bot's own move choice already use (`CANDIDATE_TIME_LIMIT_S` = 1.5s), just
    at full strength (no elo cap) since the point here is a genuine read of
    the position, not a deliberately weakened opponent.
    """
    try:
        board = chess.Board(payload.fen)
    except ValueError as exc:
        raise ValidationError(
            "Not a valid position.", {"fen": payload.fen}
        ) from exc

    with StockfishEngine(elo=None) as engine:
        candidates = engine.analyse_candidates(board, multipv=3)

    if not candidates:
        # Checkmate, stalemate, or any other position with no legal moves.
        return ExplorePositionResponse(cp=None, mate=None, top_moves=[])

    return ExplorePositionResponse(
        cp=candidates[0].cp,
        mate=candidates[0].mate,
        top_moves=[
            TopMoveOut(sans=[board.san(candidate.move)], cp=candidate.cp, mate=candidate.mate)
            for candidate in candidates
        ],
    )
