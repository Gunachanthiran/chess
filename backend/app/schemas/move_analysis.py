"""Pydantic schemas for per-move analysis."""

import uuid

from pydantic import BaseModel, ConfigDict

from app.models.move_analysis import MoveClassification, Side


class TopMoveOut(BaseModel):
    """One ranked candidate from `MoveAnalysis.top_moves` — the "Stockfish
    recommends" panel's data, best move first."""

    uci: str
    cp: int | None
    mate: int | None


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
    # `None` for rows analysed before this column existed (see the model's own
    # docstring) — the frontend panel treats that the same as "nothing to show".
    top_moves: list[TopMoveOut] | None = None


class MovesResponse(BaseModel):
    moves: list[MoveAnalysisOut]
    white_accuracy: float | None
    black_accuracy: float | None
