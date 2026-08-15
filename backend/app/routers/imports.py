"""Bulk game imports from Lichess and Chess.com."""

from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.errors import NotFoundError
from app.models.analysis_job import JobStatus
from app.models.import_job import ImportJob
from app.routers.games import parse_uuid
from app.schemas.import_job import (
    CreateImportRequest,
    ImportJobOut,
    ImportJobResponse,
)
from app.tasks.bulk_import import bulk_import

router = APIRouter(prefix="/imports", tags=["imports"])


def _get_import_job(db: Session, job_id: str) -> ImportJob:
    job = db.get(ImportJob, parse_uuid(job_id, "job_id"))
    if job is None:
        raise NotFoundError("Import job not found.", {"job_id": job_id})
    return job


@router.post("", response_model=ImportJobResponse, status_code=status.HTTP_202_ACCEPTED)
def create_import(
    payload: CreateImportRequest, db: Session = Depends(get_db)
) -> ImportJobResponse:
    """Queue a bulk import. `max_games` is capped at 500 by the request schema."""
    job = ImportJob(
        source=payload.source,
        username=payload.username,
        since_ms=payload.since_ms,
        until_ms=payload.until_ms,
        max_games=payload.max_games,
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

    return ImportJobResponse(job=ImportJobOut.model_validate(job))


@router.get("/{job_id}", response_model=ImportJobResponse)
def get_import(job_id: str, db: Session = Depends(get_db)) -> ImportJobResponse:
    job = _get_import_job(db, job_id)
    return ImportJobResponse(job=ImportJobOut.model_validate(job))
