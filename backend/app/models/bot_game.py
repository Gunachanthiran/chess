"""The `bot_games` table: one row per game played against the Tal-style bot."""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, Integer, String, func
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
