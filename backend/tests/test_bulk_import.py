"""Tests for bulk import: splitting multi-game PGN blobs, and import dedup.

The dedup tests need a real database because the guarantee they check is partly
a Postgres one (the partial unique indexes added in migration 0003), so they run
against the dev Postgres and roll every change back. They skip - loudly - if the
database is not reachable.
"""

from __future__ import annotations

import uuid

import pytest
import sqlalchemy as sa

from app.errors import ValidationError
from app.models.game import Game, GameSource
from app.services import pgn_service
from app.services.pgn_service import split_pgn_games

GAME_ONE = """[Event "Rated Blitz game"]
[Site "https://lichess.org/aaaa1111"]
[White "alice"]
[Black "bob"]
[Result "1-0"]
[UTCDate "2024.03.09"]
[UTCTime "18:45:03"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0
"""

GAME_TWO = """[Event "Rated Bullet game"]
[Site "https://lichess.org/bbbb2222"]
[White "bob"]
[Black "alice"]
[Result "0-1"]
[UTCDate "2024.03.10"]
[UTCTime "09:12:00"]

1. d4 d5 2. c4 e6 3. Nc3 Nf6 0-1
"""

GAME_THREE = """[Event "Casual game"]
[Site "https://lichess.org/cccc3333"]
[White "carol"]
[Black "dave"]
[Result "1/2-1/2"]

1. c4 c5 2. g3 g6 1/2-1/2
"""

CHESSCOM_GAME = """[Event "Live Chess"]
[Site "Chess.com"]
[Date "2024.05.01"]
[White "hikaru"]
[Black "someone"]
[Result "1-0"]
[Link "https://www.chess.com/game/live/123456789"]

1. e4 c5 2. Nf3 d6 1-0
"""

BLOB_OF_THREE = "\n\n".join([GAME_ONE, GAME_TWO, GAME_THREE])


class TestSplitPGNGames:
    def test_splits_a_blob_into_each_game(self):
        games = split_pgn_games(BLOB_OF_THREE)
        assert len(games) == 3

    def test_each_split_game_is_independently_parseable(self):
        for text in split_pgn_games(BLOB_OF_THREE):
            parsed = pgn_service.parse_pgn(text)
            assert parsed.moves_san

    def test_preserves_per_game_headers_and_order(self):
        games = split_pgn_games(BLOB_OF_THREE)
        parsed = [pgn_service.parse_pgn(text) for text in games]

        assert [game.white_name for game in parsed] == ["alice", "bob", "carol"]
        assert [game.result for game in parsed] == ["1-0", "0-1", "1/2-1/2"]

    def test_keeps_the_site_header_so_ids_survive_the_round_trip(self):
        ids = [
            pgn_service.lichess_game_id_from_pgn(text)
            for text in split_pgn_games(BLOB_OF_THREE)
        ]
        assert ids == ["aaaa1111", "bbbb2222", "cccc3333"]

    def test_a_single_game_blob_returns_one_game(self):
        assert len(split_pgn_games(GAME_ONE)) == 1

    def test_an_empty_blob_returns_nothing(self):
        assert split_pgn_games("") == []
        assert split_pgn_games("   \n\n  ") == []

    def test_a_trailing_game_with_illegal_moves_is_skipped(self):
        blob = (
            BLOB_OF_THREE
            + '\n\n[Event "Broken"]\n[White "x"]\n[Black "y"]\n\n1. e4 e5 2. Kd5 *\n'
        )
        games = split_pgn_games(blob)

        assert len(games) == 3
        assert pgn_service.parse_pgn(games[0]).white_name == "alice"

    def test_a_game_with_illegal_moves_in_the_middle_does_not_stop_the_batch(self):
        blob = "\n\n".join(
            [
                GAME_ONE,
                '[Event "Broken"]\n[White "x"]\n[Black "y"]\n\n1. d4 d5 2. Kd3 *\n',
                GAME_TWO,
            ]
        )
        games = split_pgn_games(blob)

        assert len(games) == 2
        assert [pgn_service.parse_pgn(text).white_name for text in games] == [
            "alice",
            "bob",
        ]

    def test_trailing_junk_text_does_not_crash(self):
        games = split_pgn_games(BLOB_OF_THREE + "\n\nnot a chess game at all\n")
        assert len(games) == 3

    def test_a_header_only_fragment_is_skipped(self):
        blob = GAME_ONE + '\n\n[Event "Empty"]\n[White "nobody"]\n[Result "*"]\n\n*\n'
        assert len(split_pgn_games(blob)) == 1

    def test_a_blob_of_only_junk_returns_nothing(self):
        assert split_pgn_games("total nonsense, no games here") == []


class TestExternalGameIds:
    def test_reads_a_lichess_id_from_the_site_header(self):
        assert pgn_service.lichess_game_id_from_pgn(GAME_ONE) == "aaaa1111"

    def test_returns_none_without_a_lichess_site_header(self):
        assert pgn_service.lichess_game_id_from_pgn(CHESSCOM_GAME) is None

    def test_reads_a_chesscom_id_from_the_link_header(self):
        assert pgn_service.chess_com_game_id_from_pgn(CHESSCOM_GAME) == "live_123456789"

    def test_live_and_daily_ids_do_not_collide(self):
        daily = CHESSCOM_GAME.replace("/game/live/", "/game/daily/")
        assert pgn_service.chess_com_game_id_from_pgn(daily) == "daily_123456789"

    def test_returns_none_without_a_link_header(self):
        assert pgn_service.chess_com_game_id_from_pgn(GAME_ONE) is None


# --- Dedup (needs the database; `db`/`db_engine` fixtures live in conftest.py) --


def unique_id(prefix: str) -> str:
    return f"{prefix}{uuid.uuid4().hex[:8]}"


def pgn_with_site(game_id: str) -> str:
    return GAME_ONE.replace("aaaa1111", game_id)


def pgn_with_link(game_id: str) -> str:
    return CHESSCOM_GAME.replace("123456789", game_id)


class TestImportDedup:
    def test_importing_a_new_lichess_game_creates_a_row(self, db):
        from app.services import game_service

        game_id = unique_id("lc")
        game, created = game_service.import_game_from_pgn(
            db,
            pgn_with_site(game_id),
            GameSource.lichess,
            lichess_game_id=game_id,
            imported_username="alice",
        )

        assert created is True
        assert game.lichess_game_id == game_id
        assert game.imported_username == "alice"

    def test_reimporting_the_same_lichess_id_returns_the_existing_row(self, db):
        from app.services import game_service

        game_id = unique_id("lc")
        first, first_created = game_service.import_game_from_pgn(
            db, pgn_with_site(game_id), GameSource.lichess, lichess_game_id=game_id
        )
        second, second_created = game_service.import_game_from_pgn(
            db, pgn_with_site(game_id), GameSource.lichess, lichess_game_id=game_id
        )

        assert first_created is True
        assert second_created is False
        assert second.id == first.id

    def test_reimporting_does_not_insert_a_duplicate(self, db):
        from app.services import game_service

        game_id = unique_id("lc")
        for _ in range(3):
            game_service.import_game_from_pgn(
                db, pgn_with_site(game_id), GameSource.lichess, lichess_game_id=game_id
            )

        count = db.scalar(
            sa.select(sa.func.count())
            .select_from(Game)
            .where(Game.lichess_game_id == game_id)
        )
        assert count == 1

    def test_chess_com_games_dedup_on_their_own_id(self, db):
        from app.services import game_service

        game_id = unique_id("cc")
        first, first_created = game_service.import_game_from_pgn(
            db,
            pgn_with_link(game_id),
            GameSource.chess_com,
            chess_com_game_id=game_id,
            imported_username="hikaru",
        )
        second, second_created = game_service.import_game_from_pgn(
            db, pgn_with_link(game_id), GameSource.chess_com, chess_com_game_id=game_id
        )

        assert first_created is True
        assert second_created is False
        assert second.id == first.id
        assert second.source is GameSource.chess_com

    def test_different_ids_are_separate_games(self, db):
        from app.services import game_service

        one = unique_id("lc")
        two = unique_id("lc")
        first, _ = game_service.import_game_from_pgn(
            db, pgn_with_site(one), GameSource.lichess, lichess_game_id=one
        )
        second, second_created = game_service.import_game_from_pgn(
            db, pgn_with_site(two), GameSource.lichess, lichess_game_id=two
        )

        assert second_created is True
        assert second.id != first.id

    def test_uploads_without_an_external_id_are_never_deduped(self, db):
        from app.services import game_service

        first, first_created = game_service.import_game_from_pgn(
            db, GAME_TWO, GameSource.upload
        )
        second, second_created = game_service.import_game_from_pgn(
            db, GAME_TWO, GameSource.upload
        )

        assert first_created is True
        assert second_created is True
        assert first.id != second.id

    def test_create_game_from_pgn_keeps_returning_the_game(self, db):
        from app.services import game_service

        game_id = unique_id("lc")
        first = game_service.create_game_from_pgn(
            db, pgn_with_site(game_id), GameSource.lichess, lichess_game_id=game_id
        )
        second = game_service.create_game_from_pgn(
            db, pgn_with_site(game_id), GameSource.lichess, lichess_game_id=game_id
        )

        assert second.id == first.id

    def test_an_unparseable_pgn_still_raises(self, db):
        from app.services import game_service

        with pytest.raises(ValidationError):
            game_service.import_game_from_pgn(
                db, "not a game", GameSource.upload
            )
