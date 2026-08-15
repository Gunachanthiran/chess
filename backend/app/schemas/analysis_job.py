"""Pydantic schemas for analysis jobs."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.analysis_job import JobStatus


class CreateJobRequest(BaseModel):
    game_id: uuid.UUID


class AnalysisJobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    game_id: uuid.UUID
    status: JobStatus
    progress_pct: int
    celery_task_id: str | None
    error_message: str | None
    white_accuracy: float | None
    black_accuracy: float | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None


class AnalysisJobResponse(BaseModel):
    job: AnalysisJobOut
