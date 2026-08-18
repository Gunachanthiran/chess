"""gambit selection

Revision ID: 0007_gambit_selection
Revises: 0006_top_moves
Create Date: 2026-08-18

Adds the two real user choices behind "Choose Your Gambit": which bundled
gambit (if any) the bot should try to play, and whether it should adapt its
personality to the opponent's observed style. Everything else about a
gambit's effect (status, opponent tags, strategy summary) is computed fresh
per response, exactly like the existing opening eco/name, so it needs no
column of its own.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0007_gambit_selection"
down_revision: Union[str, None] = "0006_top_moves"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("bot_games", sa.Column("gambit_id", sa.String(length=64), nullable=True))
    op.add_column(
        "bot_games",
        sa.Column(
            "adapt_to_opponent",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )


def downgrade() -> None:
    op.drop_column("bot_games", "adapt_to_opponent")
    op.drop_column("bot_games", "gambit_id")
