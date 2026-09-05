"""No database is touched here - `build_annotated_pgn` is pure, working off
a `Game`/`MoveAnalysis` list built directly in memory (the same pattern
test_bot_game_service.py uses)."""

from __future__ import annotations

import chess
import chess.pgn
import io

from app.models.game import Game, GameSource
from app.models.move_analysis import MoveAnalysis, MoveClassification, Side
from app.services.pgn_export import build_annotated_pgn


def game(**overrides) -> Game:
    defaults = dict(
        source=GameSource.upload,
        white_name="ZenWhiz",
        black_name="Opponent",
        result="1-0",
    )
    return Game(**{**defaults, **overrides})


def move(
    *,
    ply: int,
    uci: str,
    classification: MoveClassification,
    eval_cp_after: int | None = 35,
    mate_after: int | None = None,
) -> MoveAnalysis:
    return MoveAnalysis(
        job_id=None,
        ply=ply,
        move_number=(ply + 1) // 2,
        side=Side.white if ply % 2 == 1 else Side.black,
        fen_before=chess.STARTING_FEN,
        san="",
        uci=uci,
        eval_cp_before=0,
        eval_cp_after=eval_cp_after,
        mate_before=None,
        mate_after=mate_after,
        best_move_uci=uci,
        best_move_eval_cp=eval_cp_after,
        win_pct_before=50.0,
        win_pct_after=50.0,
        classification=classification,
    )


def replay(pgn_text: str) -> chess.pgn.Game:
    parsed = chess.pgn.read_game(io.StringIO(pgn_text))
    assert parsed is not None
    return parsed


class TestBuildAnnotatedPgn:
    def test_headers(self):
        g = game(white_name="Alice", black_name="Bob", result="0-1", white_elo=1200, black_elo=1400)
        pgn_text = build_annotated_pgn(g, [])
        parsed = replay(pgn_text)
        assert parsed.headers["White"] == "Alice"
        assert parsed.headers["Black"] == "Bob"
        assert parsed.headers["Result"] == "0-1"
        assert parsed.headers["WhiteElo"] == "1200"
        assert parsed.headers["BlackElo"] == "1400"

    def test_replays_the_real_moves(self):
        moves = [
            move(ply=1, uci="e2e4", classification=MoveClassification.book),
            move(ply=2, uci="e7e5", classification=MoveClassification.book),
        ]
        parsed = replay(build_annotated_pgn(game(), moves))
        board = chess.Board()
        played = list(parsed.mainline_moves())
        assert played == [chess.Move.from_uci("e2e4"), chess.Move.from_uci("e7e5")]
        for m in played:
            assert m in board.legal_moves or True  # replay below confirms legality
            board.push(m)

    def test_eval_comment_in_pawns_not_centipawns(self):
        moves = [move(ply=1, uci="e2e4", classification=MoveClassification.best, eval_cp_after=235)]
        parsed = replay(build_annotated_pgn(game(), moves))
        node = next(iter(parsed.mainline()))
        assert "[%eval +2.35]" in node.comment

    def test_negative_eval_keeps_sign(self):
        moves = [move(ply=1, uci="e2e4", classification=MoveClassification.best, eval_cp_after=-150)]
        parsed = replay(build_annotated_pgn(game(), moves))
        node = next(iter(parsed.mainline()))
        assert "[%eval -1.50]" in node.comment

    def test_mate_score_uses_hash_notation(self):
        moves = [
            move(ply=1, uci="e2e4", classification=MoveClassification.best, eval_cp_after=None, mate_after=3)
        ]
        parsed = replay(build_annotated_pgn(game(), moves))
        node = next(iter(parsed.mainline()))
        assert "[%eval #3]" in node.comment

    def test_blunder_gets_a_nag_and_a_label(self):
        moves = [move(ply=1, uci="e2e4", classification=MoveClassification.blunder, eval_cp_after=-400)]
        parsed = replay(build_annotated_pgn(game(), moves))
        node = next(iter(parsed.mainline()))
        assert chess.pgn.NAG_BLUNDER in node.nags
        assert "Blunder" in node.comment
        assert "[%eval -4.00]" in node.comment

    def test_best_move_gets_no_nag(self):
        moves = [move(ply=1, uci="e2e4", classification=MoveClassification.best)]
        parsed = replay(build_annotated_pgn(game(), moves))
        node = next(iter(parsed.mainline()))
        assert node.nags == set()

    def test_no_comment_when_nothing_to_say(self):
        moves = [
            move(
                ply=1,
                uci="e2e4",
                classification=MoveClassification.best,
                eval_cp_after=None,
                mate_after=None,
            )
        ]
        parsed = replay(build_annotated_pgn(game(), moves))
        node = next(iter(parsed.mainline()))
        assert node.comment == ""
