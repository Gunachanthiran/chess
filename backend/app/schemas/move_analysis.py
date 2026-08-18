"""Pydantic schemas for per-move analysis."""

import uuid

from pydantic import BaseModel, ConfigDict

from app.models.move_analysis import MoveClassification, Side


class TopMoveOut(BaseModel):
    """One ranked candidate line from `MoveAnalysis.top_moves` — the
    "Stockfish recommends" panel's data. `sans` is the full principal
    variation (best move first, followed by the engine's expected
    continuation for both sides), not just the immediate move; `cp`/`mate`
    score the position after that first move only."""

    sans: list[str]
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


class ExplorePositionRequest(BaseModel):
    """A position the user reached by dragging pieces on the analysis board —
    not necessarily anywhere in the actual game, so there is no stored
    evaluation for it and one has to be computed on the spot."""

    fen: str


class ExplorePositionResponse(BaseModel):
    """A quick, on-demand read of one arbitrary position — same shape as a
    `top_moves` entry, deliberately shallower/faster than the batch analysis
    pipeline (see `engine_pool.EXPLORE_*`) since this blocks a live UI
    interaction rather than running in the background."""

    cp: int | None
    mate: int | None
    top_moves: list[TopMoveOut]
