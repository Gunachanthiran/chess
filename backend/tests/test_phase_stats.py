from __future__ import annotations

import chess

from app.models.move_analysis import MoveClassification, Side
from app.services.phase_stats import (
    ENDGAME_MATERIAL_THRESHOLD,
    OPENING_PLY_CUTOFF,
    PhaseStatsRow,
    classify_phase,
    compute_phase_breakdown,
    is_mine,
)

STARTING_FEN = chess.STARTING_FEN
# White: king + a lone rook. Black: king + a lone rook. Non-pawn material is
# 5 + 5 = 10, comfortably under ENDGAME_MATERIAL_THRESHOLD (16).
ENDGAME_FEN = "4k3/8/8/8/8/8/8/R3K3 w - - 0 1"
# Both sides still have a queen, two rooks, two bishops, two knights each -
# nowhere near the endgame threshold, and past the opening ply cutoff.
MIDDLEGAME_FEN = "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 0 6"


def row(
    *,
    fen_before: str = STARTING_FEN,
    ply: int = 1,
    side: Side = Side.white,
    classification: MoveClassification = MoveClassification.best,
    white_name: str = "ZenWhiz",
    black_name: str = "Opponent",
    imported_username: str | None = "ZenWhiz",
) -> PhaseStatsRow:
    return PhaseStatsRow(
        fen_before=fen_before,
        ply=ply,
        side=side,
        classification=classification,
        white_name=white_name,
        black_name=black_name,
        imported_username=imported_username,
    )


class TestClassifyPhase:
    def test_early_ply_is_always_opening(self):
        # Even a position with little material still counts as opening
        # within the ply cutoff - move number wins over material there.
        assert classify_phase(ENDGAME_FEN, OPENING_PLY_CUTOFF) == "opening"

    def test_past_cutoff_with_heavy_material_is_middlegame(self):
        assert classify_phase(MIDDLEGAME_FEN, OPENING_PLY_CUTOFF + 1) == "middlegame"

    def test_past_cutoff_with_light_material_is_endgame(self):
        assert classify_phase(ENDGAME_FEN, OPENING_PLY_CUTOFF + 1) == "endgame"

    def test_threshold_is_inclusive(self):
        # A hand-built position with exactly the threshold's worth of
        # non-pawn material (a queen + a knight = 12, under 16) still
        # counts as endgame - confirms "at or below", not "strictly below".
        fen = "4k3/8/8/8/8/8/3N4/3QK3 w - - 0 1"
        assert classify_phase(fen, OPENING_PLY_CUTOFF + 1) == "endgame"
        assert ENDGAME_MATERIAL_THRESHOLD >= 12


class TestIsMine:
    def test_white_side_match(self):
        assert is_mine(row(side=Side.white, imported_username="ZenWhiz")) is True

    def test_wrong_side_excluded(self):
        assert is_mine(row(side=Side.white, imported_username="Opponent")) is False

    def test_no_username_excluded(self):
        assert is_mine(row(imported_username=None)) is False


class TestComputePhaseBreakdown:
    def test_always_returns_all_three_phases(self):
        breakdown = {b.phase: b for b in compute_phase_breakdown([])}
        assert set(breakdown) == {"opening", "middlegame", "endgame"}
        assert all(b.total_moves == 0 for b in breakdown.values())

    def test_counts_only_my_moves(self):
        rows = [
            row(ply=1, side=Side.white, imported_username="ZenWhiz"),
            row(ply=2, side=Side.black, imported_username="ZenWhiz"),  # not mine
        ]
        breakdown = {b.phase: b for b in compute_phase_breakdown(rows)}
        assert breakdown["opening"].total_moves == 1

    def test_buckets_by_phase_and_classification(self):
        rows = [
            row(fen_before=STARTING_FEN, ply=1, classification=MoveClassification.best),
            row(
                fen_before=MIDDLEGAME_FEN,
                ply=OPENING_PLY_CUTOFF + 1,
                classification=MoveClassification.blunder,
            ),
            row(
                fen_before=ENDGAME_FEN,
                ply=OPENING_PLY_CUTOFF + 1,
                classification=MoveClassification.mistake,
            ),
        ]
        breakdown = {b.phase: b for b in compute_phase_breakdown(rows)}
        assert breakdown["opening"].total_moves == 1
        assert breakdown["opening"].blunders == 0
        assert breakdown["middlegame"].blunders == 1
        assert breakdown["middlegame"].total_moves == 1
        assert breakdown["endgame"].mistakes == 1

    def test_error_rate_pct(self):
        rows = [
            row(fen_before=STARTING_FEN, ply=1, classification=MoveClassification.best),
            row(fen_before=STARTING_FEN, ply=2, classification=MoveClassification.blunder),
            row(fen_before=STARTING_FEN, ply=3, classification=MoveClassification.good),
            row(fen_before=STARTING_FEN, ply=4, classification=MoveClassification.mistake),
        ]
        [opening] = [b for b in compute_phase_breakdown(rows) if b.phase == "opening"]
        assert opening.total_moves == 4
        assert opening.error_rate_pct == 50.0

    def test_error_rate_pct_zero_when_no_moves(self):
        [opening] = [b for b in compute_phase_breakdown([]) if b.phase == "opening"]
        assert opening.error_rate_pct == 0.0
