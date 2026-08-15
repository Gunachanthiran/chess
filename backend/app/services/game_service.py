"""Creation of `games` rows from PGN text, shared by the routers and the tasks.

This lives in a service rather than in `app/routers/games.py` because the bulk
import Celery task needs it too, and a task importing a router would invert the
dependency direction (`routers/imports.py -> tasks/bulk_import.py -> routers/games.py`).
Both routers and the task now import from here.

**Dedup.** Bulk imports routinely re-fetch games that were imported on an earlier
run, so an import of an external game id that is already stored returns the
stored row instead of inserting a second copy. Two layers:

1. a lookup before the insert (handles the normal case), and
2. partial unique indexes on `lichess_game_id` / `chess_com_game_id` (migration
   0003), which turn a lost race between two concurrent workers into an
   `IntegrityError` that is caught here and resolved by re-querying.
"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.game import Game, GameSource
from app.services import pgn_service
from app.services.pgn_service import ParsedGame

logger = logging.getLogger(__name__)


def find_existing_game(
    db: Session,
    *,
    lichess_game_id: str | None = None,
    chess_com_game_id: str | None = None,
) -> Game | None:
    """The already-stored game for an external id, if there is one.

    Deliberately keyed on the external id alone and not on (source, id): that is
    exactly what the partial unique indexes enforce, so the pre-insert lookup and
    the post-IntegrityError lookup can never disagree with the database.
    """
    if lichess_game_id:
        return db.scalars(
            select(Game).where(Game.lichess_game_id == lichess_game_id).limit(1)
        ).first()
    if chess_com_game_id:
        return db.scalars(
            select(Game).where(Game.chess_com_game_id == chess_com_game_id).limit(1)
        ).first()
    return None


def import_game_from_pgn(
    db: Session,
    pgn_text: str,
    source: GameSource,
    lichess_game_id: str | None = None,
    chess_com_game_id: str | None = None,
    imported_username: str | None = None,
) -> tuple[Game, bool]:
    """Create (or find) the game for a PGN. Returns `(game, created)`.

    `created` is False when the game was already stored under the same external
    id - callers count those as skipped rather than imported.
    """
    existing = find_existing_game(
        db,
        lichess_game_id=lichess_game_id,
        chess_com_game_id=chess_com_game_id,
    )
    if existing is not None:
        return existing, False

    parsed: ParsedGame = pgn_service.parse_pgn(pgn_text)

    game = Game(
        source=source,
        lichess_game_id=lichess_game_id,
        chess_com_game_id=chess_com_game_id,
        imported_username=imported_username,
        pgn=parsed.pgn,
        white_name=parsed.white_name,
        black_name=parsed.black_name,
        white_elo=parsed.white_elo,
        black_elo=parsed.black_elo,
        result=parsed.result,
        eco=parsed.eco,
        opening_name=parsed.opening_name,
        played_at=parsed.played_at,
    )
    db.add(game)

    try:
        db.commit()
    except IntegrityError:
        # Another worker inserted the same external id between the lookup above
        # and this commit. The unique index did its job; adopt their row.
        db.rollback()
        existing = find_existing_game(
            db,
            lichess_game_id=lichess_game_id,
            chess_com_game_id=chess_com_game_id,
        )
        if existing is None:
            raise
        logger.info(
            "Concurrent insert for external game id %s; reusing existing row %s",
            lichess_game_id or chess_com_game_id,
            existing.id,
        )
        return existing, False

    db.refresh(game)
    return game, True


def create_game_from_pgn(
    db: Session,
    pgn_text: str,
    source: GameSource,
    lichess_game_id: str | None = None,
    chess_com_game_id: str | None = None,
    imported_username: str | None = None,
) -> Game:
    """Shared creation path for uploads, single imports and bulk imports."""
    game, _created = import_game_from_pgn(
        db,
        pgn_text,
        source,
        lichess_game_id=lichess_game_id,
        chess_com_game_id=chess_com_game_id,
        imported_username=imported_username,
    )
    return game
