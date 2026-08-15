"""Lichess OAuth2 login (authorization code + PKCE).

Lichess's OAuth2 implementation is designed for public clients: there is no
client secret to register in advance, just an identifying `client_id` string
and a PKCE challenge/verifier pair, which is what actually secures the flow
(see https://lichess.org/api#tag/OAuth). This is what makes a real "Continue
with Lichess" login possible for a self-hosted app with no developer
credentials on file — unlike Chess.com, which has no equivalent for
third-party apps at all (see app/routers/auth.py's Chess.com connect path).

The access token this module produces is used exactly once, in-memory, to
confirm the logged-in Lichess username via `fetch_account_username` — it is
never persisted. There is nothing here to refresh and nothing at rest to leak.
"""

from __future__ import annotations

import base64
import hashlib
import secrets

import httpx

from app.config import settings
from app.errors import ExternalAPIError

REQUEST_TIMEOUT = httpx.Timeout(20.0)

AUTHORIZE_URL = "https://lichess.org/oauth"
TOKEN_URL = "https://lichess.org/api/token"
ACCOUNT_URL = "https://lichess.org/api/account"


def generate_pkce_pair() -> tuple[str, str]:
    """`(code_verifier, code_challenge)` for the `S256` PKCE method.

    `code_verifier` is a high-entropy random string kept server-side (see
    `LichessOAuthState`); `code_challenge` is its SHA-256 hash, sent to Lichess
    up front so it can later confirm the same client that started the flow is
    the one completing it.
    """
    code_verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    code_challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return code_verifier, code_challenge


def generate_state() -> str:
    """Opaque CSRF token, round-tripped through Lichess and back."""
    return secrets.token_urlsafe(32)


def build_authorize_url(*, state: str, code_challenge: str, redirect_uri: str) -> str:
    """The URL to send the browser to. No `scope` is requested — the only
    thing this app reads is the authenticated username via `/api/account`,
    which needs no special permission."""
    params = {
        "response_type": "code",
        "client_id": settings.LICHESS_OAUTH_CLIENT_ID,
        "redirect_uri": redirect_uri,
        "code_challenge_method": "S256",
        "code_challenge": code_challenge,
        "state": state,
    }
    return f"{AUTHORIZE_URL}?{httpx.QueryParams(params)}"


def exchange_code_for_token(*, code: str, code_verifier: str, redirect_uri: str) -> str:
    """Trades the authorization code for an access token. Raises
    `ExternalAPIError` on anything Lichess doesn't answer with a token."""
    try:
        with httpx.Client(timeout=REQUEST_TIMEOUT) as client:
            response = client.post(
                TOKEN_URL,
                json={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": redirect_uri,
                    "client_id": settings.LICHESS_OAUTH_CLIENT_ID,
                    "code_verifier": code_verifier,
                },
                headers={"Accept": "application/json"},
            )
    except httpx.HTTPError as exc:
        raise ExternalAPIError(
            "Could not reach Lichess to complete login.", {"reason": str(exc)}
        ) from exc

    if response.status_code >= 400:
        raise ExternalAPIError(
            "Lichess rejected the login request.",
            {"status_code": response.status_code},
        )

    try:
        payload = response.json()
    except ValueError as exc:
        raise ExternalAPIError(
            "Lichess returned a response that was not valid JSON.",
            {"reason": str(exc)},
        ) from exc

    access_token = payload.get("access_token")
    if not isinstance(access_token, str) or not access_token:
        raise ExternalAPIError(
            "Lichess did not return an access token.", {"payload_keys": list(payload)}
        )
    return access_token


def fetch_account_username(access_token: str) -> str:
    """The logged-in Lichess account's username, using the just-issued token."""
    try:
        with httpx.Client(timeout=REQUEST_TIMEOUT) as client:
            response = client.get(
                ACCOUNT_URL,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Accept": "application/json",
                },
            )
    except httpx.HTTPError as exc:
        raise ExternalAPIError(
            "Could not reach Lichess to confirm the logged-in account.",
            {"reason": str(exc)},
        ) from exc

    if response.status_code >= 400:
        raise ExternalAPIError(
            "Lichess rejected the account lookup.",
            {"status_code": response.status_code},
        )

    try:
        payload = response.json()
    except ValueError as exc:
        raise ExternalAPIError(
            "Lichess returned a response that was not valid JSON.",
            {"reason": str(exc)},
        ) from exc

    username = payload.get("username")
    if not isinstance(username, str) or not username:
        raise ExternalAPIError(
            "Lichess's account response had no username.", {"payload_keys": list(payload)}
        )
    return username
