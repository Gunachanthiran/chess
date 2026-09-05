from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from app.services.game_stats import GameStatsRow, compute_stats, my_accuracy

TODAY = date(2026, 8, 16)


def _dt(days_ago: int) -> datetime:
    return datetime.combine(TODAY - timedelta(days=days_ago), datetime.min.time(), tzinfo=UTC)


def row(
    *,
    days_ago: int = 0,
    white_name: str = "ZenWhiz",
    black_name: str = "Opponent",
    imported_username: str | None = "ZenWhiz",
    white_accuracy: float | None = None,
    black_accuracy: float | None = None,
) -> GameStatsRow:
    return GameStatsRow(
        played_at=_dt(days_ago),
        created_at=_dt(days_ago),
        white_name=white_name,
        black_name=black_name,
        imported_username=imported_username,
        white_accuracy=white_accuracy,
        black_accuracy=black_accuracy,
    )


class TestMyAccuracy:
    def test_white_side_match(self):
        assert my_accuracy(row(white_accuracy=91.0, black_accuracy=80.0)) == 91.0

    def test_black_side_match(self):
        r = row(imported_username="Opponent", white_accuracy=91.0, black_accuracy=80.0)
        assert my_accuracy(r) == 80.0

    def test_case_and_whitespace_insensitive(self):
        r = row(imported_username="  zenwhiz  ", white_accuracy=91.0)
        assert my_accuracy(r) == 91.0

    def test_no_matching_side_is_none(self):
        r = row(imported_username="SomeoneElse", white_accuracy=91.0, black_accuracy=80.0)
        assert my_accuracy(r) is None

    def test_self_play_is_none(self):
        r = row(white_name="ZenWhiz", black_name="ZenWhiz", white_accuracy=91.0)
        assert my_accuracy(r) is None

    def test_no_imported_username_is_none(self):
        r = row(imported_username=None, white_accuracy=91.0)
        assert my_accuracy(r) is None

    def test_unanalysed_game_is_none(self):
        assert my_accuracy(row()) is None


class TestComputeStats:
    def test_empty(self):
        stats = compute_stats([], today=TODAY)
        assert stats.total_games == 0
        assert stats.analyzed_games == 0
        assert stats.recent_accuracy is None
        assert stats.current_streak_days == 0

    def test_counts_total_and_analyzed(self):
        rows = [
            row(days_ago=0, white_accuracy=90.0, black_accuracy=80.0),
            row(days_ago=1),  # not analysed
        ]
        stats = compute_stats(rows, today=TODAY)
        assert stats.total_games == 2
        assert stats.analyzed_games == 1

    def test_recent_accuracy_averages_my_side_only(self):
        rows = [
            row(days_ago=0, white_accuracy=90.0, black_accuracy=10.0),
            row(days_ago=1, white_accuracy=80.0, black_accuracy=10.0),
        ]
        stats = compute_stats(rows, today=TODAY)
        assert stats.recent_accuracy == 85.0

    def test_recent_accuracy_windowed_to_most_recent_games(self):
        rows = [row(days_ago=day, white_accuracy=float(day)) for day in range(25)]
        stats = compute_stats(rows, today=TODAY)
        # Window is the 20 most recent (smallest days_ago -> 0..19), not the
        # first 20 encountered.
        assert stats.recent_accuracy == sum(range(20)) / 20

    def test_recent_accuracy_ignores_games_with_no_usable_side(self):
        rows = [
            row(days_ago=0, imported_username="Nobody", white_accuracy=90.0),
            row(days_ago=1, white_accuracy=80.0),
        ]
        stats = compute_stats(rows, today=TODAY)
        assert stats.recent_accuracy == 80.0

    def test_streak_counts_consecutive_days_including_today(self):
        rows = [row(days_ago=day) for day in range(3)]
        stats = compute_stats(rows, today=TODAY)
        assert stats.current_streak_days == 3

    def test_streak_still_alive_without_a_game_today_yet(self):
        rows = [row(days_ago=day) for day in range(1, 4)]  # yesterday, -2, -3
        stats = compute_stats(rows, today=TODAY)
        assert stats.current_streak_days == 3

    def test_streak_broken_by_a_gap(self):
        rows = [row(days_ago=0), row(days_ago=2)]
        stats = compute_stats(rows, today=TODAY)
        assert stats.current_streak_days == 1

    def test_streak_zero_when_last_game_was_two_days_ago(self):
        rows = [row(days_ago=2)]
        stats = compute_stats(rows, today=TODAY)
        assert stats.current_streak_days == 0


class TestAccuracyTrend:
    def test_oldest_first(self):
        rows = [
            row(days_ago=0, white_accuracy=70.0),
            row(days_ago=2, white_accuracy=90.0),
            row(days_ago=1, white_accuracy=80.0),
        ]
        stats = compute_stats(rows, today=TODAY)
        assert [point.accuracy for point in stats.accuracy_trend] == [90.0, 80.0, 70.0]

    def test_excludes_games_with_no_determinable_accuracy(self):
        rows = [
            row(days_ago=0, imported_username="Nobody", white_accuracy=90.0),
            row(days_ago=1, white_accuracy=80.0),
        ]
        stats = compute_stats(rows, today=TODAY)
        assert [point.accuracy for point in stats.accuracy_trend] == [80.0]

    def test_empty_when_nothing_analysed(self):
        stats = compute_stats([row(white_accuracy=None, black_accuracy=None)], today=TODAY)
        assert stats.accuracy_trend == []
