"""Tests for bot game state: board reconstruction and game-over detection.

No database is touched here - `reconstruct_board` and `_finish_if_over` are the
two pieces that decide legality and results, and both are pure.
"""

import chess
import pytest

from app.errors import ValidationError
from app.models.bot_game import BotColor, BotGame, BotGameStatus
from app.models.bot_game_move import BotGameMove
from app.models.move_analysis import Side
from app.services import bot_game_service


def move_rows(*ucis: str) -> list[BotGameMove]:
    """Build unsaved BotGameMove rows for a UCI sequence."""
    board = chess.Board()
    rows = []
    for index, uci in enumerate(ucis, start=1):
        move = chess.Move.from_uci(uci)
        side = Side.white if board.turn == chess.WHITE else Side.black
        san = board.san(move)
        board.push(move)
        rows.append(
            BotGameMove(
                ply=index,
                side=side,
                san=san,
                uci=uci,
                fen_after=board.fen(),
                is_bot_move=index % 2 == 0,
            )
        )
    return rows


def game(player_color=BotColor.white) -> BotGame:
    return BotGame(
        player_color=player_color,
        bot_elo=1500,
        bot_aggression=3,
        status=BotGameStatus.in_progress,
    )


class TestReconstructBoard:
    def test_empty_history_is_the_starting_position(self):
        board = bot_game_service.reconstruct_board(game(), [])
        assert board.fen() == chess.Board().fen()

    def test_replays_moves_in_ply_order(self):
        rows = move_rows("e2e4", "e7e5", "g1f3", "b8c6")
        board = bot_game_service.reconstruct_board(game(), rows)
        assert board.fullmove_number == 3
        assert board.turn == chess.WHITE
        assert board.piece_at(chess.F3) == chess.Piece(chess.KNIGHT, chess.WHITE)

    def test_shuffled_rows_still_replay_correctly(self):
        """Ordering comes from `ply`, not from the list the DB happened to return."""
        rows = move_rows("e2e4", "e7e5", "g1f3", "b8c6")
        expected = bot_game_service.reconstruct_board(game(), rows).fen()

        shuffled = [rows[2], rows[0], rows[3], rows[1]]
        assert bot_game_service.reconstruct_board(game(), shuffled).fen() == expected

    def test_move_stack_is_preserved_for_repetition_claims(self):
        rows = move_rows("g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8")
        board = bot_game_service.reconstruct_board(game(), rows)
        assert len(board.move_stack) == 8
        assert board.can_claim_threefold_repetition()


class TestParseLegalMove:
    @pytest.mark.parametrize("uci", ["e2e5", "zzzz", "e9e1", "", "a1a1"])
    def test_bad_input_raises_illegal_move_without_mutating(self, uci):
        board = chess.Board()
        before = board.fen()

        with pytest.raises(ValidationError) as exc:
            bot_game_service._parse_legal_move(board, uci)

        assert exc.value.code == "ILLEGAL_MOVE"
        assert exc.value.status_code == 400
        assert exc.value.detail["uci"] == uci
        assert board.fen() == before  # never pushed

    def test_legal_move_is_returned(self):
        board = chess.Board()
        assert bot_game_service._parse_legal_move(board, "e2e4") == chess.Move.from_uci(
            "e2e4"
        )


class TestGameOverDetection:
    def test_checkmate_by_black_records_a_black_win(self):
        board = chess.Board()
        for san in ["f3", "e5", "g4", "Qh4#"]:
            board.push_san(san)

        bot_game = game()
        assert bot_game_service._finish_if_over(bot_game, board) is True
        assert bot_game.status is BotGameStatus.checkmate
        assert bot_game.result == "0-1"

    def test_checkmate_by_white_records_a_white_win(self):
        board = chess.Board()
        for san in ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"]:
            board.push_san(san)

        bot_game = game()
        assert bot_game_service._finish_if_over(bot_game, board) is True
        assert bot_game.status is BotGameStatus.checkmate
        assert bot_game.result == "1-0"

    def test_stalemate_is_a_draw(self):
        board = chess.Board("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1")
        assert board.is_stalemate()

        bot_game = game()
        assert bot_game_service._finish_if_over(bot_game, board) is True
        assert bot_game.status is BotGameStatus.stalemate
        assert bot_game.result == "1/2-1/2"

    def test_insufficient_material_is_a_draw(self):
        board = chess.Board("8/8/4k3/8/8/4K3/8/7B w - - 0 1")
        assert board.is_insufficient_material()

        bot_game = game()
        assert bot_game_service._finish_if_over(bot_game, board) is True
        assert bot_game.status is BotGameStatus.draw
        assert bot_game.result == "1/2-1/2"

    def test_threefold_repetition_does_not_end_the_game(self):
        """Threefold is *claimable*, not automatic - play must continue.

        Auto-ending here was the bug: the game died the moment any position
        happened to occur three times, which is nothing like the real rule.
        """
        rows = move_rows("g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8")
        board = bot_game_service.reconstruct_board(game(), rows)
        assert board.can_claim_threefold_repetition()  # claimable...
        assert not board.is_fivefold_repetition()  # ...but not automatic

        bot_game = game()
        assert bot_game_service._finish_if_over(bot_game, board) is False
        assert bot_game.status is BotGameStatus.in_progress
        assert bot_game.result is None

    def test_fivefold_repetition_is_still_a_draw(self):
        """The genuinely automatic repetition draw must keep working."""
        shuffle = ["g1f3", "g8f6", "f3g1", "f6g8"]
        board = bot_game_service.reconstruct_board(game(), move_rows(*(shuffle * 4)))
        assert board.is_fivefold_repetition()

        bot_game = game()
        assert bot_game_service._finish_if_over(bot_game, board) is True
        assert bot_game.status is BotGameStatus.draw
        assert bot_game.result == "1/2-1/2"

    def test_fifty_move_rule_does_not_end_the_game(self):
        """Also claimable-only; only the 75-move rule is automatic."""
        board = chess.Board("8/8/4k3/8/8/4K3/8/R7 w - - 100 80")
        assert board.can_claim_fifty_moves()
        assert not board.is_seventyfive_moves()

        bot_game = game()
        assert bot_game_service._finish_if_over(bot_game, board) is False
        assert bot_game.status is BotGameStatus.in_progress

    def test_seventyfive_move_rule_is_still_a_draw(self):
        board = chess.Board("8/8/4k3/8/8/4K3/8/R7 w - - 150 105")
        assert board.is_seventyfive_moves()

        bot_game = game()
        assert bot_game_service._finish_if_over(bot_game, board) is True
        assert bot_game.status is BotGameStatus.draw
        assert bot_game.result == "1/2-1/2"

    def test_ongoing_game_is_left_alone(self):
        board = chess.Board()
        board.push_san("e4")

        bot_game = game()
        assert bot_game_service._finish_if_over(bot_game, board) is False
        assert bot_game.status is BotGameStatus.in_progress
        assert bot_game.result is None


class TestClaimDrawEligibility:
    """`claim_draw` gates on `board.can_claim_draw()` directly - these lock in
    that the exact positions `TestGameOverDetection` already proved are
    claimable-not-automatic are also what this predicate says yes to, and
    that an ordinary ongoing position says no."""

    def test_threefold_repetition_is_claimable(self):
        rows = move_rows("g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8")
        board = bot_game_service.reconstruct_board(game(), rows)
        assert board.can_claim_draw()

    def test_fifty_move_rule_is_claimable(self):
        board = chess.Board("8/8/4k3/8/8/4K3/8/R7 w - - 100 80")
        assert board.can_claim_draw()

    def test_ordinary_opening_position_is_not_claimable(self):
        board = bot_game_service.reconstruct_board(game(), move_rows("e2e4", "e7e5"))
        assert not board.can_claim_draw()


class TestCurrentOpening:
    """The live opening indicator, computed from the stored SAN list.

    No DB here either: the function reads `bot_game.moves`, so unsaved rows are
    enough to exercise exactly what the response path does.
    """

    def test_a_fresh_game_has_no_opening(self):
        assert bot_game_service.current_opening(game()) == (None, None)

    def test_a_book_position_reports_eco_and_name(self):
        bot_game = game()
        # 1. e4 e5 2. Nf3 Nc6 3. Bb5 - Ruy Lopez.
        bot_game.moves = move_rows("e2e4", "e7e5", "g1f3", "b8c6", "f1b5")

        eco, name = bot_game_service.current_opening(bot_game)
        assert eco == "C60"
        assert name == "Ruy Lopez"

    def test_the_opening_updates_as_the_game_progresses(self):
        bot_game = game()
        bot_game.moves = move_rows("e2e4", "e7e5", "g1f3", "b8c6", "f1c4")
        assert bot_game_service.current_opening(bot_game)[1] == "Italian Game"

        bot_game.moves = move_rows("e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "f8c5")
        assert "Giuoco Piano" in bot_game_service.current_opening(bot_game)[1]

    def test_leaving_book_clears_the_indicator(self):
        bot_game = game()
        bot_game.moves = move_rows(
            "e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "d8e7", "b1a3"
        )
        assert bot_game_service.current_opening(bot_game) == (None, None)

    def test_moves_are_read_in_ply_order(self):
        """The relationship is ordered, but the function must not rely on it."""
        bot_game = game()
        rows = move_rows("e2e4", "e7e5", "g1f3", "b8c6", "f1b5")
        bot_game.moves = list(reversed(rows))

        assert bot_game_service.current_opening(bot_game)[1] == "Ruy Lopez"
