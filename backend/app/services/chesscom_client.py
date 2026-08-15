"""Thin client for the public Chess.com API (no auth, but User-Agent required).

Chess.com exposes a player's games as monthly *archives*: a list of archive URLs
ending in `/YYYY/MM`, each of which returns that month's games. There is no
"give me the last N games" endpoint, so bulk fetching walks the archives newest
month first and stops once `max_games` PGNs have been collected.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

import httpx

from app.config import settings
from app.errors import ExternalAPIError, ValidationError

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT = httpx.Timeout(20.0)

DEFAULT_MAX_GAMES = 100


def fetch_archive_urls(username: str) -> list[str]:
    """Every monthly archive URL for a player, oldest month first."""
    user = (username or "").strip()
    if not user:
        raise ValidationError("A Chess.com username is required.")

    url = f"{settings.CHESSCOM_API_BASE.rstrip('/')}/player/{user}/games/archives"
    payload = _get(url, context={"username": user})

    archives = payload.get("archives")
    if not isinstance(archives, list):
        raise ExternalAPIError(
            "Chess.com returned an unexpected archives payload.", {"username": user}
        )
    return [archive for archive in archives if isinstance(archive, str)]


def fetch_month_pgns(archive_url: str) -> list[str]:
    """The PGN of every finished game in one monthly archive."""
    url = (archive_url or "").strip()
    if not url:
        raise ValidationError("A Chess.com archive URL is required.")

    payload = _get(url, context={"archive_url": url})

    games = payload.get("games")
    if not isinstance(games, list):
        raise ExternalAPIError(
            "Chess.com returned an unexpected archive payload.", {"archive_url": url}
        )

    pgns: list[str] = []
    for entry in games:
        # In-progress (daily) games come back without a `pgn` field.
        if not isinstance(entry, dict):
            continue
        pgn = entry.get("pgn")
        if isinstance(pgn, str) and pgn.strip():
            pgns.append(pgn)
    return pgns


def fetch_games_bulk(
    username: str,
    *,
    since_ms: int | None = None,
    until_ms: int | None = None,
    max_games: int = DEFAULT_MAX_GAMES,
) -> list[str]:
    """Up to `max_games` PGNs for a player, most recent months first."""
    user = (username or "").strip()
    if not user:
        raise ValidationError("A Chess.com username is required.")
    if max_games <= 0:
        return []

    archives = fetch_archive_urls(user)

    since_key = _month_key(since_ms)
    until_key = _month_key(until_ms)

    # Archive URLs end in `/YYYY/MM`, which sorts lexicographically the same way
    # it sorts chronologically - so a plain string compare is enough to window
    # the months without parsing dates out of every URL.
    selected = [
        archive
        for archive in archives
        if _in_window(_archive_month_key(archive), since_key, until_key)
    ]

    pgns: list[str] = []
    for archive in reversed(selected):  # newest month first
        month_pgns = fetch_month_pgns(archive)
        # Chess.com lists a month's games oldest first; reverse so that a small
        # `max_games` returns the player's *most recent* games.
        pgns.extend(reversed(month_pgns))
        if len(pgns) >= max_games:
            break

    return pgns[:max_games]


def _archive_month_key(archive_url: str) -> str | None:
    """`.../games/2024/03` -> `2024/03`."""
    parts = archive_url.rstrip("/").split("/")
    if len(parts) < 2:
        return None
    year, month = parts[-2], parts[-1]
    if len(year) == 4 and year.isdigit() and len(month) == 2 and month.isdigit():
        return f"{year}/{month}"
    return None


def _month_key(epoch_ms: int | None) -> str | None:
    if epoch_ms is None:
        return None
    return datetime.fromtimestamp(epoch_ms / 1000, tz=UTC).strftime("%Y/%m")


def _in_window(month_key: str | None, since_key: str | None, until_key: str | None) -> bool:
    if month_key is None:
        # Unparseable URL shape: keep it rather than silently dropping games.
        return True
    if since_key is not None and month_key < since_key:
        return False
    if until_key is not None and month_key > until_key:
        return False
    return True


def _get(url: str, *, context: dict | None = None) -> dict:
    """GET returning parsed JSON, with every failure mode as ExternalAPIError."""
    headers = {
        "User-Agent": settings.CHESSCOM_USER_AGENT,
        "Accept": "application/json",
    }

    try:
        with httpx.Client(timeout=REQUEST_TIMEOUT, follow_redirects=True) as client:
            response = client.get(url, headers=headers)
    except httpx.HTTPError as exc:
        raise ExternalAPIError(
            "Could not reach the Chess.com API.",
            {**(context or {}), "reason": str(exc)},
        ) from exc

    if response.status_code == 404:
        raise ExternalAPIError(
            "Chess.com has no such player or archive.",
            {**(context or {}), "status_code": 404},
        )

    if response.status_code == 403:
        raise ExternalAPIError(
            "Chess.com refused the request (HTTP 403). Its public API requires a "
            "descriptive User-Agent header; check the CHESSCOM_USER_AGENT setting.",
            {
                **(context or {}),
                "status_code": 403,
                "user_agent": settings.CHESSCOM_USER_AGENT,
            },
        )

    if response.status_code >= 400:
        raise ExternalAPIError(
            f"Chess.com API returned HTTP {response.status_code}.",
            {**(context or {}), "status_code": response.status_code},
        )

    try:
        payload = response.json()
    except ValueError as exc:
        raise ExternalAPIError(
            "Chess.com returned a response that was not valid JSON.",
            {**(context or {}), "reason": str(exc)},
        ) from exc

    if not isinstance(payload, dict):
        raise ExternalAPIError(
            "Chess.com returned an unexpected payload shape.", context or {}
        )
    return payload
