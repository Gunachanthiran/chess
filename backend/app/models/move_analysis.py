"""The `move_analysis` table: one row per half-move of an analysed game."""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

if TYPE_CHECKING:
    from app.models.analysis_job import AnalysisJob


class Side(str, enum.Enum):
    white = "white"
    black = "black"


class MoveClassification(str, enum.Enum):
    brilliant = "brilliant"
    great = "great"
    best = "best"
    excellent = "excellent"
    good = "good"
    book = "book"
    inaccuracy = "inaccuracy"
    mistake = "mistake"
    blunder = "blunder"
    forced = "forced"


class MoveAnalysis(Base):
    __tablename__ = "move_analysis"
    __table_args__ = (
        UniqueConstraint("job_id", "ply", name="uq_move_analysis_job_ply"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("analysis_jobs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    ply: Mapped[int] = mapped_column(Integer, nullable=False)
    move_number: Mapped[int] = mapped_column(Integer, nullable=False)
    side: Mapped[Side] = mapped_column(
        Enum(
            Side,
            name="side",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
    )

    fen_before: Mapped[str] = mapped_column(String(120), nullable=False)
    san: Mapped[str] = mapped_column(String(16), nullable=False)
    uci: Mapped[str] = mapped_column(String(8), nullable=False)

    # All evaluations are stored from White's point of view.
    eval_cp_before: Mapped[int | None] = mapped_column(Integer, nullable=True)
    eval_cp_after: Mapped[int | None] = mapped_column(Integer, nullable=True)
    mate_before: Mapped[int | None] = mapped_column(Integer, nullable=True)
    mate_after: Mapped[int | None] = mapped_column(Integer, nullable=True)

    best_move_uci: Mapped[str] = mapped_column(String(8), nullable=False)
    best_move_eval_cp: Mapped[int | None] = mapped_column(Integer, nullable=True)

    win_pct_before: Mapped[float] = mapped_column(Float, nullable=False)
    win_pct_after: Mapped[float] = mapped_column(Float, nullable=False)

    classification: Mapped[MoveClassification] = mapped_column(
        Enum(
            MoveClassification,
            name="move_classification",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
    )

    # Stockfish's ranked candidate moves *from this position* (i.e. for
    # `fen_before`, not the move actually played) — the "Stockfish
    # recommends" panel's data. `[{"uci": str, "cp": int|None, "mate":
    # int|None}, ...]`, best first, typically length `ANALYSIS_MULTIPV`
    # (engine_pool.py). Nullable rather than defaulted to `[]`: rows written
    # before this column existed have no recommendation data at all, and
    # `None` keeps that genuinely absent rather than indistinguishable from
    # "the engine had no candidates" (which the terminal-position case does
    # produce, as a real `[]`).
    top_moves: Mapped[list | None] = mapped_column(JSONB, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    job: Mapped[AnalysisJob] = relationship("AnalysisJob", back_populates="moves")
