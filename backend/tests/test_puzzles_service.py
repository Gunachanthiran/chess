from __future__ import annotations

import random
import uuid

from app.models.move_analysis import MoveClassification, Side
from app.services.puzzles_service import PuzzleCandidate, is_my_mistake, select_puzzles


def candidate(
    *,
    side: Side = Side.white,
    white_name: str = "ZenWhiz",
    black_name: str = "Opponent",
    imported_username: str | None = "ZenWhiz",
    classification: MoveClassification = MoveClassification.blunder,
) -> PuzzleCandidate:
    return PuzzleCandidate(
        move_analysis_id=uuid.uuid4(),
        game_id=uuid.uuid4(),
        fen_before="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        played_san="e4",
        played_uci="e2e4",
        best_move_uci="d2d4",
        classification=classification,
        side=side,
        white_name=white_name,
        black_name=black_name,
        imported_username=imported_username,
        opening_name=None,
        played_at=None,
    )


class TestIsMyMistake:
    def test_white_side_match(self):
        assert is_my_mistake(candidate(side=Side.white, imported_username="ZenWhiz")) is True

    def test_black_side_match(self):
        c = candidate(side=Side.black, imported_username="Opponent")
        assert is_my_mistake(c) is True

    def test_wrong_side_is_excluded(self):
        # White blundered, but the imported user was Black — this is the
        # opponent's mistake, not mine, and must never surface as "my" puzzle.
        c = candidate(side=Side.white, imported_username="Opponent")
        assert is_my_mistake(c) is False

    def test_no_imported_username_is_excluded(self):
        assert is_my_mistake(candidate(imported_username=None)) is False
        assert is_my_mistake(candidate(imported_username="")) is False

    def test_case_and_whitespace_insensitive(self):
        c = candidate(side=Side.white, white_name="ZenWhiz", imported_username="  zenwhiz  ")
        assert is_my_mistake(c) is True

    def test_ambiguous_when_both_names_match(self):
        # A player facing themselves — neither side is unambiguously "mine".
        c = candidate(side=Side.white, white_name="Same", black_name="Same", imported_username="Same")
        assert is_my_mistake(c) is False


class TestSelectPuzzles:
    def test_filters_to_my_mistakes_only(self):
        mine = candidate(side=Side.white, imported_username="ZenWhiz")
        theirs = candidate(side=Side.black, imported_username="ZenWhiz")
        selected, total = select_puzzles([mine, theirs], limit=10)
        assert selected == [mine]
        assert total == 1

    def test_caps_at_limit_but_reports_full_total(self):
        candidates = [candidate() for _ in range(10)]
        selected, total = select_puzzles(candidates, limit=3)
        assert len(selected) == 3
        assert total == 10

    def test_empty_input(self):
        selected, total = select_puzzles([], limit=10)
        assert selected == []
        assert total == 0

    def test_shuffles_rather_than_returning_input_order(self):
        candidates = [candidate() for _ in range(30)]
        # A fixed seed makes this deterministic rather than flaky: with 30
        # items, the odds of a real shuffle reproducing the original order
        # are astronomically small, so this reliably tells "shuffled" apart
        # from "returned untouched".
        selected, _total = select_puzzles(candidates, limit=30, rng=random.Random(1))
        assert selected != candidates
        assert sorted(c.move_analysis_id for c in selected) == sorted(
            c.move_analysis_id for c in candidates
        )
