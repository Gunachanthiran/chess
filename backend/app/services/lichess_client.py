"""Thin client for the public Lichess API (no auth: public games only)."""

from __future__ import annotations

import httpx

from app.config import settings
from app.errors import ExternalAPIError, ValidationError

REQUEST_TIMEOUT = httpx.Timeout(20.0)


def fetch_game_pgn(lichess_game_id: str) -> str:
    """PGN for a single game id."""
    game_id = (lichess_game_id or "").strip()
    if not game_id:
        raise ValidationError("A Lichess game id is required.")

    url = f"{settings.LICHESS_API_BASE.rstrip('/')}/game/export/{game_id}"
    text = _get(url, params={"pgn": "true"}, context={"lichess_game_id": game_id})

    if not text.strip():
        raise ExternalAPIError(
            "Lichess returned an empty PGN.", {"lichess_game_id": game_id}
        )
    return text


def fetch_recent_game_pgn(username: str) -> str:
    """PGN for a user's most recent game."""
    user = (username or "").strip()
    if not user:
        raise ValidationError("A Lichess username is required.")

    url = f"{settings.LICHESS_API_BASE.rstrip('/')}/api/games/user/{user}"
    text = _get(
        url,
        params={"max": 1, "pgnInJson": "false"},
        headers={"Accept": "application/x-chess-pgn"},
        context={"username": user},
    )

    if not text.strip():
        raise ExternalAPIError(
            f"No games found on Lichess for user '{user}'.", {"username": user}
        )
    return text


def fetch_games_bulk_pgn(
    username: str,
    *,
    since_ms: int | None = None,
    until_ms: int | None = None,
    max_games: int = 100,
) -> str:
    """Multi-game PGN blob for a user's games, most recent first.

    Lichess streams the games back as PGN texts separated by blank lines; the
    blob is split into individual games by `pgn_service.split_pgn_games`.
    """
    user = (username or "").strip()
    if not user:
        raise ValidationError("A Lichess username is required.")

    params: dict = {"max": max_games, "pgnInJson": "false"}
    if since_ms is not None:
        params["since"] = since_ms
    if until_ms is not None:
        params["until"] = until_ms

    url = f"{settings.LICHESS_API_BASE.rstrip('/')}/api/games/user/{user}"
    return _get(
        url,
        params=params,
        headers={"Accept": "application/x-chess-pgn"},
        context={"username": user},
    )


def fetch_user_profile(username: str) -> dict:
    """Public Lichess profile: per-format `perfs` ratings, overall `count` W/L/D."""
    user = (username or "").strip()
    if not user:
        raise ValidationError("A Lichess username is required.")

    url = f"{settings.LICHESS_API_BASE.rstrip('/')}/api/user/{user}"
    return _get_json(url, context={"username": user})


def _get_json(url: str, *, context: dict | None = None) -> dict:
    """GET returning parsed JSON, mirroring `_get`'s error handling below."""
    headers = {
        "Accept": "application/json",
        "User-Agent": settings.LICHESS_USER_AGENT,
    }

    try:
        with httpx.Client(timeout=REQUEST_TIMEOUT, follow_redirects=True) as client:
            response = client.get(url, headers=headers)
    except httpx.HTTPError as exc:
        raise ExternalAPIError(
            "Could not reach the Lichess API.",
            {**(context or {}), "reason": str(exc)},
        ) from exc

    if response.status_code == 404:
        raise ExternalAPIError(
            "Lichess has no such user.", {**(context or {}), "status_code": 404}
        )

    if response.status_code >= 400:
        raise ExternalAPIError(
            f"Lichess API returned HTTP {response.status_code}.",
            {**(context or {}), "status_code": response.status_code},
        )

    try:
        payload = response.json()
    except ValueError as exc:
        raise ExternalAPIError(
            "Lichess returned a response that was not valid JSON.",
            {**(context or {}), "reason": str(exc)},
        ) from exc

    if not isinstance(payload, dict):
        raise ExternalAPIError(
            "Lichess returned an unexpected payload shape.", context or {}
        )
    return payload


def _get(
    url: str,
    *,
    params: dict | None = None,
    headers: dict | None = None,
    context: dict | None = None,
) -> str:
    """GET returning response text, with every failure mode as ExternalAPIError."""
    # Lichess serves a 404 HTML page to requests using an HTTP-library default
    # User-Agent; a descriptive one is required to reach the API at all.
    request_headers = {
        "Accept": "application/x-chess-pgn",
        "User-Agent": settings.LICHESS_USER_AGENT,
    }
    if headers:
        request_headers.update(headers)

    try:
        with httpx.Client(timeout=REQUEST_TIMEOUT, follow_redirects=True) as client:
            response = client.get(url, params=params, headers=request_headers)
    except httpx.HTTPError as exc:
        raise ExternalAPIError(
            "Could not reach the Lichess API.",
            {**(context or {}), "reason": str(exc)},
        ) from exc

    if response.status_code == 404:
        raise ExternalAPIError(
            "Lichess has no such game or user.",
            {**(context or {}), "status_code": 404},
        )

    if response.status_code >= 400:
        raise ExternalAPIError(
            f"Lichess API returned HTTP {response.status_code}.",
            {**(context or {}), "status_code": response.status_code},
        )

    return response.text
