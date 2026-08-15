"""bot games

Revision ID: 0002_bot_games
Revises: 0001_initial
Create Date: 2026-08-15

Adds the two tables behind the Tal-style bot: bot_games and bot_game_moves.
`bot_game_moves.side` reuses the existing `side` enum type created by 0001.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0002_bot_games"
down_revision: Union[str, None] = "0001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "bot_games",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column(
            "player_color",
            sa.Enum("white", "black", name="bot_color"),
            nullable=False,
        ),
        sa.Column("bot_elo", sa.Integer(), nullable=False),
        sa.Column("bot_aggression", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "in_progress",
                "checkmate",
                "stalemate",
                "draw",
                "resigned",
                name="bot_game_status",
            ),
            nullable=False,
        ),
        sa.Column("result", sa.String(length=7), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "bot_game_moves",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("bot_game_id", sa.UUID(), nullable=False),
        sa.Column("ply", sa.Integer(), nullable=False),
        # The `side` enum type already exists (created by 0001_initial for
        # move_analysis); create_type=False stops Postgres re-declaring it.
        sa.Column(
            "side",
            postgresql.ENUM("white", "black", name="side", create_type=False),
            nullable=False,
        ),
        sa.Column("san", sa.String(length=16), nullable=False),
        sa.Column("uci", sa.String(length=8), nullable=False),
        sa.Column("fen_after", sa.String(length=120), nullable=False),
        sa.Column("is_bot_move", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["bot_game_id"], ["bot_games.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("bot_game_id", "ply", name="uq_bot_game_moves_game_ply"),
    )
    op.create_index(
        op.f("ix_bot_game_moves_bot_game_id"),
        "bot_game_moves",
        ["bot_game_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_bot_game_moves_bot_game_id"), table_name="bot_game_moves")
    op.drop_table("bot_game_moves")
    op.drop_table("bot_games")

    # `side` is left alone: move_analysis still uses it.
    bind = op.get_bind()
    for enum_name in ("bot_game_status", "bot_color"):
        sa.Enum(name=enum_name).drop(bind, checkfirst=True)
