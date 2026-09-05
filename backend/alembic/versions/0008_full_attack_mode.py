"""full attack mode

Revision ID: 0008_full_attack_mode
Revises: 0007_gambit_selection
Create Date: 2026-09-05

Adds the opt-in "Full Attack Mode" toggle: a separate override from the
aggression slider (see tal_bot.py's FULL_ATTACK_* constants), not another
aggression level. Defaults to False - unlike adapt_to_opponent, this one
starts off, since it's a genuine "expect to lose more games" trade a player
opts into deliberately rather than a safe default.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0008_full_attack_mode"
down_revision: Union[str, None] = "0007_gambit_selection"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "bot_games",
        sa.Column(
            "full_attack_mode",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("bot_games", "full_attack_mode")
