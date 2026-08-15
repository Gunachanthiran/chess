"""Pydantic schemas for per-move analysis."""

import uuid

from pydantic import BaseModel, ConfigDict

from app.models.move_analysis import MoveClassification, Side


class MoveAnalysisOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    job_id: uuid.UUID
    ply: int
    move_number: int
    side: Side
    fen_before: str
    san: str
    uci: str
    eval_cp_before: int | None
    eval_cp_after: int | None
    mate_before: int | None
    mate_after: int | None
    best_move_uci: str
    best_move_eval_cp: int | None
    win_pct_before: float
    win_pct_after: float
    classification: MoveClassification


class MovesResponse(BaseModel):
    moves: list[MoveAnalysisOut]
    white_accuracy: float | None
    black_accuracy: float | None
