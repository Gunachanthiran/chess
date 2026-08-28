"""Pydantic schemas for games played against the Tal-style bot."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.bot_game import BotColor, BotGameStatus
from app.models.move_analysis import Side
from app.services import gambits as gambits_service
from app.services.tal_bot import GRANDMASTER_ELO, MAX_AGGRESSION, MIN_AGGRESSION

# Public-facing slider range (matches the frontend). Anything below Stockfish's
# own UCI_Elo floor (engine_pool.MIN_UCI_ELO, currently 1320) is accepted here
# and silently clamped later by StockfishEngine — rejecting it at the API layer
# would contradict the product decision to clamp rather than error.
BOT_ELO_MIN = 800

# The top of the range is the Grandmaster sentinel, not a rating: it selects
# unrestricted full-strength Stockfish rather than a tunable UCI_Elo value (see
# tal_bot.GRANDMASTER_ELO). Imported rather than repeated so the API bound and
# the tier that bound exists for can never drift apart.
BOT_ELO_MAX = GRANDMASTER_ELO


class CreateBotGameRequest(BaseModel):
    player_color: BotColor = BotColor.white
    bot_elo: int = Field(
        # Grandmaster is the default experience, not the far end of a slider: a
        # deliberately weakened bot has to blunder sometimes - that is what
        # makes it beatable - and that is not the opponent this product is for.
        # The tunable range below stays available as explicit practice mode.
        default=GRANDMASTER_ELO,
        ge=BOT_ELO_MIN,
        le=BOT_ELO_MAX,
        description=(
            f"Requested bot strength; clamped to Stockfish's supported UCI_Elo "
            f"range before play. {GRANDMASTER_ELO} (the default) selects the "
            f"Grandmaster tier: unrestricted full-strength Stockfish, no elo "
            f"cap and no strength handicap. Lower values select practice mode."
        ),
    )
    bot_aggression: int = Field(
        default=3,
        ge=MIN_AGGRESSION,
        le=MAX_AGGRESSION,
        description="1 = plain elo-limited Stockfish, 5 = maximally Tal-like",
    )
    gambit_id: str | None = Field(
        default=None,
        description=(
            "Id from GET /api/gambits the bot should prefer as an opening "
            "plan, or null for free play. A preference, not a script — see "
            "app/services/gambit_strategy.py."
        ),
    )
    adapt_to_opponent: bool = Field(
        default=True,
        description="Whether the bot nudges its personality toward the opponent's observed style.",
    )

    @field_validator("gambit_id")
    @classmethod
    def _gambit_must_exist(cls, value: str | None) -> str | None:
        if value is not None and gambits_service.get_gambit(value) is None:
            raise ValueError(f"Unknown gambit id: {value!r}")
        return value


class SubmitBotMoveRequest(BaseModel):
    uci: str = Field(min_length=4, max_length=5, description="Move in UCI notation")


class BotGameMoveOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    ply: int
    side: Side
    san: str
    uci: str
    fen_after: str
    is_bot_move: bool
    created_at: datetime


class BotGameOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    player_color: BotColor
    bot_elo: int
    bot_aggression: int
    gambit_id: str | None
    adapt_to_opponent: bool
    status: BotGameStatus
    result: str | None
    created_at: datetime
    updated_at: datetime
    moves: list[BotGameMoveOut] = []

    # Live opening identification, recomputed from the move list on every
    # response rather than stored (no column, no migration): it changes every
    # ply, and both fields go back to null the moment the game leaves book.
    opening_eco: str | None = None
    opening_name: str | None = None

    # Live gambit/strategy readout — likewise recomputed on every response,
    # never stored. See bot_game_service.strategy_status.
    gambit_name: str | None = None
    gambit_status: str = "no_gambit"
    opponent_style: list[str] = []
    bot_strategy_summary: str | None = None


class BotGameResponse(BaseModel):
    bot_game: BotGameOut


class BotGameSummaryOut(BaseModel):
    """A lighter `BotGameOut` for list views (the dashboard's Bots tab and its
    "game in progress" banner) — `move_count` instead of the full `moves`
    array, since a page of these should not each carry every move played."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    player_color: BotColor
    bot_elo: int
    bot_aggression: int
    status: BotGameStatus
    result: str | None
    created_at: datetime
    updated_at: datetime
    move_count: int = 0
    opening_eco: str | None = None
    opening_name: str | None = None
    gambit_name: str | None = None


class BotGameSummaryListResponse(BaseModel):
    bot_games: list[BotGameSummaryOut]
    total: int
