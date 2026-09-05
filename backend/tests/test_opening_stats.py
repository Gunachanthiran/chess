from __future__ import annotations

from app.services.opening_stats import (
    OpeningStatsRow,
    compute_opening_performance,
    my_result,
)


def row(
    *,
    opening_name: str | None = "Caro-Kann Defense",
    eco: str | None = "B10",
    result: str = "1-0",
    white_name: str = "ZenWhiz",
    black_name: str = "Opponent",
    imported_username: str | None = "ZenWhiz",
    white_accuracy: float | None = None,
    black_accuracy: float | None = None,
) -> OpeningStatsRow:
    return OpeningStatsRow(
        opening_name=opening_name,
        eco=eco,
        result=result,
        white_name=white_name,
        black_name=black_name,
        imported_username=imported_username,
        white_accuracy=white_accuracy,
        black_accuracy=black_accuracy,
    )


class TestMyResult:
    def test_white_win(self):
        assert my_result(row(result="1-0", imported_username="ZenWhiz")) == "win"

    def test_white_loss(self):
        assert my_result(row(result="0-1", imported_username="ZenWhiz")) == "loss"

    def test_black_win(self):
        r = row(result="0-1", imported_username="Opponent")
        assert my_result(r) == "win"

    def test_draw(self):
        assert my_result(row(result="1/2-1/2")) == "draw"

    def test_no_imported_username(self):
        assert my_result(row(imported_username=None)) is None

    def test_ambiguous_names(self):
        r = row(white_name="Same", black_name="Same", imported_username="Same")
        assert my_result(r) is None

    def test_unresolved_result(self):
        # An in-progress or abandoned game's result isn't one of the three
        # recognised strings.
        assert my_result(row(result="*")) is None


class TestComputeOpeningPerformance:
    def test_groups_by_opening_name(self):
        rows = [
            row(opening_name="Caro-Kann Defense", result="1-0"),
            row(opening_name="Caro-Kann Defense", result="0-1"),
            row(opening_name="Sicilian Defense", result="1-0"),
        ]
        performances = compute_opening_performance(rows)
        by_name = {p.opening_name: p for p in performances}
        assert by_name["Caro-Kann Defense"].games == 2
        assert by_name["Caro-Kann Defense"].wins == 1
        assert by_name["Caro-Kann Defense"].losses == 1
        assert by_name["Sicilian Defense"].games == 1
        assert by_name["Sicilian Defense"].wins == 1

    def test_score_pct_counts_a_draw_as_half(self):
        rows = [
            row(result="1-0"),
            row(result="1/2-1/2"),
        ]
        [performance] = compute_opening_performance(rows)
        # (1 + 0.5) / 2 games = 75%.
        assert performance.score_pct == 75.0

    def test_excludes_games_with_no_opening_name(self):
        rows = [row(opening_name=None), row(opening_name="Caro-Kann Defense")]
        performances = compute_opening_performance(rows)
        assert len(performances) == 1
        assert performances[0].opening_name == "Caro-Kann Defense"

    def test_excludes_games_with_no_determinable_side(self):
        rows = [row(imported_username=None)]
        assert compute_opening_performance(rows) == []

    def test_avg_accuracy_only_over_analysed_games(self):
        rows = [
            row(white_accuracy=90.0, black_accuracy=None),
            row(white_accuracy=None, black_accuracy=None),  # not yet analysed
        ]
        [performance] = compute_opening_performance(rows)
        assert performance.avg_accuracy == 90.0

    def test_avg_accuracy_none_when_nothing_analysed(self):
        [performance] = compute_opening_performance([row(white_accuracy=None)])
        assert performance.avg_accuracy is None

    def test_eco_is_the_most_common_code_for_that_opening(self):
        rows = [
            row(eco="B10", opening_name="Caro-Kann Defense"),
            row(eco="B10", opening_name="Caro-Kann Defense"),
            row(eco="B12", opening_name="Caro-Kann Defense"),
        ]
        [performance] = compute_opening_performance(rows)
        assert performance.eco == "B10"

    def test_sorted_by_games_descending(self):
        rows = [
            row(opening_name="Rare Line", result="1-0"),
            row(opening_name="Common Line", result="1-0"),
            row(opening_name="Common Line", result="0-1"),
        ]
        performances = compute_opening_performance(rows)
        assert [p.opening_name for p in performances] == ["Common Line", "Rare Line"]
