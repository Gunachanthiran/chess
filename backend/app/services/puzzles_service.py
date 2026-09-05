"""Tactics-trainer puzzles: your own real Mistakes/Blunders, replayed.

Every position where *your* side played a Mistake or Blunder already has
everything a puzzle needs sitting in `move_analysis` — the position before
the move (`fen_before`) and the engine's actual best reply (`best_move_uci`)
— so this module is entirely selection/filtering, no new analysis.

Split into a pure, DB-free selection function (`select_puzzles`) and the
router's own query, the same shape as `game_stats.py`'s `compute_stats`/
`GameStatsRow` split: the "which side is mine, and which of their moves
qualify" logic is worth unit-testing without a live database in the way.
"""

from __future__ import annotations

import random
import uuid
from dataclasses import dataclass
from datetime import datetime

from app.models.move_analysis import MoveClassification, Side

# The two classifications worth drilling: a real, costly error. `inaccuracy`
# is deliberately excluded - it is common enough (every decent player racks
# up dozens) that including it would swamp the genuinely instructive
# mistakes/blunders with minor imprecision, diluting the trainer's value.
PUZZLE_CLASSIFICATIONS = (MoveClassification.mistake, MoveClassification.blunder)


@dataclass(frozen=True)
class PuzzleCandidate:
    """One move_analysis row worth considering as a puzzle, joined with
    just enough of its game to work out whose move it was."""

    move_analysis_id: uuid.UUID
    game_id: uuid.UUID
    fen_before: str
    played_san: str
    played_uci: str
    best_move_uci: str
    classification: MoveClassification
    side: Side
    white_name: str
    black_name: str
    imported_username: str | None
    opening_name: str | None
    played_at: datetime | None


def is_my_mistake(candidate: PuzzleCandidate) -> bool:
    """True when `candidate.side` is the `imported_username` side of its game.

    Mirrors `game_stats.my_accuracy`'s matching rule exactly (case/whitespace
    -insensitive, and only when *exactly one* side matches) — a puzzle drawn
    from the *opponent's* blunder would teach the wrong lesson entirely.
    """
    who = (candidate.imported_username or "").strip().lower()
    if not who:
        return False
    is_white = candidate.white_name.strip().lower() == who
    is_black = candidate.black_name.strip().lower() == who
    if is_white == is_black:
        return False
    my_side = Side.white if is_white else Side.black
    return candidate.side == my_side


def select_puzzles(
    candidates: list[PuzzleCandidate],
    limit: int,
    rng: random.Random | None = None,
) -> tuple[list[PuzzleCandidate], int]:
    """Filter to "my" mistakes/blunders, shuffle, and cap at `limit`.

    Returns `(selected, total_available)` — `total_available` is the full
    filtered count *before* the `limit` cut, so a caller can show "1 of 47"
    rather than just the batch size.

    Shuffled rather than newest-first: always drilling the same handful of
    most-recent blunders would make the trainer stale within a few sessions,
    and there is no per-user "already solved" state to draw on instead (this
    app has no accounts - see `game.py`'s own `imported_username` comment).
    """
    mine = [candidate for candidate in candidates if is_my_mistake(candidate)]
    (rng or random).shuffle(mine)
    return mine[:limit], len(mine)
