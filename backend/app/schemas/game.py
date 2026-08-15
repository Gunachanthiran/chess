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


class _GameFields(BaseModel):
    """Shared columns between the full (`GameOut`) and list (`GameSummaryOut`)
    shapes. `pgn` is the one deliberate omission here, not an oversight — see
    `GameSummaryOut`."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    source: GameSource
    lichess_game_id: str | None
    chess_com_game_id: str | None
    imported_username: str | None
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


class GameOut(_GameFields):
    pgn: str


class GameSummaryOut(_GameFields):
    """`GameOut` without `pgn` — used for `GameListResponse` only.

    No frontend page ever reads a fetched game's `pgn` (confirmed by
    grepping the whole frontend), so shipping it back for every row of a
    200-game page was pure waste — real enough to have contributed to
    `chessscope-api` hitting its 512MB memory limit on Render's free tier.
    `routers/games.py::list_games` also defers loading the `pgn` column at
    the SQL level for the same reason: the win is in never holding a few
    hundred KB of PGN text in memory per request, not just in trimming the
    JSON response after the fact.
    """


class GameResponse(BaseModel):
    game: GameOut


class GameListResponse(BaseModel):
    games: list[GameSummaryOut]
    total: int
