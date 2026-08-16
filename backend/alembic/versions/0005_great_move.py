"""great move classification

Revision ID: 0005_great_move
Revises: 0004_account_connections
Create Date: 2026-08-16

Adds "great" to the `move_classification` enum — chess.com-style tier for the
single clearly-right move in a sharp position (a large gap to the second-best
option) that isn't a material sacrifice, so it doesn't qualify as "brilliant".
Sits between "brilliant" and "best" in `classify_move` (app/services/classification.py).

Postgres 12+ allows `ALTER TYPE ... ADD VALUE` inside a transaction as long as
the new value isn't read in the same transaction, which this migration never
does — no data backfill needed since existing rows simply predate this tier.
"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0005_great_move"
down_revision: Union[str, None] = "0004_account_connections"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE move_classification ADD VALUE IF NOT EXISTS 'great' BEFORE 'best'")


def downgrade() -> None:
    # Postgres has no `DROP VALUE` for enums — removing one cleanly means
    # rebuilding the type (new type, cast every column, drop the old type),
    # which is real destructive surgery for a downgrade path that only exists
    # for local dev convenience. Left as a no-op; any 'great' rows would need
    # manual reclassification before a genuine rollback.
    pass
