"""Tactics trainer: replay your own real Mistakes/Blunders as puzzles."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

import chess

from app.db import get_db
from app.models.analysis_job import AnalysisJob, JobStatus
from app.models.game import Game
from app.models.move_analysis import MoveAnalysis
from app.schemas.puzzle import PuzzleListResponse, PuzzleOut
from app.services.puzzles_service import (
    PUZZLE_CLASSIFICATIONS,
    PuzzleCandidate,
    select_puzzles,
)

router = APIRouter(prefix="/puzzles", tags=["puzzles"])


def _correct_san(fen_before: str, best_move_uci: str) -> str:
    """SAN for the engine's actual best move, computed here (not stored)
    since `move_analysis.best_move_uci` was added long before this feature
    and every existing row already has the UCI - recomputing SAN from
    `fen_before` needs no backfill and can never drift from it."""
    board = chess.Board(fen_before)
    move = chess.Move.from_uci(best_move_uci)
    return board.san(move)


@router.get("", response_model=PuzzleListResponse)
def list_puzzles(
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> PuzzleListResponse:
    """A random batch of up to `limit` puzzles drawn from every Mistake/
    Blunder your own side has ever played, across every analysed game.

    One query for every candidate row rather than paging in the database:
    the actual "is this mine" filter (`select_puzzles`/`is_my_mistake`) needs
    each side's name compared against `imported_username`, which isn't
    something a `WHERE` clause can express alongside "exactly one side
    matches" cleanly - the same reason `game_stats.compute_stats` filters in
    Python. A personal analysis history's total mistake+blunder count is a
    few hundred at most, not a scale where this matters.
    """
    rows = db.execute(
        select(MoveAnalysis, Game)
        .join(AnalysisJob, MoveAnalysis.job_id == AnalysisJob.id)
        .join(Game, AnalysisJob.game_id == Game.id)
        .where(AnalysisJob.status == JobStatus.completed)
        .where(MoveAnalysis.classification.in_(PUZZLE_CLASSIFICATIONS))
    ).all()

    candidates = [
        PuzzleCandidate(
            move_analysis_id=move.id,
            game_id=game.id,
            fen_before=move.fen_before,
            played_san=move.san,
            played_uci=move.uci,
            best_move_uci=move.best_move_uci,
            classification=move.classification,
            side=move.side,
            white_name=game.white_name,
            black_name=game.black_name,
            imported_username=game.imported_username,
            opening_name=game.opening_name,
            played_at=game.played_at,
        )
        for move, game in rows
    ]

    selected, total_available = select_puzzles(candidates, limit)

    return PuzzleListResponse(
        puzzles=[
            PuzzleOut(
                id=candidate.move_analysis_id,
                game_id=candidate.game_id,
                fen=candidate.fen_before,
                side_to_move=candidate.side,
                played_san=candidate.played_san,
                played_uci=candidate.played_uci,
                correct_uci=candidate.best_move_uci,
                correct_san=_correct_san(candidate.fen_before, candidate.best_move_uci),
                classification=candidate.classification,
                opening_name=candidate.opening_name,
                white_name=candidate.white_name,
                black_name=candidate.black_name,
                played_at=candidate.played_at,
            )
            for candidate in selected
        ],
        total_available=total_available,
    )
