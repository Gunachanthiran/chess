"""Where your real errors actually happen: opening, middlegame, or endgame.

Phase is computed from data already stored per move (`fen_before`, `ply`) —
no new engine calls. Same split as `game_stats.py`/`opening_stats.py`: a
plain dataclass carrying exactly what the maths needs, and pure functions
doing the actual work, so "which side is mine" and "which phase is this"
are both unit-testable without a database.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import chess

from app.models.move_analysis import MoveClassification, Side

Phase = Literal["opening", "middlegame", "endgame"]
PHASES: tuple[Phase, ...] = ("opening", "middlegame", "endgame")

# First 10 full moves (20 plies) count as the opening outright, regardless of
# material — a queen trade on move 4 doesn't retroactively make moves 1-3
# not-the-opening, so this is judged on move number rather than material,
# unlike the endgame threshold below.
OPENING_PLY_CUTOFF = 20

# Combined non-pawn, non-king material still on the board (both sides, in
# pawn-units) at or below which a position counts as an endgame - roughly
# "each side has at most a rook and a minor piece, or equivalent" left.
# Deliberately about material, not move number: a queen trade on move 15
# genuinely starts an endgame, while a long, piece-heavy middlegame past
# move 40 does not, just because it ran long.
ENDGAME_MATERIAL_THRESHOLD = 16

_NON_PAWN_VALUES: dict[chess.PieceType, int] = {
    chess.KNIGHT: 3,
    chess.BISHOP: 3,
    chess.ROOK: 5,
    chess.QUEEN: 9,
}


def classify_phase(fen_before: str, ply: int) -> Phase:
    if ply <= OPENING_PLY_CUTOFF:
        return "opening"

    board = chess.Board(fen_before)
    total_non_pawn = sum(
        value
        * (
            chess.popcount(board.pieces_mask(piece_type, chess.WHITE))
            + chess.popcount(board.pieces_mask(piece_type, chess.BLACK))
        )
        for piece_type, value in _NON_PAWN_VALUES.items()
    )
    return "endgame" if total_non_pawn <= ENDGAME_MATERIAL_THRESHOLD else "middlegame"


@dataclass(frozen=True)
class PhaseStatsRow:
    """One of *your own* moves worth bucketing by phase - every move, not
    just the bad ones, since a rate (errors per 100 moves) needs both."""

    fen_before: str
    ply: int
    side: Side
    classification: MoveClassification
    white_name: str
    black_name: str
    imported_username: str | None


@dataclass(frozen=True)
class PhaseBreakdown:
    phase: Phase
    total_moves: int
    inaccuracies: int
    mistakes: int
    blunders: int

    @property
    def error_rate_pct(self) -> float:
        """(Inaccuracy + Mistake + Blunder) as a percentage of your moves in
        this phase - the denominator a raw error count is meaningless
        without: playing 400 endgame moves and 40 opening moves means more
        endgame errors is expected even at identical skill."""
        if self.total_moves == 0:
            return 0.0
        errors = self.inaccuracies + self.mistakes + self.blunders
        return 100.0 * errors / self.total_moves


def is_mine(row: PhaseStatsRow) -> bool:
    """Mirrors `game_stats.my_accuracy`/`opening_stats.my_result`'s matching
    rule exactly - case/whitespace-insensitive, exactly one side matches."""
    who = (row.imported_username or "").strip().lower()
    if not who:
        return False
    is_white = row.white_name.strip().lower() == who
    is_black = row.black_name.strip().lower() == who
    if is_white == is_black:
        return False
    my_side = Side.white if is_white else Side.black
    return row.side == my_side


_ERROR_CLASSIFICATIONS = (
    MoveClassification.inaccuracy,
    MoveClassification.mistake,
    MoveClassification.blunder,
)


def compute_phase_breakdown(rows: list[PhaseStatsRow]) -> list[PhaseBreakdown]:
    """One row per phase, in opening/middlegame/endgame order (unlike the
    other two reports here, phase has a natural, fixed order - not sorted
    by volume) - always all three, even at zero moves, so a caller never
    has to guess whether "endgame" is missing because you have none yet or
    because something broke."""
    totals: dict[Phase, int] = {phase: 0 for phase in PHASES}
    errors: dict[Phase, dict[MoveClassification, int]] = {
        phase: {c: 0 for c in _ERROR_CLASSIFICATIONS} for phase in PHASES
    }

    for row in rows:
        if not is_mine(row):
            continue
        phase = classify_phase(row.fen_before, row.ply)
        totals[phase] += 1
        if row.classification in _ERROR_CLASSIFICATIONS:
            errors[phase][row.classification] += 1

    return [
        PhaseBreakdown(
            phase=phase,
            total_moves=totals[phase],
            inaccuracies=errors[phase][MoveClassification.inaccuracy],
            mistakes=errors[phase][MoveClassification.mistake],
            blunders=errors[phase][MoveClassification.blunder],
        )
        for phase in PHASES
    ]
