"""Public player search — looked up by username on Chess.com or Lichess, not
tied to any connected account. Read-only, no database writes.
"""

from __future__ import annotations

from fastapi import APIRouter, Query

from app.errors import ValidationError
from app.models.game import GameSource
from app.schemas.import_job import IMPORTABLE_SOURCES
from app.schemas.player import PlayerLookupResponse, PlayerRatingOut
from app.services import chesscom_client, lichess_client

router = APIRouter(prefix="/players", tags=["players"])

# Chess.com stats keys worth surfacing, in display order. Daily/correspondence
# and puzzle-rush-style entries are left out — this panel is about the three
# formats a player-search visitor actually recognises.
CHESSCOM_FORMATS = (("chess_bullet", "bullet"), ("chess_blitz", "blitz"), ("chess_rapid", "rapid"))

# Same idea for Lichess's `perfs`.
LICHESS_FORMATS = ("bullet", "blitz", "rapid", "classical")


@router.get("/lookup", response_model=PlayerLookupResponse)
def lookup_player(
    source: GameSource = Query(...), username: str = Query(min_length=1)
) -> PlayerLookupResponse:
    if source not in IMPORTABLE_SOURCES:
        allowed = ", ".join(sorted(s.value for s in IMPORTABLE_SOURCES))
        raise ValidationError(f"'source' must be one of: {allowed}.", {"source": source.value})

    if source is GameSource.chess_com:
        return _lookup_chess_com(username)
    return _lookup_lichess(username)


def _lookup_chess_com(username: str) -> PlayerLookupResponse:
    profile = chesscom_client.fetch_player_profile(username)
    stats = chesscom_client.fetch_player_stats(username)

    ratings: list[PlayerRatingOut] = []
    total_wins = total_losses = total_draws = 0
    have_record = False

    for stats_key, label in CHESSCOM_FORMATS:
        entry = stats.get(stats_key)
        if not isinstance(entry, dict):
            continue
        last = entry.get("last")
        rating = last.get("rating") if isinstance(last, dict) else None
        ratings.append(PlayerRatingOut(format=label, rating=rating))

        record = entry.get("record")
        if isinstance(record, dict):
            have_record = True
            total_wins += record.get("win") or 0
            total_losses += record.get("loss") or 0
            total_draws += record.get("draw") or 0

    return PlayerLookupResponse(
        source=GameSource.chess_com,
        username=profile.get("username", username),
        display_name=profile.get("name"),
        avatar_url=profile.get("avatar"),
        title=profile.get("title"),
        country=_chesscom_country_code(profile.get("country")),
        profile_url=profile.get("url"),
        wins=total_wins if have_record else None,
        losses=total_losses if have_record else None,
        draws=total_draws if have_record else None,
        ratings=ratings,
    )


def _lookup_lichess(username: str) -> PlayerLookupResponse:
    profile = lichess_client.fetch_user_profile(username)

    perfs = profile.get("perfs")
    ratings: list[PlayerRatingOut] = []
    if isinstance(perfs, dict):
        for label in LICHESS_FORMATS:
            entry = perfs.get(label)
            if not isinstance(entry, dict) or not entry.get("games"):
                continue  # Lichess lists every perf type even with zero games played.
            ratings.append(PlayerRatingOut(format=label, rating=entry.get("rating")))

    count = profile.get("count")
    has_count = isinstance(count, dict)

    display_name_parts = profile.get("profile")
    display_name = (
        display_name_parts.get("realName")
        if isinstance(display_name_parts, dict)
        else None
    )

    return PlayerLookupResponse(
        source=GameSource.lichess,
        username=profile.get("username", username),
        display_name=display_name,
        avatar_url=None,  # Lichess has no profile-picture feature.
        title=profile.get("title"),
        country=None,  # Lichess's public profile does not expose location.
        profile_url=profile.get("url"),
        wins=count.get("win") if has_count else None,
        losses=count.get("loss") if has_count else None,
        draws=count.get("draw") if has_count else None,
        ratings=ratings,
    )


def _chesscom_country_code(country_url: object) -> str | None:
    """`https://api.chess.com/pub/country/NO` -> `NO`; anything else -> `None`."""
    if not isinstance(country_url, str):
        return None
    code = country_url.rstrip("/").rsplit("/", 1)[-1]
    return code if code and code.isalpha() else None
