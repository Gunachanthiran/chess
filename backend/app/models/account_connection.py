"""The `account_connections` table: which external accounts this self-hosted
instance is connected to.

Single-user scope (see the login-flow plan): there is no `users` table, so
"logged in" is a property of the deployment rather than of a browser session.
One row per source, enforced by a unique constraint on `source` — connecting
again overwrites rather than accumulating history.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.game import GameSource


class AccountConnection(Base):
    __tablename__ = "account_connections"
    __table_args__ = (UniqueConstraint("source", name="uq_account_connections_source"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # Reuses `GameSource` (shared with `games.source`/`import_jobs.source`)
    # rather than a narrower enum — only `lichess`/`chess_com` are ever written
    # here, enforced by `account_connections.py`'s service layer, not the DB
    # type, the same way `import_jobs` relies on its request schema rather
    # than a second narrower enum.
    source: Mapped[GameSource] = mapped_column(
        Enum(
            GameSource,
            name="game_source",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
    )
    username: Mapped[str] = mapped_column(String(255), nullable=False)
    connected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class LichessOAuthState(Base):
    """One row per in-flight Lichess OAuth login attempt.

    Holds the PKCE `code_verifier` across the browser's round trip to Lichess
    and back — a plain DB row rather than a signed cookie, consistent with how
    every other transient flow in this app (`ImportJob`, `AnalysisJob`)
    persists its state in Postgres instead of new session-cookie machinery.
    Deleted the moment the callback consumes it; a stale, never-completed
    attempt is otherwise harmless and left for a future cleanup pass.
    """

    __tablename__ = "lichess_oauth_states"

    state: Mapped[str] = mapped_column(String(64), primary_key=True)
    code_verifier: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
