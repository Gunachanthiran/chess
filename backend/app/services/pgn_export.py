"""Export a completed analysis as an annotated PGN — the position after
each move gets a Lichess-style `[%eval ...]` comment plus a standard NAG
glyph for the moves worth flagging, so any real chess GUI (or a re-import
into Lichess/Chess.com) renders the same evaluation graph and move markers
this app shows, not just the bare move list a plain PGN export would carry.
"""

from __future__ import annotations

import chess
import chess.pgn

from app.models.game import Game
from app.models.move_analysis import MoveAnalysis, MoveClassification

# Only the classifications worth a glyph a standard PGN reader already knows
# how to render - "best"/"excellent"/"good"/"book"/"forced" are the expected
# default and would just add visual noise as a NAG on every single move.
_NAG_BY_CLASSIFICATION: dict[MoveClassification, int] = {
    MoveClassification.brilliant: chess.pgn.NAG_BRILLIANT_MOVE,  # !!
    MoveClassification.great: chess.pgn.NAG_GOOD_MOVE,  # !
    MoveClassification.inaccuracy: chess.pgn.NAG_DUBIOUS_MOVE,  # ?!
    MoveClassification.mistake: chess.pgn.NAG_MISTAKE,  # ?
    MoveClassification.blunder: chess.pgn.NAG_BLUNDER,  # ??
}

# Shown in the comment alongside the eval, so the annotation reads even in a
# GUI that doesn't render NAGs as glyphs at all.
_LABEL_BY_CLASSIFICATION: dict[MoveClassification, str] = {
    MoveClassification.brilliant: "Brilliant",
    MoveClassification.great: "Great move",
    MoveClassification.inaccuracy: "Inaccuracy",
    MoveClassification.mistake: "Mistake",
    MoveClassification.blunder: "Blunder",
}


def _eval_comment(move: MoveAnalysis) -> str | None:
    """Lichess's own `[%eval ...]` convention: pawns (not centipawns) for a
    normal score, `#N` for a forced mate in `N` (sign follows White, same as
    every eval this app already stores) - the same syntax Lichess's own
    exported PGNs use, so a re-import there renders the identical graph.
    """
    label = _LABEL_BY_CLASSIFICATION.get(move.classification)

    if move.mate_after is not None:
        eval_text = f"#{move.mate_after}"
    elif move.eval_cp_after is not None:
        eval_text = f"{move.eval_cp_after / 100:+.2f}"
    else:
        return label

    return f"{label}. [%eval {eval_text}]" if label else f"[%eval {eval_text}]"


def build_annotated_pgn(game: Game, moves: list[MoveAnalysis]) -> str:
    """`moves` must already be ordered by `ply` ascending (the same order
    `get_job_moves` returns them in) - this replays them onto a fresh board
    in that order and never re-sorts, so an out-of-order list would silently
    produce a wrong game rather than a loud error.
    """
    pgn_game = chess.pgn.Game()
    pgn_game.headers["Event"] = "ChessScope analysis export"
    pgn_game.headers["White"] = game.white_name
    pgn_game.headers["Black"] = game.black_name
    pgn_game.headers["Result"] = game.result
    if game.white_elo is not None:
        pgn_game.headers["WhiteElo"] = str(game.white_elo)
    if game.black_elo is not None:
        pgn_game.headers["BlackElo"] = str(game.black_elo)
    if game.eco:
        pgn_game.headers["ECO"] = game.eco
    if game.opening_name:
        pgn_game.headers["Opening"] = game.opening_name
    if game.played_at:
        pgn_game.headers["Date"] = game.played_at.strftime("%Y.%m.%d")

    node: chess.pgn.GameNode = pgn_game
    for move in moves:
        node = node.add_variation(chess.Move.from_uci(move.uci))
        comment = _eval_comment(move)
        if comment:
            node.comment = comment
        nag = _NAG_BY_CLASSIFICATION.get(move.classification)
        if nag is not None:
            node.nags.add(nag)

    return str(pgn_game)
