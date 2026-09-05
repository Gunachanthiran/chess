from __future__ import annotations

from app.services.head_to_head_stats import HeadToHeadStatsRow, compute_head_to_head


def row(
    *,
    white_name: str = "ZenWhiz",
    black_name: str = "Rival",
    imported_username: str | None = "ZenWhiz",
    result: str = "1-0",
    white_accuracy: float | None = None,
    black_accuracy: float | None = None,
) -> HeadToHeadStatsRow:
    return HeadToHeadStatsRow(
        white_name=white_name,
        black_name=black_name,
        imported_username=imported_username,
        result=result,
        white_accuracy=white_accuracy,
        black_accuracy=black_accuracy,
    )


class TestComputeHeadToHead:
    def test_no_games_against_this_opponent(self):
        summary = compute_head_to_head([row(black_name="SomeoneElse")], "Rival")
        assert summary.games == 0
        assert summary.opponent_name == "Rival"
        assert summary.score_pct == 0.0
        assert summary.avg_accuracy is None

    def test_counts_games_from_either_colour(self):
        rows = [
            row(white_name="ZenWhiz", black_name="Rival", result="1-0"),  # I'm white, win
            row(white_name="Rival", black_name="ZenWhiz", result="1-0"),  # I'm black, loss
        ]
        summary = compute_head_to_head(rows, "Rival")
        assert summary.games == 2
        assert summary.wins == 1
        assert summary.losses == 1

    def test_matching_is_case_and_whitespace_insensitive(self):
        rows = [row(black_name="  rival  ")]
        summary = compute_head_to_head(rows, "Rival")
        assert summary.games == 1

    def test_excludes_games_against_other_opponents(self):
        rows = [row(black_name="Rival"), row(black_name="SomeoneElse")]
        summary = compute_head_to_head(rows, "Rival")
        assert summary.games == 1

    def test_excludes_games_with_no_determinable_side(self):
        rows = [row(black_name="Rival", imported_username=None)]
        summary = compute_head_to_head(rows, "Rival")
        assert summary.games == 0

    def test_score_pct_counts_a_draw_as_half(self):
        rows = [row(result="1-0"), row(result="1/2-1/2")]
        summary = compute_head_to_head(rows, "Rival")
        assert summary.score_pct == 75.0

    def test_avg_accuracy_only_over_analysed_games(self):
        rows = [
            row(white_accuracy=90.0),
            row(white_accuracy=None, black_accuracy=None),
        ]
        summary = compute_head_to_head(rows, "Rival")
        assert summary.avg_accuracy == 90.0

    def test_opponent_name_is_echoed_back_as_given(self):
        summary = compute_head_to_head([], "Some Weird-Name123")
        assert summary.opponent_name == "Some Weird-Name123"
