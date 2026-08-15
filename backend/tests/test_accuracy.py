"""Tests for the win-probability and accuracy maths."""

from dataclasses import dataclass

import pytest

from app.services.accuracy import (
    compute_side_accuracy,
    move_accuracy,
    mover_pov_pairs,
    win_percent,
    win_pct_drop,
)


@dataclass
class FakeMove:
    """Stand-in for a MoveAnalysis row (White-POV win percentages)."""

    side: str
    win_pct_before: float
    win_pct_after: float


def steady(count: int, loss: float, start: float = 55.0) -> list[tuple[float, float]]:
    """`count` mover-POV moves that each give away exactly `loss` points."""
    return [(start, start - loss) for _ in range(count)]


class TestWinPercent:
    def test_equal_position_is_fifty_percent(self):
        assert win_percent(0) == pytest.approx(50.0)

    def test_white_advantage_is_above_fifty(self):
        assert win_percent(300) > 50.0

    def test_black_advantage_is_below_fifty(self):
        assert win_percent(-300) < 50.0

    def test_is_symmetric_around_fifty(self):
        assert win_percent(250) + win_percent(-250) == pytest.approx(100.0)

    def test_matches_the_reference_formula(self):
        # 50 + 50 * (2/(1+exp(-0.00368208*cp)) - 1) at cp=100
        assert win_percent(100) == pytest.approx(59.11, abs=0.05)

    def test_is_monotonic_in_cp(self):
        values = [win_percent(cp) for cp in (-500, -100, 0, 100, 500)]
        assert values == sorted(values)

    def test_large_advantage_approaches_one_hundred(self):
        assert win_percent(5000) > 99.0

    def test_mate_for_white_is_one_hundred(self):
        assert win_percent(None, mate=3) == 100.0

    def test_mate_against_white_is_zero(self):
        assert win_percent(None, mate=-3) == 0.0

    def test_mate_overrides_cp(self):
        assert win_percent(-800, mate=1) == 100.0

    def test_missing_evaluation_defaults_to_even(self):
        assert win_percent(None, None) == 50.0

    def test_extreme_cp_does_not_overflow(self):
        assert win_percent(10**9) == pytest.approx(100.0, abs=0.01)
        assert win_percent(-(10**9)) == pytest.approx(0.0, abs=0.01)


class TestWinPctDrop:
    def test_white_losing_ground_is_a_positive_drop(self):
        assert win_pct_drop("white", 60.0, 45.0) == pytest.approx(15.0)

    def test_black_drop_is_mirrored(self):
        # White's win% rising is bad for Black.
        assert win_pct_drop("black", 40.0, 55.0) == pytest.approx(15.0)

    def test_improving_your_position_never_scores_negative(self):
        assert win_pct_drop("white", 40.0, 70.0) == 0.0
        assert win_pct_drop("black", 70.0, 40.0) == 0.0

    def test_accepts_objects_with_a_value_attribute(self):
        class Side:
            value = "black"

        assert win_pct_drop(Side(), 40.0, 55.0) == pytest.approx(15.0)


class TestMoverPovPairs:
    def test_white_moves_keep_stored_values(self):
        assert mover_pov_pairs([FakeMove("white", 60.0, 45.0)]) == [(60.0, 45.0)]

    def test_black_moves_are_mirrored(self):
        assert mover_pov_pairs([FakeMove("black", 40.0, 55.0)]) == [(60.0, 45.0)]

    def test_order_is_preserved(self):
        moves = [FakeMove("white", 50.0, 50.0), FakeMove("white", 51.0, 52.0)]
        assert mover_pov_pairs(moves) == [(50.0, 50.0), (51.0, 52.0)]

    def test_accepts_objects_with_a_value_attribute(self):
        class Side:
            value = "black"

        assert mover_pov_pairs([FakeMove(Side(), 40.0, 55.0)]) == [(60.0, 45.0)]


class TestMoveAccuracy:
    def test_no_loss_is_one_hundred(self):
        assert move_accuracy(55.0, 55.0) == pytest.approx(100.0, abs=0.01)

    def test_gaining_ground_is_one_hundred(self):
        assert move_accuracy(40.0, 70.0) == pytest.approx(100.0, abs=0.01)

    def test_tiny_loss_stays_near_one_hundred(self):
        assert move_accuracy(55.0, 54.0) > 95.0

    def test_inaccuracy_dents_it_moderately(self):
        assert 60.0 < move_accuracy(55.0, 47.0) < 90.0

    def test_big_blunder_scores_low(self):
        assert move_accuracy(70.0, 25.0) < 40.0

    def test_catastrophe_scores_near_zero(self):
        assert move_accuracy(95.0, 0.0) < 5.0

    def test_decreases_monotonically_with_loss(self):
        values = [move_accuracy(90.0, 90.0 - loss) for loss in (0, 5, 15, 40, 80)]
        assert values == sorted(values, reverse=True)

    def test_is_clamped_to_the_zero_hundred_range(self):
        assert 0.0 <= move_accuracy(100.0, 0.0) <= 100.0
        assert 0.0 <= move_accuracy(0.0, 100.0) <= 100.0


class TestComputeSideAccuracy:
    def test_no_moves_scores_one_hundred(self):
        assert compute_side_accuracy([]) == 100.0

    def test_perfect_play_scores_one_hundred(self):
        assert compute_side_accuracy(steady(30, loss=0.0)) == pytest.approx(100.0, abs=0.01)

    def test_near_perfect_game_stays_above_ninety_five(self):
        # Thirty moves, each leaking well under a point of win%.
        moves = [(55.0 + (index % 3) * 0.5, 55.0 + (index % 3) * 0.5 - 0.4) for index in range(30)]
        assert compute_side_accuracy(moves) > 95.0

    def test_one_big_blunder_tanks_an_otherwise_clean_game(self):
        moves = steady(29, loss=0.4)
        moves.insert(15, (60.0, 12.0))  # one 48-point collapse
        accuracy = compute_side_accuracy(moves)
        assert accuracy < 90.0
        # ...and it is much worse than the same game without the blunder.
        assert accuracy < compute_side_accuracy(steady(30, loss=0.4)) - 10.0

    def test_harmonic_mean_punishes_an_outlier_harder_than_a_plain_average(self):
        # Old formula: 100 - mean(drop) = 100 - 48/30 = 98.4. The blunder must
        # cost far more than that.
        moves = steady(29, loss=0.0)
        moves.insert(15, (60.0, 12.0))
        assert compute_side_accuracy(moves) < 95.0

    def test_sloppy_game_scores_far_below_a_clean_one(self):
        assert compute_side_accuracy(steady(30, loss=8.0)) < compute_side_accuracy(
            steady(30, loss=1.0)
        )

    def test_every_move_a_disaster_scores_very_low(self):
        moves = [(90.0, 5.0), (80.0, 2.0), (70.0, 1.0), (60.0, 0.0)]
        assert compute_side_accuracy(moves) < 20.0

    def test_gains_do_not_offset_losses(self):
        gainful = steady(9, loss=0.0) + [(10.0, 90.0)]
        lossy = steady(9, loss=0.0) + [(50.0, 20.0)]
        assert compute_side_accuracy(gainful) == pytest.approx(100.0, abs=0.01)
        assert compute_side_accuracy(lossy) < 100.0

    def test_result_stays_within_range(self):
        assert 0.0 <= compute_side_accuracy(steady(20, loss=100.0, start=100.0)) <= 100.0

    def test_flat_game_falls_back_to_an_unweighted_mean(self):
        # Identical win% before every move => all volatility weights are zero.
        moves = [(50.0, 45.0), (50.0, 45.0), (50.0, 45.0), (50.0, 45.0)]
        expected = move_accuracy(50.0, 45.0)
        assert compute_side_accuracy(moves) == pytest.approx(expected)

    def test_volatile_positions_weigh_more_than_quiet_ones(self):
        # Same set of errors; in the first game the mistakes happen while the
        # evaluation is swinging, in the second while it is calm.
        volatile = [(50.0, 42.0), (80.0, 72.0), (20.0, 12.0), (75.0, 67.0)]
        calm = [(50.0, 42.0), (50.0, 42.0), (50.0, 42.0), (50.0, 42.0)]
        assert compute_side_accuracy(volatile) <= compute_side_accuracy(calm) + 1e-6
