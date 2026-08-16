from __future__ import annotations

import chess

from app.services.engine_pool import StockfishEngine


class _FakeUciEngine:
    """Records call order; `analyse()` returns just enough for `analyse()`
    to build its result without touching a real Stockfish process."""

    def __init__(self) -> None:
        self.calls: list[str] = []

    def configure(self, options: dict) -> None:
        self.calls.append(f"configure:{options}")

    def analyse(self, board, limit, multipv=1):
        self.calls.append("analyse")
        return [
            {
                "score": chess.engine.PovScore(chess.engine.Cp(10), chess.WHITE),
                "pv": [chess.Move.from_uci("e2e4")],
            }
        ]


class TestHashClearedBeforeEverySearch:
    """`analyse()` shares one engine process across every position in a game
    (see `evaluate_positions`), so a stale transposition table from an
    earlier position silently changing a later position's score/classification
    is the actual bug this guards against - see `analyse()`'s own docstring
    for the measured evidence. `Clear Hash` must be sent immediately before
    every search, not once at engine startup.
    """

    def test_clear_hash_precedes_the_search(self):
        engine = StockfishEngine(threads=1)
        fake = _FakeUciEngine()
        engine._engine = fake  # bypass open(): no real subprocess needed here

        engine.analyse(chess.Board())

        assert fake.calls[-2:] == ['configure:{\'Clear Hash\': None}', "analyse"]

    def test_clear_hash_sent_again_on_a_second_call(self):
        """Every call gets its own clear - not just the first one on a
        reused engine, which is exactly the scenario `evaluate_positions`
        hits (many positions, one engine)."""
        engine = StockfishEngine(threads=1)
        fake = _FakeUciEngine()
        engine._engine = fake

        engine.analyse(chess.Board())
        engine.analyse(chess.Board())

        assert fake.calls.count('configure:{\'Clear Hash\': None}') == 2
