"""Play against the Tal-style bot."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.errors import NotFoundError
from app.models.bot_game import BotGame
from app.routers.games import parse_uuid
from app.schemas.bot_game import (
    BotGameOut,
    BotGameResponse,
    BotGameSummaryListResponse,
    BotGameSummaryOut,
    CreateBotGameRequest,
    SubmitBotMoveRequest,
)
from app.services import bot_game_service

router = APIRouter(prefix="/bot-games", tags=["bot-games"])


def _response(bot_game: BotGame) -> BotGameResponse:
    """Serialise a game, adding the opening it is currently in.

    Every endpoint goes through here so the indicator can never be present on
    one response shape and missing from another (a page reload hits GET, not
    POST, and would otherwise lose the opening it was just showing).
    """
    out = BotGameOut.model_validate(bot_game)
    out.opening_eco, out.opening_name = bot_game_service.current_opening(bot_game)
    out.gambit_name, out.gambit_status, out.opponent_style, out.bot_strategy_summary = (
        bot_game_service.strategy_status(bot_game)
    )
    return BotGameResponse(bot_game=out)


def _get_bot_game(db: Session, bot_game_id: str) -> BotGame:
    bot_game = db.get(BotGame, parse_uuid(bot_game_id, "bot_game_id"))
    if bot_game is None:
        raise NotFoundError("Bot game not found.", {"bot_game_id": bot_game_id})
    return bot_game


@router.post("", response_model=BotGameResponse, status_code=status.HTTP_201_CREATED)
def create_bot_game(
    payload: CreateBotGameRequest, db: Session = Depends(get_db)
) -> BotGameResponse:
    bot_game = bot_game_service.create_bot_game(
        db,
        player_color=payload.player_color,
        bot_elo=payload.bot_elo,
        bot_aggression=payload.bot_aggression,
        gambit_id=payload.gambit_id,
        adapt_to_opponent=payload.adapt_to_opponent,
        full_attack_mode=payload.full_attack_mode,
    )
    return _response(bot_game)


@router.get("", response_model=BotGameSummaryListResponse)
def list_bot_games(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> BotGameSummaryListResponse:
    """Most-recently-active first — powers the dashboard's Bots tab and its
    "game in progress" banner (the first `in_progress` row, if any)."""
    total = db.scalar(select(func.count()).select_from(BotGame)) or 0
    bot_games = (
        db.scalars(
            select(BotGame)
            # One extra query for every row's moves, not one per row —
            # `current_opening()` needs them to compute the live opening.
            .options(selectinload(BotGame.moves))
            .order_by(BotGame.updated_at.desc())
            .limit(limit)
            .offset(offset)
        )
        .unique()
        .all()
    )

    summaries = []
    for bot_game in bot_games:
        eco, name = bot_game_service.current_opening(bot_game)
        gambit_name, _status, _tags, _summary = bot_game_service.strategy_status(bot_game)
        summaries.append(
            BotGameSummaryOut.model_validate(bot_game).model_copy(
                update={
                    "move_count": len(bot_game.moves),
                    "opening_eco": eco,
                    "opening_name": name,
                    "gambit_name": gambit_name,
                }
            )
        )

    return BotGameSummaryListResponse(bot_games=summaries, total=total)


@router.get("/{bot_game_id}", response_model=BotGameResponse)
def get_bot_game(bot_game_id: str, db: Session = Depends(get_db)) -> BotGameResponse:
    bot_game = _get_bot_game(db, bot_game_id)
    return _response(bot_game)


@router.post("/{bot_game_id}/moves", response_model=BotGameResponse)
def submit_bot_game_move(
    bot_game_id: str, payload: SubmitBotMoveRequest, db: Session = Depends(get_db)
) -> BotGameResponse:
    bot_game = _get_bot_game(db, bot_game_id)
    bot_game = bot_game_service.submit_player_move(db, bot_game, payload.uci)
    return _response(bot_game)


@router.post("/{bot_game_id}/undo", response_model=BotGameResponse)
def undo_bot_game_move(bot_game_id: str, db: Session = Depends(get_db)) -> BotGameResponse:
    bot_game = _get_bot_game(db, bot_game_id)
    bot_game = bot_game_service.undo_last_move(db, bot_game)
    return _response(bot_game)


@router.post("/{bot_game_id}/claim-draw", response_model=BotGameResponse)
def claim_bot_game_draw(bot_game_id: str, db: Session = Depends(get_db)) -> BotGameResponse:
    bot_game = _get_bot_game(db, bot_game_id)
    bot_game = bot_game_service.claim_draw(db, bot_game)
    return _response(bot_game)


@router.post("/{bot_game_id}/resign", response_model=BotGameResponse)
def resign_bot_game(bot_game_id: str, db: Session = Depends(get_db)) -> BotGameResponse:
    bot_game = _get_bot_game(db, bot_game_id)
    bot_game = bot_game_service.resign(db, bot_game)
    return _response(bot_game)
