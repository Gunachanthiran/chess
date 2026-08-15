"""Import games from Lichess."""

from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.errors import ValidationError
from app.models.game import GameSource
from app.routers.games import create_game_from_pgn
from app.schemas.game import GameOut, GameResponse, LichessImportRequest
from app.services import lichess_client, pgn_service

router = APIRouter(prefix="/lichess", tags=["lichess"])

# The Site-header extraction moved to pgn_service so the bulk import task can
# share it; kept as a module-level name here for existing callers.
_game_id_from_pgn = pgn_service.lichess_game_id_from_pgn


@router.post("/import", response_model=GameResponse, status_code=status.HTTP_201_CREATED)
def import_game(
    payload: LichessImportRequest, db: Session = Depends(get_db)
) -> GameResponse:
    game_id = (payload.lichess_game_id or "").strip()
    username = (payload.username or "").strip()

    if game_id:
        pgn_text = lichess_client.fetch_game_pgn(game_id)
        lichess_game_id: str | None = game_id
    elif username:
        pgn_text = lichess_client.fetch_recent_game_pgn(username)
        lichess_game_id = _game_id_from_pgn(pgn_text)
    else:
        raise ValidationError(
            "Provide either 'lichess_game_id' or 'username'.",
            {"lichess_game_id": None, "username": None},
        )

    game = create_game_from_pgn(
        db, pgn_text, GameSource.lichess, lichess_game_id=lichess_game_id
    )
    return GameResponse(game=GameOut.model_validate(game))
