"""initial

Revision ID: 0001_initial
Revises:
Create Date: 2026-08-14

Creates the three Milestone 1 tables: games, analysis_jobs, move_analysis.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "games",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column(
            "source",
            sa.Enum("upload", "lichess", name="game_source"),
            nullable=False,
        ),
        sa.Column("lichess_game_id", sa.String(length=32), nullable=True),
        sa.Column("pgn", sa.Text(), nullable=False),
        sa.Column("white_name", sa.String(length=255), nullable=False),
        sa.Column("black_name", sa.String(length=255), nullable=False),
        sa.Column("white_elo", sa.Integer(), nullable=True),
        sa.Column("black_elo", sa.Integer(), nullable=True),
        sa.Column("result", sa.String(length=7), nullable=False),
        sa.Column("eco", sa.String(length=8), nullable=True),
        sa.Column("opening_name", sa.String(length=255), nullable=True),
        sa.Column("played_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_games_lichess_game_id"), "games", ["lichess_game_id"], unique=False
    )

    op.create_table(
        "analysis_jobs",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("game_id", sa.UUID(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("pending", "running", "completed", "failed", name="job_status"),
            nullable=False,
        ),
        sa.Column("progress_pct", sa.Integer(), nullable=False),
        sa.Column("celery_task_id", sa.String(length=255), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("white_accuracy", sa.Float(), nullable=True),
        sa.Column("black_accuracy", sa.Float(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["game_id"], ["games.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_analysis_jobs_game_id"), "analysis_jobs", ["game_id"], unique=False
    )

    op.create_table(
        "move_analysis",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("job_id", sa.UUID(), nullable=False),
        sa.Column("ply", sa.Integer(), nullable=False),
        sa.Column("move_number", sa.Integer(), nullable=False),
        sa.Column("side", sa.Enum("white", "black", name="side"), nullable=False),
        sa.Column("fen_before", sa.String(length=120), nullable=False),
        sa.Column("san", sa.String(length=16), nullable=False),
        sa.Column("uci", sa.String(length=8), nullable=False),
        sa.Column("eval_cp_before", sa.Integer(), nullable=True),
        sa.Column("eval_cp_after", sa.Integer(), nullable=True),
        sa.Column("mate_before", sa.Integer(), nullable=True),
        sa.Column("mate_after", sa.Integer(), nullable=True),
        sa.Column("best_move_uci", sa.String(length=8), nullable=False),
        sa.Column("best_move_eval_cp", sa.Integer(), nullable=True),
        sa.Column("win_pct_before", sa.Float(), nullable=False),
        sa.Column("win_pct_after", sa.Float(), nullable=False),
        sa.Column(
            "classification",
            sa.Enum(
                "brilliant",
                "best",
                "excellent",
                "good",
                "book",
                "inaccuracy",
                "mistake",
                "blunder",
                "forced",
                name="move_classification",
            ),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["job_id"], ["analysis_jobs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("job_id", "ply", name="uq_move_analysis_job_ply"),
    )
    op.create_index(
        op.f("ix_move_analysis_job_id"), "move_analysis", ["job_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_move_analysis_job_id"), table_name="move_analysis")
    op.drop_table("move_analysis")
    op.drop_index(op.f("ix_analysis_jobs_game_id"), table_name="analysis_jobs")
    op.drop_table("analysis_jobs")
    op.drop_index(op.f("ix_games_lichess_game_id"), table_name="games")
    op.drop_table("games")

    # Postgres keeps enum types around after their tables are dropped.
    bind = op.get_bind()
    for enum_name in ("move_classification", "side", "job_status", "game_source"):
        sa.Enum(name=enum_name).drop(bind, checkfirst=True)
