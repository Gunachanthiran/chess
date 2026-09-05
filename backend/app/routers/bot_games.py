"""Play against the Tal-style bot."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.errors import ConflictError, NotFoundError
from app.models.analysis_job import AnalysisJob, JobStatus
from app.models.bot_game import BotGame, BotGameStatus
from app.models.game import Game, GameSource
from app.models.move_analysis import MoveAnalysis
from app.routers.games import parse_uuid
from app.schemas.analysis_job import AnalysisJobOut, AnalysisJobResponse
from app.schemas.bot_game import (
    BotAccuracyPointOut,
    BotGameOut,
    BotGameResponse,
    BotGameSummaryListResponse,
    BotGameSummaryOut,
    BotPerformanceOut,
    BotPhaseBreakdownOut,
    CreateBotGameRequest,
    SubmitBotMoveRequest,
)
from app.services import bot_game_service
from app.services.bot_performance_stats import (
    BotAnalysisRow,
    compute_bot_accuracy_trend,
    compute_bot_classification_breakdown,
    compute_bot_phase_breakdown,
    compute_bot_record,
)
from app.services.game_service import create_game_from_pgn
from app.tasks.analyze_game import analyze_game

# How many of the most recent analysed bot games the performance dashboard's
# accuracy trend plots - same window as game_stats.py's own accuracy_trend.
BOT_ACCURACY_TREND_WINDOW = 30

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


@router.get("/performance", response_model=BotPerformanceOut)
def bot_performance(db: Session = Depends(get_db)) -> BotPerformanceOut:
    """How the Tal bot itself is actually playing, across every analysed
    bot game (see services/bot_performance_stats.py) - registered before
    `/{bot_game_id}` below, otherwise FastAPI would match "performance" as
    a `bot_game_id` and fail UUID parsing.

    Identifies a bot game the same way pgn_for_analysis names it - a
    "Tal Bot (...)" prefix on whichever side isn't "You" - not by any
    stored reference back to the originating `bot_games` row, since
    exporting to `games`/`move_analysis` (see bot_games.py's own
    `/analyze` endpoint) never kept one.
    """
    rows = db.execute(
        select(MoveAnalysis, Game, AnalysisJob.white_accuracy, AnalysisJob.black_accuracy)
        .join(AnalysisJob, MoveAnalysis.job_id == AnalysisJob.id)
        .join(Game, AnalysisJob.game_id == Game.id)
        .where(AnalysisJob.status == JobStatus.completed)
    ).all()

    analysis_rows = [
        BotAnalysisRow(
            game_id=game.id,
            ply=move.ply,
            side=move.side,
            classification=move.classification,
            fen_before=move.fen_before,
            white_name=game.white_name,
            black_name=game.black_name,
            result=game.result,
            played_at=game.played_at,
            white_accuracy=white_accuracy,
            black_accuracy=black_accuracy,
        )
        for move, game, white_accuracy, black_accuracy in rows
    ]

    record = compute_bot_record(analysis_rows)
    classification_counts = compute_bot_classification_breakdown(analysis_rows)
    phases = compute_bot_phase_breakdown(analysis_rows)
    trend = compute_bot_accuracy_trend(analysis_rows, BOT_ACCURACY_TREND_WINDOW)

    return BotPerformanceOut(
        games=record.games,
        wins=record.wins,
        losses=record.losses,
        draws=record.draws,
        score_pct=record.score_pct,
        avg_accuracy=record.avg_accuracy,
        classification_counts={c.value: n for c, n in classification_counts.items()},
        phases=[
            BotPhaseBreakdownOut(
                phase=p.phase,
                total_moves=p.total_moves,
                inaccuracies=p.inaccuracies,
                mistakes=p.mistakes,
                blunders=p.blunders,
                error_rate_pct=p.error_rate_pct,
            )
            for p in phases
        ],
        accuracy_trend=[
            BotAccuracyPointOut(played_at=p.played_at, accuracy=p.accuracy) for p in trend
        ],
    )


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


@router.post(
    "/{bot_game_id}/analyze",
    response_model=AnalysisJobResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def analyze_bot_game(bot_game_id: str, db: Session = Depends(get_db)) -> AnalysisJobResponse:
    """Runs a real Stockfish analysis on a finished bot game — the exact same
    pipeline (`AnalysisJob` + the `analyze_game` Celery task) an uploaded or
    imported game gets, via `bot_game_service.pgn_for_analysis` +
    `create_game_from_pgn`. This mints a brand new `games` row every call
    rather than tracking "already analysed" on the bot game itself — a second
    click makes a second analysed copy, the same way re-uploading a PGN
    would; there is no external game id here for the existing upload/import
    dedup logic to key off.
    """
    bot_game = _get_bot_game(db, bot_game_id)
    if bot_game.status is BotGameStatus.in_progress:
        raise ConflictError(
            "This game is still in progress — finish or resign it before analysing.",
            {"bot_game_id": bot_game_id},
        )

    pgn_text = bot_game_service.pgn_for_analysis(bot_game)
    # `pgn_service.parse_pgn` (reached via `create_game_from_pgn`) is what
    # actually rejects a genuinely move-less game — a `ValidationError` from
    # there ("PGN contains no moves") surfaces to the caller unchanged rather
    # than being re-checked here.
    #
    # `imported_username="You"` matches the literal White/Black header
    # `pgn_for_analysis` always gives the human side, regardless of colour -
    # without this, the resulting `games` row has no `imported_username` at
    # all, and every "which side is mine" computation across the app
    # (game_stats.my_accuracy, opening_stats.my_result,
    # puzzles_service.is_my_mistake - all matching on this same field) would
    # silently exclude every bot game from dashboard stats, the opening
    # report, the accuracy trend, and the tactics trainer. Confirmed as a
    # real gap: a bot game analysed before this fix genuinely had no
    # resolvable side, which is why a heavily-bot-played account still saw
    # almost nothing in the tactics trainer.
    game = create_game_from_pgn(db, pgn_text, GameSource.upload, imported_username="You")

    job = AnalysisJob(game_id=game.id, status=JobStatus.pending, progress_pct=0)
    db.add(job)
    db.commit()
    db.refresh(job)

    async_result = analyze_game.delay(str(job.id))
    job.celery_task_id = async_result.id
    db.commit()
    db.refresh(job)

    return AnalysisJobResponse(job=AnalysisJobOut.model_validate(job))
