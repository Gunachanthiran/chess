"""Tests for the cloud-first / engine-fallback evaluation wrapper.

No engine process and no network: the cloud lookup is monkeypatched and the
engine is a recording fake, so each test pins down exactly one decision - when a
cached Lichess eval is trusted, and when local Stockfish has to do the work.
"""

from __future__ import annotations

import chess
import pytest

from app.services import position_evaluator
from app.services.position_evaluator import MIN_CLOUD_DEPTH, evaluate_position

ENGINE_RESULT = {
    "cp": 31,
    "mate": None,
    "best_move": chess.Move.from_uci("d2d4"),
    "second_best_cp": 20,
    "second_best_mate": None,
    "top_moves": [
        {"move": chess.Move.from_uci("d2d4"), "cp": 31, "mate": None},
        {"move": chess.Move.from_uci("e2e4"), "cp": 20, "mate": None},
    ],
}


def cloud_result(depth: int, **overrides) -> dict:
    result = {
        "cp": 25,
        "mate": None,
        "best_move": chess.Move.from_uci("e2e4"),
        "second_best_cp": 19,
        "second_best_mate": None,
        "top_moves": [
            {"move": chess.Move.from_uci("e2e4"), "cp": 25, "mate": None},
            {"move": chess.Move.from_uci("d2d4"), "cp": 19, "mate": None},
        ],
        "depth": depth,
    }
    result.update(overrides)
    return result


class FakeEngine:
    """Records `analyse` calls; `depth` mirrors `StockfishEngine.depth`."""

    def __init__(self, depth: int = 22):
        self.depth = depth
        self.calls: list[tuple[str, int | None]] = []

    def analyse(self, board: chess.Board, depth: int | None = None) -> dict:
        self.calls.append((board.fen(), depth))
        return dict(ENGINE_RESULT)


@pytest.fixture
def cloud(monkeypatch):
    """Pin what the cloud lookup returns, and record the FENs it was asked for."""
    asked: list[str] = []

    def _cloud(result):
        def fake_fetch(fen, multipv=2, timeout=2.0):
            asked.append(fen)
            return result

        monkeypatch.setattr(
            position_evaluator.lichess_cloud_eval, "fetch_cloud_eval", fake_fetch
        )
        return asked

    return _cloud


class TestCloudHit:
    def test_deep_enough_hit_is_used_as_is(self, cloud):
        cloud(cloud_result(depth=46))
        engine = FakeEngine(depth=22)

        result = evaluate_position(engine, chess.Board())

        assert engine.calls == []
        assert result["cp"] == 25
        assert result["best_move"] == chess.Move.from_uci("e2e4")
        assert result["second_best_cp"] == 19

    def test_returned_shape_matches_the_engine_contract(self, cloud):
        cloud(cloud_result(depth=46))

        result = evaluate_position(FakeEngine(), chess.Board())

        assert set(result) == set(ENGINE_RESULT)  # no stray `depth` key leaks out

    def test_hit_exactly_at_the_local_depth_is_accepted(self, cloud):
        cloud(cloud_result(depth=22))
        engine = FakeEngine(depth=22)

        evaluate_position(engine, chess.Board())

        assert engine.calls == []

    def test_mate_scored_hit_is_used(self, cloud):
        cloud(cloud_result(depth=40, cp=None, mate=4))
        engine = FakeEngine(depth=22)

        result = evaluate_position(engine, chess.Board())

        assert engine.calls == []
        assert result["mate"] == 4


class TestFallbackToEngine:
    def test_cache_miss_falls_back(self, cloud):
        asked = cloud(None)
        engine = FakeEngine()

        result = evaluate_position(engine, chess.Board())

        assert asked == [chess.Board().fen()]
        assert result == ENGINE_RESULT
        assert len(engine.calls) == 1

    def test_shallow_hit_is_rejected_in_favour_of_the_engine(self, cloud):
        """A shallow cached eval is worse than what local search would produce."""
        cloud(cloud_result(depth=MIN_CLOUD_DEPTH - 1))
        engine = FakeEngine(depth=22)

        result = evaluate_position(engine, chess.Board())

        assert result == ENGINE_RESULT
        assert len(engine.calls) == 1

    def test_hit_shallower_than_the_local_depth_is_rejected(self, cloud):
        cloud(cloud_result(depth=24))
        engine = FakeEngine(depth=30)

        result = evaluate_position(engine, chess.Board())

        assert result == ENGINE_RESULT

    def test_hit_without_a_depth_is_rejected(self, cloud):
        cloud(cloud_result(depth=None))
        engine = FakeEngine()

        assert evaluate_position(engine, chess.Board()) == ENGINE_RESULT

    def test_hit_without_a_score_is_rejected(self, cloud):
        cloud(cloud_result(depth=46, cp=None, mate=None))
        engine = FakeEngine()

        assert evaluate_position(engine, chess.Board()) == ENGINE_RESULT

    def test_hit_without_a_best_move_is_rejected(self, cloud):
        cloud(cloud_result(depth=46, best_move=None))
        engine = FakeEngine()

        assert evaluate_position(engine, chess.Board()) == ENGINE_RESULT

    def test_explicit_depth_argument_raises_the_bar_and_is_passed_on(self, cloud):
        cloud(cloud_result(depth=30))
        engine = FakeEngine(depth=22)

        evaluate_position(engine, chess.Board(), depth=35)

        assert engine.calls == [(chess.Board().fen(), 35)]

class TestCircuitBreaker:
    """A rate-limited Lichess must cost the job a handful of round-trips, not one per ply."""

    @pytest.fixture
    def rate_limited(self, monkeypatch):
        """Every cloud lookup 429s; returns the list of FENs actually requested."""
        asked: list[str] = []

        def fake_outcome(fen, multipv=2, timeout=2.0):
            asked.append(fen)
            return position_evaluator.lichess_cloud_eval.CloudEvalOutcome(
                None, failed=True
            )

        monkeypatch.setattr(
            position_evaluator.lichess_cloud_eval,
            "fetch_cloud_eval_outcome",
            fake_outcome,
        )
        monkeypatch.setattr(
            position_evaluator.lichess_cloud_eval.time, "sleep", lambda _s: None
        )
        return asked

    def test_repeated_failures_stop_the_lookups_for_the_rest_of_the_job(
        self, rate_limited
    ):
        session = position_evaluator.lichess_cloud_eval.CloudEvalSession(
            failure_limit=3
        )
        engine = FakeEngine()
        board = chess.Board()

        for uci in ("e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6", "b5a4", "g8f6"):
            evaluate_position(engine, board, cloud_session=session)
            board.push(chess.Move.from_uci(uci))

        # Every position still got an evaluation - from local Stockfish.
        assert len(engine.calls) == 8
        # But only the first three cost a network round-trip.
        assert len(rate_limited) == 3

    def test_each_job_gets_its_own_breaker(self, rate_limited):
        engine = FakeEngine()
        for _ in range(2):  # two jobs, two sessions
            session = position_evaluator.lichess_cloud_eval.CloudEvalSession(
                failure_limit=3
            )
            for _ in range(5):
                evaluate_position(engine, chess.Board(), cloud_session=session)

        assert len(rate_limited) == 6

    def test_without_a_session_every_call_is_independent(self, cloud):
        """The plain call path is unchanged: no breaker, no shared state."""
        asked = cloud(None)
        engine = FakeEngine()

        for _ in range(5):
            evaluate_position(engine, chess.Board())

        assert len(asked) == 5


class TestTerminalPositions:
    def test_terminal_position_skips_the_cloud_entirely(self, cloud):
        asked = cloud(cloud_result(depth=46))
        engine = FakeEngine()
        # Fool's mate: the game is over, so only the engine's terminal handling
        # can produce a meaningful score.
        board = chess.Board()
        for uci in ("f2f3", "e7e5", "g2g4", "d8h4"):
            board.push(chess.Move.from_uci(uci))

        evaluate_position(engine, board)

        assert asked == []
        assert len(engine.calls) == 1
