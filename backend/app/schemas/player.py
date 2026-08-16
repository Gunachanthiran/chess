"""Pydantic schemas for the public player-search lookup."""

from __future__ import annotations

from pydantic import BaseModel

from app.models.game import GameSource


class PlayerRatingOut(BaseModel):
    """One format's current rating — e.g. `{"format": "blitz", "rating": 1842}`."""

    format: str
    rating: int | None


class PlayerLookupResponse(BaseModel):
    """A public player's profile + results, looked up by username — not tied
    to any connected account. `wins`/`losses`/`draws` are overall totals
    across every format the source reports (Chess.com sums its per-format
    records; Lichess already reports one overall total)."""

    source: GameSource
    username: str
    display_name: str | None
    avatar_url: str | None
    title: str | None
    country: str | None
    profile_url: str | None
    wins: int | None
    losses: int | None
    draws: int | None
    ratings: list[PlayerRatingOut]
