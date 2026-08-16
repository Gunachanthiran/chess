"""Pydantic schemas for the login/connect flow."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ConnectionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    username: str
    connected_at: datetime
    # Not a DB column — `avatar_url` is filled in separately by the router
    # (Chess.com only; Lichess has no profile-picture feature at all) after
    # `model_validate(connection)` builds the rest from the ORM row. `None`
    # covers "no avatar set", "lookup failed", and "this is a Lichess
    # connection" identically — the frontend's fallback is the same either way.
    avatar_url: str | None = None


class AuthStatusResponse(BaseModel):
    lichess: ConnectionOut | None
    chess_com: ConnectionOut | None


class ConnectChessComRequest(BaseModel):
    username: str = Field(min_length=1, max_length=255)


class ConnectResponse(BaseModel):
    """Returned by the Chess.com connect endpoint — Lichess never returns
    this directly, it redirects the browser instead (see `routers/auth.py`)."""

    job_id: uuid.UUID
    username: str
