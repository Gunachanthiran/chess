"""Login: Lichess OAuth, Chess.com username connect.

Single-user, self-hosted scope — see the login-flow plan. "Status" is a
property of the database, not a browser session: whoever can reach this
server already has full access to every other endpoint, the same trust model
the rest of the app already uses.
"""

from __future__ import annotations

import logging
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.errors import ChessScopeError
from app.models.account_connection import AccountConnection, LichessOAuthState
from app.models.game import GameSource
from app.schemas.auth import (
    AuthStatusResponse,
    ConnectChessComRequest,
    ConnectionOut,
    ConnectResponse,
)
from app.services import account_connections, chesscom_client, lichess_oauth

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

LICHESS_CALLBACK_PATH = "/api/auth/lichess/callback"


def _redirect_uri() -> str:
    return f"{settings.BACKEND_BASE_URL.rstrip('/')}{LICHESS_CALLBACK_PATH}"


def _frontend_url(path: str, **params: str) -> str:
    base = settings.FRONTEND_BASE_URL.rstrip("/")
    query = f"?{urlencode(params)}" if params else ""
    return f"{base}{path}{query}"


def _connection_out(connection: AccountConnection | None) -> ConnectionOut | None:
    return ConnectionOut.model_validate(connection) if connection is not None else None


@router.get("/status", response_model=AuthStatusResponse)
def get_status(db: Session = Depends(get_db)) -> AuthStatusResponse:
    connections = account_connections.get_status(db)
    return AuthStatusResponse(
        lichess=_connection_out(connections.get(GameSource.lichess)),
        chess_com=_connection_out(connections.get(GameSource.chess_com)),
    )


@router.get("/lichess/start")
def lichess_start(db: Session = Depends(get_db)) -> RedirectResponse:
    """Redirects the browser to Lichess. Must be reached via a real top-level
    navigation (an `<a href>`, not `fetch`) — the whole point is that Lichess's
    own login/consent page has to actually render in the browser."""
    code_verifier, code_challenge = lichess_oauth.generate_pkce_pair()
    state = lichess_oauth.generate_state()

    db.add(LichessOAuthState(state=state, code_verifier=code_verifier))
    db.commit()

    url = lichess_oauth.build_authorize_url(
        state=state, code_challenge=code_challenge, redirect_uri=_redirect_uri()
    )
    return RedirectResponse(url, status_code=status.HTTP_307_TEMPORARY_REDIRECT)


@router.get("/lichess/callback")
def lichess_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
) -> RedirectResponse:
    """Lichess redirects here after the user approves (or denies) the login.

    Every failure path redirects back to `/login?error=...` instead of
    returning a JSON error response — a human's browser lands on this URL
    directly, not client code that could parse a `{error, message}` body.
    """
    if error:
        return RedirectResponse(_frontend_url("/login", error=error))

    if not code or not state:
        return RedirectResponse(
            _frontend_url("/login", error="Lichess did not return a login code.")
        )

    pending = db.get(LichessOAuthState, state)
    if pending is None:
        return RedirectResponse(
            _frontend_url("/login", error="This login attempt expired. Please try again.")
        )

    # One-time use: consumed here regardless of what happens next below.
    code_verifier = pending.code_verifier
    db.delete(pending)
    db.commit()

    try:
        access_token = lichess_oauth.exchange_code_for_token(
            code=code, code_verifier=code_verifier, redirect_uri=_redirect_uri()
        )
        username = lichess_oauth.fetch_account_username(access_token)
        account_connections.upsert_connection(db, GameSource.lichess, username)
        job = account_connections.trigger_bulk_import(db, GameSource.lichess, username)
    except ChessScopeError as exc:
        logger.warning("Lichess login failed: %s", exc.message)
        return RedirectResponse(_frontend_url("/login", error=exc.message))

    # Straight to the dashboard, which renders the existing import-progress
    # panel whenever `import_job` is present in the query string.
    return RedirectResponse(_frontend_url("/", import_job=str(job.id)))


@router.post(
    "/chesscom/connect", response_model=ConnectResponse, status_code=status.HTTP_201_CREATED
)
def chesscom_connect(
    payload: ConnectChessComRequest, db: Session = Depends(get_db)
) -> ConnectResponse:
    """Chess.com has no OAuth for third-party apps, so this is username-only —
    no password is ever asked. Confirming the username is real up front (the
    same lookup the bulk import would make anyway) turns a bad username into a
    clean validation error instead of a doomed import job."""
    chesscom_client.fetch_archive_urls(payload.username)

    account_connections.upsert_connection(db, GameSource.chess_com, payload.username)
    job = account_connections.trigger_bulk_import(db, GameSource.chess_com, payload.username)
    return ConnectResponse(job_id=job.id, username=payload.username)


@router.delete("/lichess", status_code=status.HTTP_204_NO_CONTENT)
def disconnect_lichess(db: Session = Depends(get_db)) -> None:
    account_connections.remove_connection(db, GameSource.lichess)


@router.delete("/chesscom", status_code=status.HTTP_204_NO_CONTENT)
def disconnect_chesscom(db: Session = Depends(get_db)) -> None:
    account_connections.remove_connection(db, GameSource.chess_com)
