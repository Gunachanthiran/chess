"""The `bot_game_moves` table: one row per half-move of a game against the bot."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

# Same concept as an analysed move's side, so the same Postgres enum type is
# reused rather than declaring a duplicate one.
from app.models.move_analysis import Side

if TYPE_CHECKING:
    from app.models.bot_game import BotGame


class BotGameMove(Base):
    __tablename__ = "bot_game_moves"
    __table_args__ = (
        UniqueConstraint("bot_game_id", "ply", name="uq_bot_game_moves_game_ply"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    bot_game_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("bot_games.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    ply: Mapped[int] = mapped_column(Integer, nullable=False)
    side: Mapped[Side] = mapped_column(
        Enum(
            Side,
            name="side",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
    )

    san: Mapped[str] = mapped_column(String(16), nullable=False)
    uci: Mapped[str] = mapped_column(String(8), nullable=False)
    # For board rendering only. Legality is always checked against a board
    # replayed from the full move history, never against a stored/sent FEN.
    fen_after: Mapped[str] = mapped_column(String(120), nullable=False)

    is_bot_move: Mapped[bool] = mapped_column(Boolean, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    bot_game: Mapped[BotGame] = relationship("BotGame", back_populates="moves")
