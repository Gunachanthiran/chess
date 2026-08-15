"""Game-state handling for games played against the Tal-style bot.

The single rule that everything else hangs off: **the board is always replayed
from the stored move history**. No client-supplied FEN is ever trusted for
legality, and the `fen_after` column exists purely so the UI can render a
position without replaying it. Trusting stale client state is precisely what
produced the "bot produces invalid moves" bug class this design guards against.
"""

from __future__ import annotations

import chess
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import ConflictError, ValidationError
from app.models.bot_game import BotColor, BotGame, BotGameStatus
from app.models.bot_game_move import BotGameMove
from app.models.move_analysis import Side
from app.services import openings as openings_service
from app.services import tal_bot

DRAW_RESULT = "1/2-1/2"
WHITE_WIN = "1-0"
BLACK_WIN = "0-1"


# --- Board reconstruction --------------------------------------------------


def reconstruct_board(bot_game: BotGame, moves: list[BotGameMove]) -> chess.Board:
    """Replay every stored move in ply order. The authoritative board state."""
    board = chess.Board()
    for move in sorted(moves, key=lambda row: row.ply):
        board.push(chess.Move.from_uci(move.uci))
    return board


def current_opening(bot_game: BotGame) -> tuple[str | None, str | None]:
    """(eco, name) for the opening this game is currently in, or (None, None).

    Computed from the stored SAN list on every response rather than stored on
    the row: the answer changes with every move, so a column would need
    rewriting each ply and could silently go stale, while the lookup itself is a
    dict hit against an in-memory table. Once the game leaves known theory this
    goes back to (None, None) - see `openings.current_opening`.
    """
    moves_san = [move.san for move in sorted(bot_game.moves, key=lambda row: row.ply)]
    opening = openings_service.current_opening(moves_san)
    if opening is None:
        return None, None
    return opening.eco, opening.name


def load_moves(db: Session, bot_game: BotGame) -> list[BotGameMove]:
    return list(
        db.scalars(
            select(BotGameMove)
            .where(BotGameMove.bot_game_id == bot_game.id)
            .order_by(BotGameMove.ply.asc())
        ).all()
    )


# --- Commands --------------------------------------------------------------


def create_bot_game(
    db: Session,
    player_color: BotColor,
    bot_elo: int,
    bot_aggression: int,
) -> BotGame:
    """Create a game; if the bot has White, it plays the opening move at once."""
    bot_game = BotGame(
        player_color=player_color,
        bot_elo=bot_elo,
        bot_aggression=bot_aggression,
        status=BotGameStatus.in_progress,
    )
    db.add(bot_game)
    db.commit()
    db.refresh(bot_game)

    if player_color is BotColor.black:
        board = chess.Board()
        bot_move = tal_bot.choose_bot_move(board, bot_elo, bot_aggression)
        _record_move(db, bot_game, board, bot_move, ply=1, is_bot_move=True)
        db.commit()

    return _refreshed(db, bot_game)


def submit_player_move(db: Session, bot_game: BotGame, uci: str) -> BotGame:
    """Apply the human's move, then the bot's reply, updating the game status."""
    if bot_game.status is not BotGameStatus.in_progress:
        raise ConflictError(
            "This game is already over.",
            {"bot_game_id": str(bot_game.id), "status": bot_game.status.value},
            code="GAME_OVER",
        )

    moves = load_moves(db, bot_game)
    board = reconstruct_board(bot_game, moves)
    next_ply = len(moves) + 1

    player_turn = (
        chess.WHITE if bot_game.player_color is BotColor.white else chess.BLACK
    )
    if board.turn != player_turn:
        # Not reachable in the normal synchronous flow; guards replayed requests.
        raise ValidationError(
            "It is not your turn.",
            {"bot_game_id": str(bot_game.id), "fen": board.fen()},
            code="NOT_YOUR_TURN",
        )

    move = _parse_legal_move(board, uci)
    _record_move(db, bot_game, board, move, ply=next_ply, is_bot_move=False)
    next_ply += 1

    if not _finish_if_over(bot_game, board):
        bot_move = tal_bot.choose_bot_move(
            board, bot_game.bot_elo, bot_game.bot_aggression
        )
        _record_move(db, bot_game, board, bot_move, ply=next_ply, is_bot_move=True)
        _finish_if_over(bot_game, board)

    db.commit()
    return _refreshed(db, bot_game)


# --- Internals -------------------------------------------------------------


def _refreshed(db: Session, bot_game: BotGame) -> BotGame:
    """Reload the row and its move list so the response never serialises stale
    state (`expire_on_commit=False` leaves both untouched after a commit)."""
    db.refresh(bot_game)
    len(bot_game.moves)
    return bot_game


def _parse_legal_move(board: chess.Board, uci: str) -> chess.Move:
    """Parse `uci` against the reconstructed board. Never pushes on failure."""
    try:
        move = chess.Move.from_uci(uci)
    except (ValueError, chess.InvalidMoveError) as exc:
        raise ValidationError(
            "Move is not legal in this position.",
            {"uci": uci, "fen": board.fen()},
            code="ILLEGAL_MOVE",
        ) from exc

    if not board.is_legal(move):
        raise ValidationError(
            "Move is not legal in this position.",
            {"uci": uci, "fen": board.fen()},
            code="ILLEGAL_MOVE",
        )
    return move


def _record_move(
    db: Session,
    bot_game: BotGame,
    board: chess.Board,
    move: chess.Move,
    *,
    ply: int,
    is_bot_move: bool,
) -> BotGameMove:
    """Push `move` onto `board` and persist the matching row (SAN before push)."""
    side = Side.white if board.turn == chess.WHITE else Side.black
    san = board.san(move)
    board.push(move)

    row = BotGameMove(
        bot_game_id=bot_game.id,
        ply=ply,
        side=side,
        san=san,
        uci=move.uci(),
        fen_after=board.fen(),
        is_bot_move=is_bot_move,
    )
    db.add(row)
    return row


def _finish_if_over(bot_game: BotGame, board: chess.Board) -> bool:
    """Set status/result if the game ended. Returns True when it did."""
    if board.is_checkmate():
        bot_game.status = BotGameStatus.checkmate
        # The side to move is the one that got mated.
        bot_game.result = BLACK_WIN if board.turn == chess.WHITE else WHITE_WIN
        return True

    if board.is_stalemate():
        bot_game.status = BotGameStatus.stalemate
        bot_game.result = DRAW_RESULT
        return True

    # Only the genuinely *automatic* FIDE draws end the game here. Threefold
    # repetition and the fifty-move rule are deliberately absent: real chess
    # makes those *claimable* by a player who chooses to invoke them, not
    # automatic. `board.can_claim_draw()` bundles both in, which is what made
    # the game end the instant any position happened to occur three times -
    # far more aggressive than the rules, and a draw nobody asked for.
    if (
        board.is_insufficient_material()
        or board.is_seventyfive_moves()
        or board.is_fivefold_repetition()
    ):
        bot_game.status = BotGameStatus.draw
        bot_game.result = DRAW_RESULT
        return True

    return False
