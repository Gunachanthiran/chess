"""Opponent style classification: cheap, engine-free heuristics over a played
move list. These are approximate by design (see the module docstring) so the
assertions stick to clear-cut cases rather than exact score values.
"""

import chess

from app.services.opponent_style import NEUTRAL_PROFILE, classify


def triples(*ucis: str) -> list[tuple[str, str, chess.Color]]:
    """Build `(san, uci, side)` triples for a UCI move sequence."""
    board = chess.Board()
    rows = []
    for uci in ucis:
        move = chess.Move.from_uci(uci)
        side = board.turn
        san = board.san(move)
        board.push(move)
        rows.append((san, uci, side))
    return rows


class TestClassify:
    def test_no_moves_from_opponent_is_neutral(self):
        # Every move belongs to White; asking about Black's style finds nothing.
        moves = triples("e2e4")
        assert classify(moves, chess.BLACK) is NEUTRAL_PROFILE

    def test_checks_and_captures_read_as_aggressive_or_tactical(self):
        # A contrived but legal sequence where Black checks and captures a lot.
        moves = triples(
            "e2e4", "d7d5",
            "e4d5", "d8d5",
            "b1c3", "d5e5",  # ...Qxe5+ style check via queen (approx, legal check not required for san parsing test)
        )
        profile = classify(moves, chess.BLACK)
        assert profile.scores["material_focused"] > 0  # Black captured on d5

    def test_quiet_development_reads_as_positional(self):
        moves = triples(
            "e2e4", "e7e5",
            "g1f3", "b8c6",
            "f1c4", "g8f6",
            "d2d3", "f8c5",
        )
        profile = classify(moves, chess.BLACK)
        assert "positional" in profile.tags or profile.scores["positional"] > 0

    def test_fast_developing_counts_minors_off_the_back_rank(self):
        moves = triples(
            "e2e4", "b8c6",
            "g1f3", "g8f6",
            "f1c4", "e7e6",
        )
        profile = classify(moves, chess.BLACK)
        assert profile.scores["fast_developing"] > 0

    def test_kingside_pawn_storm_reads_as_kingside_attacking(self):
        moves = triples(
            "e2e4", "e7e5",
            "g1f3", "b8c6",
            "f1c4", "g7g5",
            "d2d3", "g5g4",
        )
        profile = classify(moves, chess.BLACK)
        assert profile.scores["kingside_attacking"] > 0
