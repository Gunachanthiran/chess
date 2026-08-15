"""Tests for PGN parsing, validation and opening detection."""

from datetime import UTC

import pytest

from app.errors import ValidationError
from app.services import openings as openings_service
from app.services.pgn_service import parse_pgn

FULL_PGN = """[Event "Casual Game"]
[Site "Berlin GER"]
[Date "1852.06.15"]
[White "Adolf Anderssen"]
[Black "Jean Dufresne"]
[Result "1-0"]
[WhiteElo "2600"]
[BlackElo "2500"]
[ECO "C52"]
[Opening "Evans Gambit"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. b4 Bxb4 5. c3 Ba5 6. d4 exd4 7. O-O d3 1-0
"""

MINIMAL_PGN = "1. e4 e5 2. Nf3 Nc6 *"

LICHESS_PGN = """[Event "Rated Blitz game"]
[Site "https://lichess.org/abcd1234"]
[White "player_one"]
[Black "player_two"]
[Result "0-1"]
[UTCDate "2024.03.09"]
[UTCTime "18:45:03"]
[WhiteElo "1720"]
[BlackElo "1755"]

1. d4 d5 2. c4 e6 3. Nc3 Nf6 0-1
"""


class TestHeaderExtraction:
    def test_extracts_player_names(self):
        parsed = parse_pgn(FULL_PGN)
        assert parsed.white_name == "Adolf Anderssen"
        assert parsed.black_name == "Jean Dufresne"

    def test_extracts_ratings_as_integers(self):
        parsed = parse_pgn(FULL_PGN)
        assert parsed.white_elo == 2600
        assert parsed.black_elo == 2500

    def test_extracts_result_and_opening_tags(self):
        parsed = parse_pgn(FULL_PGN)
        assert parsed.result == "1-0"
        assert parsed.eco == "C52"
        assert parsed.opening_name == "Evans Gambit"

    def test_parses_the_date_header(self):
        parsed = parse_pgn(FULL_PGN)
        assert parsed.played_at is not None
        assert (parsed.played_at.year, parsed.played_at.month, parsed.played_at.day) == (
            1852,
            6,
            15,
        )
        assert parsed.played_at.tzinfo is not None

    def test_combines_utc_date_and_time(self):
        parsed = parse_pgn(LICHESS_PGN)
        assert parsed.played_at is not None
        assert parsed.played_at.hour == 18
        assert parsed.played_at.minute == 45
        assert parsed.played_at.tzinfo == UTC

    def test_missing_headers_fall_back_to_defaults(self):
        parsed = parse_pgn(MINIMAL_PGN)
        assert parsed.white_name == "Unknown"
        assert parsed.black_name == "Unknown"
        assert parsed.white_elo is None
        assert parsed.black_elo is None
        assert parsed.played_at is None

    def test_unknown_result_becomes_a_star(self):
        parsed = parse_pgn(MINIMAL_PGN)
        assert parsed.result == "*"

    def test_placeholder_headers_are_treated_as_missing(self):
        pgn = '[White "?"]\n[Black "?"]\n[Date "????.??.??"]\n\n1. e4 e5 *\n'
        parsed = parse_pgn(pgn)
        assert parsed.white_name == "Unknown"
        assert parsed.played_at is None


class TestMoveExtraction:
    def test_extracts_the_mainline_in_san(self):
        parsed = parse_pgn(MINIMAL_PGN)
        assert parsed.moves_san == ["e4", "e5", "Nf3", "Nc6"]

    def test_extracts_the_mainline_in_uci(self):
        parsed = parse_pgn(MINIMAL_PGN)
        assert parsed.moves_uci == ["e2e4", "e7e5", "g1f3", "b8c6"]

    def test_handles_castling_and_captures(self):
        parsed = parse_pgn(FULL_PGN)
        assert "O-O" in parsed.moves_san
        assert "Bxb4" in parsed.moves_san
        assert len(parsed.moves_san) == 14

    def test_pgn_text_is_preserved(self):
        parsed = parse_pgn(FULL_PGN)
        assert "Anderssen" in parsed.pgn


class TestOpeningFallback:
    def test_derives_eco_and_name_when_tags_are_absent(self):
        parsed = parse_pgn(MINIMAL_PGN)
        assert parsed.eco is not None
        assert parsed.opening_name is not None

    def test_recognises_the_queens_gambit_declined(self):
        parsed = parse_pgn(LICHESS_PGN)
        assert parsed.opening_name is not None
        assert "Queen's Gambit Declined" in parsed.opening_name

    def test_existing_tags_win_over_the_bundled_table(self):
        parsed = parse_pgn(FULL_PGN)
        assert parsed.eco == "C52"


class TestValidation:
    def test_empty_input_is_rejected(self):
        with pytest.raises(ValidationError):
            parse_pgn("")

    def test_whitespace_only_input_is_rejected(self):
        with pytest.raises(ValidationError):
            parse_pgn("   \n  ")

    def test_headers_without_moves_are_rejected(self):
        with pytest.raises(ValidationError) as exc_info:
            parse_pgn('[White "a"]\n[Black "b"]\n[Result "*"]\n\n*\n')
        assert "no moves" in str(exc_info.value).lower()

    def test_illegal_moves_are_rejected(self):
        # Nf6 is well-formed but no white knight can reach f6.
        with pytest.raises(ValidationError) as exc_info:
            parse_pgn("1. e4 e5 2. Nf6 *")
        assert "illegal" in str(exc_info.value).lower()

    def test_a_move_by_the_wrong_side_is_rejected(self):
        with pytest.raises(ValidationError):
            parse_pgn("1. e4 e4 *")

    def test_comments_variations_and_nags_are_accepted(self):
        parsed = parse_pgn(
            "1. e4 e5 2. Nf3 {develops} (2. Bc4 Bc5) $1 2... Nc6 3. Bb5 1-0"
        )
        assert parsed.moves_san == ["e4", "e5", "Nf3", "Nc6", "Bb5"]
        assert parsed.result == "1-0"

    def test_garbage_input_is_rejected(self):
        with pytest.raises(ValidationError):
            parse_pgn("this is definitely not a chess game")

    def test_the_error_carries_the_standard_code(self):
        with pytest.raises(ValidationError) as exc_info:
            parse_pgn("")
        assert exc_info.value.code == "VALIDATION_ERROR"
        assert exc_info.value.status_code == 400


class TestOpeningBook:
    def test_the_bundled_table_loads(self):
        entries = openings_service.load_openings()
        assert len(entries) >= 100

    def test_known_opening_moves_are_book(self):
        assert openings_service.is_book_line(["e4", "e5", "Nf3", "Nc6", "Bc4"]) is True

    def test_nonsense_moves_are_not_book(self):
        assert openings_service.is_book_line(["a4", "h5", "a5", "h4"]) is False

    def test_an_empty_line_is_not_book(self):
        assert openings_service.is_book_line([]) is False

    def test_matches_the_longest_known_line(self):
        opening = openings_service.match_opening(
            ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "c3"]
        )
        assert opening is not None
        assert opening.eco == "C53"

    def test_match_falls_back_to_a_shorter_prefix(self):
        # The extra move is not in the table, so the Italian Game still matches.
        opening = openings_service.match_opening(["e4", "e5", "Nf3", "Nc6", "Bc4", "h6"])
        assert opening is not None
        assert "Italian" in opening.name

    def test_unknown_openings_return_none(self):
        assert openings_service.match_opening(["h4", "a5", "h5"]) is None


class TestCurrentOpening:
    """`current_opening` answers "what are we in *now*", not "what was this".

    The difference from `match_opening` is the whole point: it stops naming an
    opening once the game leaves theory, instead of freezing on the last line it
    recognised for the remaining forty moves.
    """

    def test_names_a_real_opening_mid_book(self):
        opening = openings_service.current_opening(
            ["e4", "e5", "Nf3", "Nc6", "Bb5"]
        )
        assert opening is not None
        assert "Ruy Lopez" in opening.name
        assert opening.eco.startswith("C6")

    def test_updates_as_the_line_deepens(self):
        """Each extra book move may rename the opening; it must not stick."""
        italian = openings_service.current_opening(["e4", "e5", "Nf3", "Nc6", "Bc4"])
        piano = openings_service.current_opening(
            ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"]
        )
        evans = openings_service.current_opening(
            ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "b4"]
        )
        assert italian is not None and italian.name == "Italian Game"
        assert piano is not None and "Giuoco Piano" in piano.name
        assert evans is not None and "Evans Gambit" in evans.name

    def test_a_different_defence_is_a_different_opening(self):
        sicilian = openings_service.current_opening(["e4", "c5"])
        french = openings_service.current_opening(["e4", "e6"])
        assert sicilian is not None and "Sicilian" in sicilian.name
        assert french is not None and "French" in french.name

    def test_leaving_book_returns_none(self):
        """A stale name here would be worse than no name at all."""
        # Ruy Lopez, then a move that is in no known line.
        assert (
            openings_service.current_opening(
                ["e4", "e5", "Nf3", "Nc6", "Bb5", "Qe7", "Na3"]
            )
            is None
        )

    def test_match_opening_still_reports_the_line_after_leaving_book(self):
        """Guards the distinction: the two functions must not converge."""
        left_book = ["e4", "e5", "Nf3", "Nc6", "Bb5", "Qe7", "Na3"]
        assert openings_service.match_opening(left_book) is not None
        assert openings_service.current_opening(left_book) is None

    def test_nonsense_from_move_one_is_never_named(self):
        assert openings_service.current_opening(["a4", "h5", "a5", "h4"]) is None

    def test_the_starting_position_has_no_opening(self):
        assert openings_service.current_opening([]) is None
