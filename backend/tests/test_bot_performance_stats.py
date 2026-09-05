from __future__ import annotations

import uuid
from datetime import UTC, datetime

from app.models.move_analysis import MoveClassification, Side
from app.services.bot_performance_stats import (
    BotAnalysisRow,
    bot_side,
    compute_bot_accuracy_trend,
    compute_bot_classification_breakdown,
    compute_bot_phase_breakdown,
    compute_bot_record,
    is_bot_game,
)

STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"


def row(
    *,
    game_id: uuid.UUID | None = None,
    ply: int = 1,
    side: Side = Side.white,
    classification: MoveClassification = MoveClassification.best,
    fen_before: str = STARTING_FEN,
    white_name: str = "Tal Bot (Grandmaster, aggression 5)",
    black_name: str = "You",
    result: str = "1-0",
    played_at: datetime | None = None,
    white_accuracy: float | None = None,
    black_accuracy: float | None = None,
) -> BotAnalysisRow:
    return BotAnalysisRow(
        game_id=game_id or uuid.uuid4(),
        ply=ply,
        side=side,
        classification=classification,
        fen_before=fen_before,
        white_name=white_name,
        black_name=black_name,
        result=result,
        played_at=played_at,
        white_accuracy=white_accuracy,
        black_accuracy=black_accuracy,
    )


class TestIsBotGame:
    def test_bot_as_white(self):
        assert is_bot_game("Tal Bot (Grandmaster, aggression 5)", "You") is True

    def test_bot_as_black(self):
        assert is_bot_game("You", "Tal Bot (1500, aggression 3)") is True

    def test_neither_side_is_the_bot(self):
        assert is_bot_game("Alice", "Bob") is False


class TestBotSide:
    def test_bot_is_white(self):
        assert bot_side("Tal Bot (Grandmaster, aggression 5)", "You") == Side.white

    def test_bot_is_black(self):
        assert bot_side("You", "Tal Bot (1500, aggression 3)") == Side.black

    def test_neither_is_the_bot(self):
        assert bot_side("Alice", "Bob") is None


class TestComputeBotRecord:
    def test_counts_win_loss_draw_from_the_bots_perspective(self):
        g1, g2, g3 = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        rows = [
            row(game_id=g1, white_name="Tal Bot (Grandmaster, aggression 5)", result="1-0"),
            row(game_id=g2, white_name="Tal Bot (Grandmaster, aggression 5)", result="0-1"),
            row(game_id=g3, white_name="Tal Bot (Grandmaster, aggression 5)", result="1/2-1/2"),
        ]
        record = compute_bot_record(rows)
        assert record.games == 3
        assert record.wins == 1
        assert record.losses == 1
        assert record.draws == 1
        assert record.score_pct == 50.0

    def test_bot_as_black_reads_result_from_black_perspective(self):
        g1 = uuid.uuid4()
        rows = [row(game_id=g1, white_name="You", black_name="Tal Bot (1500, aggression 3)", result="0-1")]
        record = compute_bot_record(rows)
        assert record.wins == 1

    def test_deduplicates_multiple_moves_of_the_same_game(self):
        g1 = uuid.uuid4()
        rows = [
            row(game_id=g1, ply=1, result="1-0"),
            row(game_id=g1, ply=2, result="1-0"),
            row(game_id=g1, ply=3, result="1-0"),
        ]
        assert compute_bot_record(rows).games == 1

    def test_avg_accuracy_uses_the_bots_own_side(self):
        rows = [row(white_accuracy=91.0, black_accuracy=40.0)]
        assert compute_bot_record(rows).avg_accuracy == 91.0

    def test_empty_input(self):
        record = compute_bot_record([])
        assert record.games == 0
        assert record.score_pct == 0.0
        assert record.avg_accuracy is None


class TestComputeBotClassificationBreakdown:
    def test_counts_only_the_bots_own_moves(self):
        rows = [
            row(side=Side.white, classification=MoveClassification.blunder),
            row(side=Side.black, classification=MoveClassification.brilliant),  # opponent's move
        ]
        counts = compute_bot_classification_breakdown(rows)
        assert counts[MoveClassification.blunder] == 1
        assert counts[MoveClassification.brilliant] == 0

    def test_bot_as_black_counts_black_side_moves(self):
        rows = [
            row(white_name="You", black_name="Tal Bot (1500, aggression 3)", side=Side.black, classification=MoveClassification.great),
            row(white_name="You", black_name="Tal Bot (1500, aggression 3)", side=Side.white, classification=MoveClassification.blunder),
        ]
        counts = compute_bot_classification_breakdown(rows)
        assert counts[MoveClassification.great] == 1
        assert counts[MoveClassification.blunder] == 0

    def test_every_classification_present_even_at_zero(self):
        counts = compute_bot_classification_breakdown([])
        assert counts[MoveClassification.brilliant] == 0
        assert set(counts) == set(MoveClassification)


class TestComputeBotPhaseBreakdown:
    def test_always_returns_all_three_phases(self):
        breakdown = {b.phase: b for b in compute_bot_phase_breakdown([])}
        assert set(breakdown) == {"opening", "middlegame", "endgame"}

    def test_counts_only_the_bots_own_moves_by_phase(self):
        rows = [
            row(ply=1, side=Side.white, classification=MoveClassification.blunder),
            row(ply=1, side=Side.black, classification=MoveClassification.blunder),  # opponent
        ]
        opening = next(b for b in compute_bot_phase_breakdown(rows) if b.phase == "opening")
        assert opening.total_moves == 1
        assert opening.blunders == 1

    def test_error_rate_pct(self):
        rows = [
            row(ply=1, side=Side.white, classification=MoveClassification.best),
            row(ply=2, side=Side.white, classification=MoveClassification.blunder),
        ]
        opening = next(b for b in compute_bot_phase_breakdown(rows) if b.phase == "opening")
        assert opening.total_moves == 2
        assert opening.error_rate_pct == 50.0


class TestComputeBotAccuracyTrend:
    def test_oldest_first(self):
        g1, g2 = uuid.uuid4(), uuid.uuid4()
        older = datetime(2024, 1, 1, tzinfo=UTC)
        newer = datetime(2024, 6, 1, tzinfo=UTC)
        rows = [
            row(game_id=g1, played_at=newer, white_accuracy=70.0),
            row(game_id=g2, played_at=older, white_accuracy=90.0),
        ]
        trend = compute_bot_accuracy_trend(rows, limit=10)
        assert [p.accuracy for p in trend] == [90.0, 70.0]

    def test_skips_games_with_no_accuracy_or_no_date(self):
        rows = [row(played_at=None, white_accuracy=90.0), row(played_at=datetime.now(UTC), white_accuracy=None)]
        assert compute_bot_accuracy_trend(rows, limit=10) == []

    def test_respects_limit(self):
        rows = [
            row(game_id=uuid.uuid4(), played_at=datetime(2024, 1, i + 1, tzinfo=UTC), white_accuracy=float(i))
            for i in range(5)
        ]
        trend = compute_bot_accuracy_trend(rows, limit=2)
        assert len(trend) == 2
        # Most recent two, oldest-first: day 4 (idx 3) then day 5 (idx 4).
        assert [p.accuracy for p in trend] == [3.0, 4.0]
