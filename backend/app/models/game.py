"""The `games` table: one row per imported/uploaded PGN."""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

if TYPE_CHECKING:
    from app.models.analysis_job import AnalysisJob


class GameSource(str, enum.Enum):
    upload = "upload"
    lichess = "lichess"
    chess_com = "chess_com"


class Game(Base):
    __tablename__ = "games"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    source: Mapped[GameSource] = mapped_column(
        Enum(
            GameSource,
            name="game_source",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
    )
    lichess_game_id: Mapped[str | None] = mapped_column(
        String(32), nullable=True, index=True
    )
    chess_com_game_id: Mapped[str | None] = mapped_column(
        String(32), nullable=True, index=True
    )
    # The username a bulk import was run under, so the UI can work out which
    # side of the board is "you" without a real auth system.
    imported_username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    pgn: Mapped[str] = mapped_column(Text, nullable=False)

    white_name: Mapped[str] = mapped_column(String(255), nullable=False)
    black_name: Mapped[str] = mapped_column(String(255), nullable=False)
    white_elo: Mapped[int | None] = mapped_column(Integer, nullable=True)
    black_elo: Mapped[int | None] = mapped_column(Integer, nullable=True)

    result: Mapped[str] = mapped_column(String(7), nullable=False)
    eco: Mapped[str | None] = mapped_column(String(8), nullable=True)
    opening_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    played_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    jobs: Mapped[list[AnalysisJob]] = relationship(
        "AnalysisJob", back_populates="game", cascade="all, delete-orphan"
    )
