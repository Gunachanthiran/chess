"""account connections

Revision ID: 0004_account_connections
Revises: 0003_bulk_import
Create Date: 2026-08-15

Backs the login flow (Lichess OAuth / Chess.com username connect):

* `account_connections` — one row per connected external account, unique on
  `source`. Reuses the existing `game_source` enum type.
* `lichess_oauth_states` — transient PKCE state for an in-flight Lichess OAuth
  login, one row per attempt, deleted once the callback consumes it.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0004_account_connections"
down_revision: Union[str, None] = "0003_bulk_import"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "account_connections",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column(
            "source",
            postgresql.ENUM(
                "upload", "lichess", "chess_com", name="game_source", create_type=False
            ),
            nullable=False,
        ),
        sa.Column("username", sa.String(length=255), nullable=False),
        sa.Column(
            "connected_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source", name="uq_account_connections_source"),
    )

    op.create_table(
        "lichess_oauth_states",
        sa.Column("state", sa.String(length=64), nullable=False),
        sa.Column("code_verifier", sa.String(length=128), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("state"),
    )


def downgrade() -> None:
    op.drop_table("lichess_oauth_states")
    op.drop_table("account_connections")
