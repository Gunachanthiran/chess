from __future__ import annotations

from app.models.move_analysis import MoveClassification, Side
from app.services.time_pressure_stats import (
    CRITICAL_THRESHOLD_S,
    PLENTY_THRESHOLD_S,
    MoveInput,
    TimePressureGameInput,
    classify_time_bucket,
    clock_seconds_by_ply,
    compute_time_pressure,
    parse_clock_seconds,
)

SAMPLE_PGN = """[Event "Live Chess"]
[White "A"]
[Black "B"]
[Result "1-0"]

1. d4 { [%clk 0:29:49.5] } 1... e6 { [%clk 0:00:25.0] } 2. e4 { [%clk 0:01:40.0] } 1-0
"""

NO_CLOCK_PGN = """[Event "Bot"]
[White "A"]
[Black "B"]
[Result "1-0"]

1. d4 e6 2. e4 1-0
"""


class TestParseClockSeconds:
    def test_parses_hours_minutes_seconds(self):
        assert parse_clock_seconds("[%clk 0:29:49.5]") == 29 * 60 + 49.5

    def test_parses_with_surrounding_text(self):
        assert parse_clock_seconds("some note [%clk 1:00:00]") == 3600.0

    def test_none_when_no_clock_annotation(self):
        assert parse_clock_seconds("just a note") is None

    def test_none_on_empty_string(self):
        assert parse_clock_seconds("") is None


class TestClockSecondsByPly:
    def test_extracts_every_ply(self):
        clocks = clock_seconds_by_ply(SAMPLE_PGN)
        assert clocks == {1: 29 * 60 + 49.5, 2: 25.0, 3: 100.0}

    def test_empty_when_no_clock_data(self):
        assert clock_seconds_by_ply(NO_CLOCK_PGN) == {}

    def test_empty_on_unparseable_pgn(self):
        assert clock_seconds_by_ply("not a pgn at all") == {}


class TestClassifyTimeBucket:
    def test_critical_at_or_below_threshold(self):
        assert classify_time_bucket(CRITICAL_THRESHOLD_S) == "critical"
        assert classify_time_bucket(1.0) == "critical"

    def test_low_between_thresholds(self):
        assert classify_time_bucket(CRITICAL_THRESHOLD_S + 1) == "low"
        assert classify_time_bucket(PLENTY_THRESHOLD_S) == "low"

    def test_plenty_above_threshold(self):
        assert classify_time_bucket(PLENTY_THRESHOLD_S + 1) == "plenty"


class TestComputeTimePressure:
    def test_always_returns_all_three_buckets_in_order(self):
        breakdown = compute_time_pressure([])
        assert [b.bucket for b in breakdown] == ["plenty", "low", "critical"]
        assert all(b.total_moves == 0 for b in breakdown)

    def test_buckets_moves_by_their_own_clock_reading(self):
        game = TimePressureGameInput(
            pgn=SAMPLE_PGN,
            moves=[
                MoveInput(ply=1, side=Side.white, classification=MoveClassification.best),
                MoveInput(ply=2, side=Side.black, classification=MoveClassification.blunder),
                MoveInput(ply=3, side=Side.white, classification=MoveClassification.good),
            ],
        )
        breakdown = {b.bucket: b for b in compute_time_pressure([game])}
        assert breakdown["plenty"].total_moves == 1  # ply 1, ~29:49 left
        assert breakdown["critical"].total_moves == 1  # ply 2, 25s left
        assert breakdown["critical"].blunders == 1
        assert breakdown["low"].total_moves == 1  # ply 3, 100s left

    def test_moves_with_no_clock_data_are_skipped(self):
        game = TimePressureGameInput(
            pgn=NO_CLOCK_PGN,
            moves=[MoveInput(ply=1, side=Side.white, classification=MoveClassification.blunder)],
        )
        breakdown = compute_time_pressure([game])
        assert all(b.total_moves == 0 for b in breakdown)

    def test_error_rate_pct(self):
        game = TimePressureGameInput(
            pgn=SAMPLE_PGN,
            moves=[
                MoveInput(ply=2, side=Side.black, classification=MoveClassification.blunder),
                MoveInput(ply=2, side=Side.black, classification=MoveClassification.best),
            ],
        )
        # Two moves sharing the same ply is artificial, but exercises the
        # rate maths directly: both land in "critical" (ply 2, 25s left).
        [critical] = [b for b in compute_time_pressure([game]) if b.bucket == "critical"]
        assert critical.total_moves == 2
        assert critical.error_rate_pct == 50.0
