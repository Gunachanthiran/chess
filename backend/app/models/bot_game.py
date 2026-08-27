"""The `bot_games` table: one row per game played against the Tal-style bot."""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Enum, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

if TYPE_CHECKING:
    from app.models.bot_game_move import BotGameMove


class BotColor(str, enum.Enum):
    """Which colour the *human* plays."""

    white = "white"
    black = "black"


class BotGameStatus(str, enum.Enum):
    in_progress = "in_progress"
    checkmate = "checkmate"
    stalemate = "stalemate"
    draw = "draw"
    resigned = "resigned"


class BotGame(Base):
    __tablename__ = "bot_games"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    player_color: Mapped[BotColor] = mapped_column(
        Enum(
            BotColor,
            name="bot_color",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
    )
    bot_elo: Mapped[int] = mapped_column(Integer, nullable=False)
    bot_aggression: Mapped[int] = mapped_column(Integer, nullable=False)
    # Id into the bundled gambits.json (app/services/gambits.py) — no FK, same
    # non-relational treatment as the opening eco/name shown elsewhere, since
    # gambits live in a bundled file rather than a table. Null = free play.
    gambit_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    adapt_to_opponent: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    # Opt-in, unlike adapt_to_opponent above — a separate, explicit override
    # of the aggression slider's own tolerance (see tal_bot.py's FULL_ATTACK_*
    # constants), not a sharper aggression level. Off by default: turning it
    # on is a deliberate "go for broke" choice, not the safe default.
    full_attack_mode: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )

    status: Mapped[BotGameStatus] = mapped_column(
        Enum(
            BotGameStatus,
            name="bot_game_status",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
        default=BotGameStatus.in_progress,
    )
    result: Mapped[str | None] = mapped_column(String(7), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    moves: Mapped[list[BotGameMove]] = relationship(
        "BotGameMove",
        back_populates="bot_game",
        cascade="all, delete-orphan",
        order_by="BotGameMove.ply",
    )
