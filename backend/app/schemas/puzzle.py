"""Pydantic schemas for the tactics trainer (see services/puzzles_service.py)."""

import uuid
from datetime import datetime

from pydantic import BaseModel

from app.models.move_analysis import MoveClassification, Side


class PuzzleOut(BaseModel):
    id: uuid.UUID
    game_id: uuid.UUID
    fen: str
    side_to_move: Side
    played_san: str
    played_uci: str
    correct_uci: str
    correct_san: str
    classification: MoveClassification
    opening_name: str | None
    white_name: str
    black_name: str
    played_at: datetime | None


class PuzzleListResponse(BaseModel):
    puzzles: list[PuzzleOut]
    # Count of *all* your Mistakes/Blunders this instance knows about, before
    # the response was capped to one batch — lets the UI show "1 of 47"
    # rather than just the batch size.
    total_available: int
