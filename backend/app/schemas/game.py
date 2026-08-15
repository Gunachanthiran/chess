"""Pydantic schemas for games."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.game import GameSource


class PGNUploadRequest(BaseModel):
    pgn: str = Field(min_length=1, description="Raw PGN text")


class LichessImportRequest(BaseModel):
    """Either `lichess_game_id`, or `username` (+ `recent`) for the latest game."""

    lichess_game_id: str | None = None
    username: str | None = None
    recent: bool = False


class GameOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    source: GameSource
    lichess_game_id: str | None
    chess_com_game_id: str | None
    imported_username: str | None
    pgn: str
    white_name: str
    black_name: str
    white_elo: int | None
    black_elo: int | None
    result: str
    eco: str | None
    opening_name: str | None
    played_at: datetime | None
    created_at: datetime

    # Not a column — computed per-request in `routers/games.py` (a game has no
    # completed analysis yet the moment it's uploaded/imported, hence the
    # default rather than a required field every existing caller would need
    # to start passing). Lets a dashboard card show "Reviewed" (linking
    # straight to `/analysis/{this_id}`) vs "Analyze" without a second
    # round-trip per card.
    latest_completed_job_id: uuid.UUID | None = None


class GameResponse(BaseModel):
    game: GameOut


class GameListResponse(BaseModel):
    games: list[GameOut]
    total: int
