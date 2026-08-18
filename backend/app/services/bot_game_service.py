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
from app.services import gambit_strategy
from app.services import gambits as gambits_service
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


def _bot_color(bot_game: BotGame) -> chess.Color:
    return chess.BLACK if bot_game.player_color is BotColor.white else chess.WHITE


def _move_triples(moves: list[BotGameMove]) -> list[tuple[str, str, chess.Color]]:
    """`(san, uci, side)` triples in ply order — the shape `gambit_strategy`
    and `opponent_style` both take."""
    return [
        (move.san, move.uci, chess.WHITE if move.side is Side.white else chess.BLACK)
        for move in sorted(moves, key=lambda row: row.ply)
    ]


def _strategy_context(
    bot_game: BotGame, board: chess.Board, moves: list[BotGameMove]
) -> gambit_strategy.StrategyContext:
    gambit = gambits_service.get_gambit(bot_game.gambit_id) if bot_game.gambit_id else None
    return gambit_strategy.build_context(
        board,
        gambit,
        _move_triples(moves),
        _bot_color(bot_game),
        bot_game.adapt_to_opponent,
    )


def strategy_status(bot_game: BotGame) -> tuple[str | None, str, list[str], str | None]:
    """(gambit_name, gambit_status, opponent_style_tags, bot_strategy_summary).

    Computed fresh from the stored move list on every response, exactly like
    `current_opening` above — nothing here is stored on the row.
    """
    moves = sorted(bot_game.moves, key=lambda row: row.ply)
    board = reconstruct_board(bot_game, moves)
    context = _strategy_context(bot_game, board, moves)
    tags = list(context.opponent.tags)

    if context.gambit is None:
        return None, "no_gambit", tags, None

    return context.gambit.name, context.status, tags, _strategy_summary(context)


def _strategy_summary(context: gambit_strategy.StrategyContext) -> str:
    gambit = context.gambit
    assert gambit is not None
    opponent_desc = ", ".join(context.opponent.tags)
    if context.status == "active":
        return f"Following {gambit.name} — opponent reads {opponent_desc}."
    if context.status == "extended":
        style_desc = ", ".join(gambit.style)
        return f"{gambit.name} line complete — keeping its {style_desc} character against a {opponent_desc} opponent."
    if context.status == "deviated":
        return f"Off the {gambit.name} line — adapting to a {opponent_desc} opponent."
    return "Free play."


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
    gambit_id: str | None = None,
    adapt_to_opponent: bool = True,
) -> BotGame:
    """Create a game; if the bot has White, it plays the opening move at once."""
    bot_game = BotGame(
        player_color=player_color,
        bot_elo=bot_elo,
        bot_aggression=bot_aggression,
        gambit_id=gambit_id,
        adapt_to_opponent=adapt_to_opponent,
        status=BotGameStatus.in_progress,
    )
    db.add(bot_game)
    db.commit()
    db.refresh(bot_game)

    if player_color is BotColor.black:
        board = chess.Board()
        context = _strategy_context(bot_game, board, [])
        bot_move = tal_bot.choose_bot_move(board, bot_elo, bot_aggression, context)
        _record_move(db, bot_game, board, bot_move, ply=1, is_bot_move=True)
        db.commit()

    return _refreshed(db, bot_game)


def undo_last_move(db: Session, bot_game: BotGame) -> BotGame:
    """Roll back to the player's own turn: drop the bot's reply and the
    player move that provoked it, in one step.

    Undoing just the bot's move and leaving the player's move standing would
    put the board in a state the player never actually chose to sit in, so
    the two always come off together. This also un-ends a game the bot's
    reply had just finished (checkmate/stalemate/draw) — the point of undo
    here is "let me try something else", not "review a shorter game".
    """
    moves = load_moves(db, bot_game)
    moves_sorted = sorted(moves, key=lambda row: row.ply)

    if not moves_sorted or all(move.is_bot_move for move in moves_sorted):
        # Nothing the player has done yet — e.g. the bot just played its
        # opening move as White and it's the player's very first turn.
        raise ConflictError(
            "Nothing to undo yet.",
            {"bot_game_id": str(bot_game.id)},
            code="NOTHING_TO_UNDO",
        )

    to_remove = [moves_sorted[-1]]
    if moves_sorted[-1].is_bot_move and len(moves_sorted) >= 2:
        to_remove.append(moves_sorted[-2])

    for move in to_remove:
        db.delete(move)

    bot_game.status = BotGameStatus.in_progress
    bot_game.result = None
    db.commit()
    return _refreshed(db, bot_game)


def claim_draw(db: Session, bot_game: BotGame) -> BotGame:
    """Ends the game as a draw, but only when the position actually allows it.

    Threefold repetition and the fifty-move rule are deliberately *not*
    automatic (see `_finish_if_over` below) — real chess makes both
    claimable by a player who chooses to invoke them, not a forced result the
    instant they arise. This is that claim, checked against the real
    replayed board rather than trusted from the client, same as every other
    write in this module.
    """
    if bot_game.status is not BotGameStatus.in_progress:
        raise ConflictError(
            "This game is already over.",
            {"bot_game_id": str(bot_game.id), "status": bot_game.status.value},
            code="GAME_OVER",
        )

    moves = load_moves(db, bot_game)
    board = reconstruct_board(bot_game, moves)
    if not board.can_claim_draw():
        raise ConflictError(
            "A draw cannot be claimed in this position yet — it needs a threefold "
            "repetition or fifty moves without a capture or pawn move.",
            {"bot_game_id": str(bot_game.id), "fen": board.fen()},
            code="DRAW_NOT_CLAIMABLE",
        )

    bot_game.status = BotGameStatus.draw
    bot_game.result = DRAW_RESULT
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
    played_move = _record_move(db, bot_game, board, move, ply=next_ply, is_bot_move=False)
    next_ply += 1

    if not _finish_if_over(bot_game, board):
        context = _strategy_context(bot_game, board, [*moves, played_move])
        bot_move = tal_bot.choose_bot_move(
            board, bot_game.bot_elo, bot_game.bot_aggression, context
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
