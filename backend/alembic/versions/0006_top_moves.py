"""move_analysis.top_moves

Revision ID: 0006_top_moves
Revises: 0005_great_move
Create Date: 2026-08-16

Adds `top_moves` (JSONB, nullable) to `move_analysis` — Stockfish's ranked
candidate moves for the position *before* each played move, feeding the
"Stockfish recommends" panel on the analysis page. Populated going forward by
`analyze_game.py`; existing rows keep `NULL` (no recommendation data) rather
than a backfilled `[]`, since re-running Stockfish over every already-analysed
game just to populate this column is exactly the kind of extra engine work
this app's free-tier host cannot afford to do automatically.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0006_top_moves"
down_revision: Union[str, None] = "0005_great_move"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "move_analysis",
        sa.Column("top_moves", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("move_analysis", "top_moves")
