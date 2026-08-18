"""Tests for move classification: one case per tier, plus the override rules."""

import chess
import pytest

from app.models.move_analysis import MoveClassification
from app.services.classification import (
    classify_move,
    is_material_sacrifice,
    material_for,
)


def classify(**overrides) -> MoveClassification:
    """classify_move with sensible neutral defaults."""
    kwargs = {
        "win_pct_drop": 0.0,
        "cp_loss": 0,
        "legal_move_count": 30,
        "second_best_gap_cp": 20,
        "is_book": False,
        "is_sacrifice": False,
        "win_pct_before": 50.0,
        "ply": 20,
    }
    kwargs.update(overrides)
    return classify_move(**kwargs)


class TestForced:
    def test_single_legal_move_is_forced(self):
        assert classify(legal_move_count=1, win_pct_drop=40.0) is MoveClassification.forced

    def test_forced_beats_every_other_tier(self):
        # Even a book-looking, blundering move is forced if it is the only one.
        assert (
            classify(legal_move_count=1, is_book=True, ply=2, win_pct_drop=90.0)
            is MoveClassification.forced
        )

    def test_huge_gap_to_second_best_is_forced(self):
        assert classify(second_best_gap_cp=501) is MoveClassification.forced

    def test_gap_exactly_at_threshold_is_not_forced(self):
        # Not forced (the >500 threshold is strict) but still a big enough
        # gap over GREAT_GAP_CP (150) to count as "great" rather than plain
        # "best" — see TestGreat below for the tier's own dedicated tests.
        assert classify(second_best_gap_cp=500) is MoveClassification.great

    def test_missing_gap_information_is_not_forced(self):
        assert classify(second_best_gap_cp=None) is MoveClassification.best


class TestBook:
    def test_book_move_in_the_opening(self):
        assert classify(is_book=True, ply=6, win_pct_drop=3.0) is MoveClassification.book

    def test_book_at_the_last_allowed_ply(self):
        assert classify(is_book=True, ply=12) is MoveClassification.book

    def test_past_the_book_window_falls_through_to_the_bands(self):
        assert (
            classify(is_book=True, ply=13, win_pct_drop=3.0) is MoveClassification.good
        )

    def test_book_outranks_a_middling_band(self):
        # A 7-point drop would be an inaccuracy, but theory says it is fine.
        assert classify(is_book=True, ply=4, win_pct_drop=7.0) is MoveClassification.book


class TestBands:
    @pytest.mark.parametrize(
        ("drop", "expected"),
        [
            (0.0, MoveClassification.best),
            (1.0, MoveClassification.best),
            (1.5, MoveClassification.excellent),
            (2.0, MoveClassification.excellent),
            (3.5, MoveClassification.good),
            (5.0, MoveClassification.good),
            (7.0, MoveClassification.inaccuracy),
            (10.0, MoveClassification.inaccuracy),
            (15.0, MoveClassification.mistake),
            (20.0, MoveClassification.mistake),
            (20.1, MoveClassification.blunder),
            (60.0, MoveClassification.blunder),
        ],
    )
    def test_win_percent_drop_bands(self, drop, expected):
        assert classify(win_pct_drop=drop) is expected


class TestBrilliant:
    def test_sound_sacrifice_while_winning_is_brilliant(self):
        assert (
            classify(win_pct_drop=0.0, is_sacrifice=True, win_pct_before=70.0)
            is MoveClassification.brilliant
        )

    def test_sacrifice_at_the_minimum_win_percentage(self):
        assert (
            classify(win_pct_drop=0.0, is_sacrifice=True, win_pct_before=20.0)
            is MoveClassification.brilliant
        )

    def test_sacrifice_in_a_lost_position_is_only_best(self):
        assert (
            classify(win_pct_drop=0.0, is_sacrifice=True, win_pct_before=10.0)
            is MoveClassification.best
        )

    def test_best_move_without_a_sacrifice_stays_best(self):
        assert (
            classify(win_pct_drop=0.0, is_sacrifice=False, win_pct_before=70.0)
            is MoveClassification.best
        )

    def test_a_losing_sacrifice_is_not_brilliant(self):
        # Giving away material *and* winning chances is just a blunder.
        assert (
            classify(win_pct_drop=30.0, is_sacrifice=True, win_pct_before=70.0)
            is MoveClassification.blunder
        )

    def test_brilliant_does_not_override_book(self):
        assert (
            classify(is_book=True, ply=4, is_sacrifice=True, win_pct_before=70.0)
            is MoveClassification.book
        )


class TestGreat:
    def test_large_gap_to_second_best_is_great(self):
        assert classify(second_best_gap_cp=200) is MoveClassification.great

    def test_gap_at_the_great_threshold_is_not_great(self):
        # GREAT_GAP_CP's own boundary is strict, same as FORCED_GAP_CP's.
        assert classify(second_best_gap_cp=150) is MoveClassification.best

    def test_small_gap_stays_plain_best(self):
        assert classify(second_best_gap_cp=20) is MoveClassification.best

    def test_great_only_applies_to_the_best_band(self):
        # A 3-point drop is "good", not "best" — a wide gap to the second
        # choice doesn't retroactively make a worse move great.
        assert classify(win_pct_drop=3.0, second_best_gap_cp=200) is MoveClassification.good

    def test_sacrifice_outranks_great(self):
        # A sound sacrifice with a wide gap to the alternatives is brilliant,
        # not great — rule 4 (brilliant) is checked before rule 5 (great).
        assert (
            classify(is_sacrifice=True, win_pct_before=70.0, second_best_gap_cp=200)
            is MoveClassification.brilliant
        )

    def test_great_does_not_override_book(self):
        assert (
            classify(is_book=True, ply=4, second_best_gap_cp=200)
            is MoveClassification.book
        )


class TestMaterialHelpers:
    def test_starting_material_is_thirty_nine_pawn_units(self):
        board = chess.Board()
        # 8 pawns + 2*3 knights + 2*3 bishops + 2*5 rooks + 9 queen
        assert material_for(board, chess.WHITE) == 39
        assert material_for(board, chess.BLACK) == 39

    def test_giving_up_a_queen_for_a_pawn_is_a_sacrifice(self):
        # Qxh7+ grabs a pawn but hangs the queen to Kxh7.
        board = chess.Board("6k1/7p/8/7Q/8/8/8/6K1 w - - 0 1")
        move = board.parse_san("Qxh7+")
        reply = chess.Move.from_uci("g8h7")
        assert is_material_sacrifice(board, move, reply) is True

    def test_a_capture_the_opponent_cannot_answer_is_not_a_sacrifice(self):
        # Same capture, but here it is mate (Scholar's mate), so nothing is lost.
        board = chess.Board(
            "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1"
        )
        move = board.parse_san("Qxf7+")
        # Kxf7 is illegal (the bishop on c4 covers f7), so it is ignored.
        reply = chess.Move.from_uci("e8f7")
        assert is_material_sacrifice(board, move, reply) is False

    def test_an_even_trade_is_not_a_sacrifice(self):
        board = chess.Board(
            "rnbqkbnr/ppp2ppp/8/3pp3/3PP3/8/PPP2PPP/RNBQKBNR w KQkq - 0 3"
        )
        move = board.parse_san("dxe5")
        reply = chess.Move.from_uci("d5e4")
        assert is_material_sacrifice(board, move, reply) is False

    def test_a_quiet_developing_move_is_not_a_sacrifice(self):
        board = chess.Board()
        move = board.parse_san("e4")
        reply = chess.Move.from_uci("e7e5")
        assert is_material_sacrifice(board, move, reply) is False

    def test_winning_material_is_not_a_sacrifice(self):
        # White simply takes a free pawn on e5 with no recapture available.
        board = chess.Board("4k3/8/8/4p3/3P4/8/8/4K3 w - - 0 1")
        move = board.parse_san("dxe5")
        assert is_material_sacrifice(board, move, None) is False

    def test_an_illegal_move_is_never_a_sacrifice(self):
        board = chess.Board()
        assert is_material_sacrifice(board, chess.Move.from_uci("e2e5"), None) is False

    def test_a_reply_that_hangs_right_back_is_not_a_sacrifice(self):
        # Real false-positive found in production: Black plays the quiet
        # developing move Nf6; White's engine-best reply is Bxd6, grabbing
        # Black's bishop - but Black's own pawn on c7 recaptures it right
        # back (cxd6), an ordinary even trade. The one-ply-only version of
        # this function saw White's reply capture a bishop and reported a
        # 3-point "sacrifice" that was never real, because it never looked
        # far enough ahead to see Black's own recapture.
        board = chess.Board(
            "rn1qk1nr/1pp2ppp/p2bp3/3p1b2/3P4/2N1PPB1/PPP3PP/R2QKBNR b KQkq - 2 6"
        )
        move = board.parse_san("Nf6")
        reply = chess.Move.from_uci("g3d6")  # Bxd6
        assert is_material_sacrifice(board, move, reply) is False

    def test_a_reply_capture_with_no_recapture_is_still_a_sacrifice(self):
        # Same shape as the queen-sac test above, phrased the other way: the
        # recapture step must never *manufacture* a recapture that isn't
        # there. White walks the queen next to the king with nothing
        # defending it; Black's king takes it and White has nothing left
        # that can retake on that square.
        board = chess.Board("6k1/8/8/7Q/8/8/8/6K1 w - - 0 1")
        move = chess.Move.from_uci("h5h8")  # Qh8+, walks into ...Kxh8
        reply = chess.Move.from_uci("g8h8")
        assert is_material_sacrifice(board, move, reply) is True
