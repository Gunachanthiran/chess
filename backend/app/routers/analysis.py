"""Analysis job creation and result retrieval."""

from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.errors import ConflictError, NotFoundError
from app.models.analysis_job import AnalysisJob, JobStatus
from app.models.game import Game
from app.models.move_analysis import MoveAnalysis
from app.routers.games import parse_uuid
from app.schemas.analysis_job import (
    AnalysisJobOut,
    AnalysisJobResponse,
    CreateJobRequest,
)
from app.schemas.move_analysis import MoveAnalysisOut, MovesResponse
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
