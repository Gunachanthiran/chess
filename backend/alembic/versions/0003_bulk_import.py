"""bulk import

Revision ID: 0003_bulk_import
Revises: 0002_bot_games
Create Date: 2026-08-15

Bulk game import from Lichess and Chess.com:

* adds `chess_com` to the existing `game_source` enum,
* adds `games.chess_com_game_id` and `games.imported_username`,
* replaces the plain index on `games.lichess_game_id` with partial UNIQUE
  indexes on both external id columns (the dedup concurrency backstop), and
* creates the `import_jobs` table.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0003_bulk_import"
down_revision: Union[str, None] = "0002_bot_games"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Postgres refuses ALTER TYPE ... ADD VALUE inside a transaction block that
    # also contains DDL referencing the new value, so this one statement runs in
    # its own autocommit block, before everything else.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE game_source ADD VALUE IF NOT EXISTS 'chess_com'")

    op.add_column(
        "games", sa.Column("chess_com_game_id", sa.String(length=32), nullable=True)
    )
    op.add_column(
        "games", sa.Column("imported_username", sa.String(length=255), nullable=True)
    )

    # The dedup backstop: two workers racing on the same external game id must
    # end up with one row, not two. Partial so that the many NULLs (uploads,
    # games from the other site) do not collide with each other.
    op.drop_index(op.f("ix_games_lichess_game_id"), table_name="games")
    op.create_index(
        "ix_games_lichess_game_id",
        "games",
        ["lichess_game_id"],
        unique=True,
        postgresql_where=sa.text("lichess_game_id IS NOT NULL"),
    )
    op.create_index(
        "ix_games_chess_com_game_id",
        "games",
        ["chess_com_game_id"],
        unique=True,
        postgresql_where=sa.text("chess_com_game_id IS NOT NULL"),
    )

    op.create_table(
        "import_jobs",
        sa.Column("id", sa.UUID(), nullable=False),
        # Both enum types already exist (0001_initial), and `game_source` has
        # just gained `chess_com` above; create_type=False stops Postgres
        # re-declaring either of them.
        sa.Column(
            "source",
            postgresql.ENUM(
                "upload", "lichess", "chess_com", name="game_source", create_type=False
            ),
            nullable=False,
        ),
        sa.Column("username", sa.String(length=255), nullable=False),
        sa.Column("since_ms", sa.BigInteger(), nullable=True),
        sa.Column("until_ms", sa.BigInteger(), nullable=True),
        sa.Column("max_games", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            postgresql.ENUM(
                "pending",
                "running",
                "completed",
                "failed",
                name="job_status",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("progress_pct", sa.Integer(), nullable=False),
        sa.Column("celery_task_id", sa.String(length=255), nullable=True),
        sa.Column("games_found", sa.Integer(), nullable=False),
        sa.Column("games_imported", sa.Integer(), nullable=False),
        sa.Column("games_skipped", sa.Integer(), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_import_jobs_username"), "import_jobs", ["username"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_import_jobs_username"), table_name="import_jobs")
    op.drop_table("import_jobs")

    op.drop_index("ix_games_chess_com_game_id", table_name="games")
    op.drop_index("ix_games_lichess_game_id", table_name="games")
    op.create_index(
        op.f("ix_games_lichess_game_id"), "games", ["lichess_game_id"], unique=False
    )

    op.drop_column("games", "imported_username")
    op.drop_column("games", "chess_com_game_id")

    # NOTE: the `chess_com` value added to the `game_source` enum is NOT removed.
    # Postgres has no `ALTER TYPE ... DROP VALUE`, and the alternative (rebuild
    # the type, rewrite every dependent column, re-add defaults) is fragile
    # enough to be worse than the leftover value. Adding the enum value is an
    # accepted one-way step; the extra value is harmless on downgrade.
