"""full attack mode

Revision ID: 0008_full_attack_mode
Revises: 0007_gambit_selection
Create Date: 2026-08-23

Adds the "Full Attack Mode" opt-in: a separate, explicit override of the
aggression slider's own tolerance (see tal_bot.py's FULL_ATTACK_* constants),
not another aggression level. Off by default, unlike adapt_to_opponent —
turning it on is a deliberate "go for broke, real sacrifices" choice.
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
