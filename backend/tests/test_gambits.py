"""The bundled gambit library: loader sanity and data integrity.

`validate_gambits` replaying every `starting_moves` list is the important
one here — it turns a typo'd SAN in `app/data/gambits.json` into a failing
test instead of a bot silently never entering that gambit (or worse, a
runtime crash mid-game).
"""

import pytest

from app.services import gambits


class TestLoadGambits:
    def test_loads_more_than_a_handful(self):
        assert len(gambits.load_gambits()) >= 15

    def test_every_id_is_unique(self):
        ids = [g.id for g in gambits.load_gambits()]
        assert len(ids) == len(set(ids))

    def test_every_gambit_has_at_least_one_starting_move(self):
        # Almost every gambit is several moves deep, but a single committal
        # first move (Grob's Attack, 1.g4) is a legitimate opening choice too.
        for gambit in gambits.load_gambits():
            assert len(gambit.starting_moves) >= 1

    def test_side_is_white_or_black(self):
        for gambit in gambits.load_gambits():
            assert gambit.side in ("white", "black")


class TestStartingMovesAreLegal:
    def test_every_gambit_replays_legally_from_the_start_position(self):
        gambits.validate_gambits()  # raises on any illegal SAN

    @pytest.mark.parametrize("gambit", gambits.load_gambits(), ids=lambda g: g.id)
    def test_final_starting_move_is_played_by_the_gambit_side(self, gambit):
        """The gambit's `side` is whoever plays its *last* scripted move —
        that's the side actually "offering" the gambit."""
        # Odd-length SAN list (1-indexed ply) ends on White; even ends on Black.
        mover_is_white = len(gambit.starting_moves) % 2 == 1
        expected_side = "white" if mover_is_white else "black"
        assert gambit.side == expected_side


class TestGetAndListGambits:
    def test_get_gambit_by_id_round_trips(self):
        first = gambits.load_gambits()[0]
        assert gambits.get_gambit(first.id) is first

    def test_get_gambit_unknown_id_is_none(self):
        assert gambits.get_gambit("not-a-real-gambit") is None

    def test_list_gambits_filters_by_side(self):
        white_only = gambits.list_gambits(side="white")
        assert white_only
        assert all(gambit.side == "white" for gambit in white_only)


class TestIsGambitLine:
    def test_empty_sequence_is_on_every_line(self):
        gambit = gambits.get_gambit("kings_gambit")
        assert gambits.is_gambit_line(gambit, [])

    def test_exact_prefix_is_on_line(self):
        gambit = gambits.get_gambit("kings_gambit")
        assert gambits.is_gambit_line(gambit, ["e4"])
        assert gambits.is_gambit_line(gambit, ["e4", "e5"])
        assert gambits.is_gambit_line(gambit, ["e4", "e5", "f4"])

    def test_diverging_move_is_off_line(self):
        gambit = gambits.get_gambit("kings_gambit")
        assert not gambits.is_gambit_line(gambit, ["e4", "c5"])

    def test_longer_than_the_line_is_off_line(self):
        gambit = gambits.get_gambit("kings_gambit")
        assert not gambits.is_gambit_line(gambit, ["e4", "e5", "f4", "exf4", "Nf3"])
