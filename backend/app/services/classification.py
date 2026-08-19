"""Move classification: turn engine numbers into brilliant/best/.../blunder.

Pure functions only, so the tiers are directly unit-testable.
"""

from __future__ import annotations

import chess

from app.models.move_analysis import MoveClassification

# --- Tunables --------------------------------------------------------------

# A position is "forced" if the alternatives are this much worse (mover POV).
FORCED_GAP_CP = 500

# Book moves are only recognised in the opening phase.
BOOK_MAX_PLY = 12

# Win%-drop band upper bounds (mover POV, percentage points).
BEST_MAX_DROP = 1.0
EXCELLENT_MAX_DROP = 2.0
GOOD_MAX_DROP = 5.0
INACCURACY_MAX_DROP = 10.0
MISTAKE_MAX_DROP = 20.0

# A brilliant move must be winning enough to be a real sacrifice rather than a
# desperate swindle, and must give up at least this much material. Both bounds
# are skipped entirely when the move forces mate (see `classify_move`'s
# `forces_mate` parameter) — a sacrifice that finds forced checkmate is a real
# find regardless of how the position looked a moment before, whether that's
# "already crushing anyway" (the upper bound) or "still nominally losing" (the
# lower bound, where finding mate *is* the swindle, not evidence against one).
BRILLIANT_MIN_WIN_PCT = 20.0
# Above this, the mover is already crushing — giving back material there is
# mopping up, not a notable find, even if it's still technically sound. Unless
# it forces mate; see above.
BRILLIANT_MAX_WIN_PCT = 95.0
# Was 1: flagged plain trades (win a pawn, hand it straight back for
# compensation) as "brilliant" since the one-ply lookahead in
# `is_material_sacrifice` only has to see *a* pawn go missing. A real
# sacrifice-the-kind-that-earns-an-exclamation-mark gives up at least a minor
# piece's worth.
SACRIFICE_MIN_PAWNS = 3

# A "best" move is upgraded to "great" when every alternative falls off by at
# least this much (mover POV centipawns) — the single clearly-right move in a
# sharp position, not merely *a* good one. Well below FORCED_GAP_CP: forced
# means there was barely a choice at all, great means there was a real choice
# and only one branch survives it.
GREAT_GAP_CP = 150

PIECE_VALUES: dict[chess.PieceType, int] = {
    chess.PAWN: 1,
    chess.KNIGHT: 3,
    chess.BISHOP: 3,
    chess.ROOK: 5,
    chess.QUEEN: 9,
    chess.KING: 0,
}


def classify_move(
    *,
    win_pct_drop: float,
    cp_loss: int | None = None,
    legal_move_count: int,
    second_best_gap_cp: int | None = None,
    is_book: bool = False,
    is_sacrifice: bool = False,
    win_pct_before: float = 50.0,
    ply: int = 1,
    forces_mate: bool = False,
) -> MoveClassification:
    """Classify a single half-move. First matching rule wins.

    All win-percentage inputs are from the *mover's* point of view:
      - `win_pct_drop`  : winning chances given up by this move (>= 0)
      - `win_pct_before`: the mover's winning chances before playing

    `cp_loss` is accepted for completeness (and future tie-breaking) but the
    bands are driven by win% drop, which is far better behaved in won/lost
    positions than raw centipawns.

    `forces_mate` is whether this move puts a forced mate on the board for the
    mover (see the call site in `analyze_game.py` for the mate-sign handling).
    It bypasses both of `BRILLIANT_MIN_WIN_PCT`/`_MAX_WIN_PCT` below — those
    bounds exist to tell a real sacrifice apart from mopping-up-a-won-game on
    one side and a desperate-swindle-that-happened-to-work on the other, and
    neither concern applies to a sacrifice that provably forces checkmate. It
    also exempts the move from the gap-based half of rule 1 below, for the
    same underlying reason: a mating line's eval gap over every alternative
    is close to infinite by construction (nothing outscores checkmate), so
    without this exemption *every* mating sacrifice would be swallowed by
    "forced" before rule 4 ever saw it — exactly backwards, since finding the
    one line that mates three moves faster than the "merely winning"
    alternatives is the opposite of "no real choice existed".
    """
    # 1. Forced: no real choice existed. A single legal move is unconditional;
    # the gap-based half is skipped for a mate-forcing sacrifice (see above).
    if legal_move_count <= 1:
        return MoveClassification.forced
    if (
        second_best_gap_cp is not None
        and second_best_gap_cp > FORCED_GAP_CP
        and not (is_sacrifice and forces_mate)
    ):
        return MoveClassification.forced

    # 2. Book: still following known opening theory.
    if is_book and ply <= BOOK_MAX_PLY:
        return MoveClassification.book

    # 3. Win%-drop bands.
    band = _band(win_pct_drop)

    # 4. Brilliant overrides "best" for sound sacrifices.
    if (
        band is MoveClassification.best
        and is_sacrifice
        and (forces_mate or BRILLIANT_MIN_WIN_PCT <= win_pct_before <= BRILLIANT_MAX_WIN_PCT)
    ):
        return MoveClassification.brilliant

    # 5. Great overrides "best" when it was the only real option — a
    # sacrifice takes priority (rule 4) since giving up material to force the
    # position is the more notable feat.
    if (
        band is MoveClassification.best
        and second_best_gap_cp is not None
        and second_best_gap_cp > GREAT_GAP_CP
    ):
        return MoveClassification.great

    return band


def _band(drop: float) -> MoveClassification:
    if drop <= BEST_MAX_DROP:
        return MoveClassification.best
    if drop <= EXCELLENT_MAX_DROP:
        return MoveClassification.excellent
    if drop <= GOOD_MAX_DROP:
        return MoveClassification.good
    if drop <= INACCURACY_MAX_DROP:
        return MoveClassification.inaccuracy
    if drop <= MISTAKE_MAX_DROP:
        return MoveClassification.mistake
    return MoveClassification.blunder


# --- Material / sacrifice heuristics ---------------------------------------


def material_for(board: chess.Board, color: chess.Color) -> int:
    """Weighted material for one side, in pawn units."""
    return sum(
        value * chess.popcount(board.pieces_mask(piece_type, color))
        for piece_type, value in PIECE_VALUES.items()
        if value
    )


def material_balance(board: chess.Board, color: chess.Color) -> int:
    """Material difference from `color`'s perspective."""
    return material_for(board, color) - material_for(board, not color)


def is_material_sacrifice(
    board_before: chess.Board,
    move: chess.Move,
    reply: chess.Move | None = None,
) -> bool:
    """Did the mover give up material that the opponent's best reply keeps?

    Looks up to two plies past the move: the engine's best reply from the
    resulting position, and - when that reply is itself a capture - the
    mover's own cheapest recapture on that same square. Without the second
    step this mistook an ordinary trade for a sacrifice: if the opponent's
    "best reply" to a quiet developing move is a capture that hangs right
    back (a bishop trade, say), stopping the lookahead one ply too early
    catches the material in mid-air - present in the recapturing side's
    count, absent from the mover's - and reports a "sacrifice" for a trade
    that was actually even. Real sacrifices (the mover has no recapture, or
    only an inferior one) still show a genuine deficit after this.
    """
    mover = board_before.turn
    balance_before = material_balance(board_before, mover)

    board = board_before.copy(stack=False)
    if move not in board.legal_moves:
        return False
    board.push(move)

    if reply is not None and reply in board.legal_moves:
        recapture_square = reply.to_square if board.is_capture(reply) else None
        board.push(reply)
        if recapture_square is not None:
            recapture = _cheapest_capture_on(board, recapture_square)
            if recapture is not None:
                board.push(recapture)

    balance_after = material_balance(board, mover)
    return balance_before - balance_after >= SACRIFICE_MIN_PAWNS


def _cheapest_capture_on(board: chess.Board, square: chess.Square) -> chess.Move | None:
    """The least valuable piece that can recapture on `square`, or `None`.

    Mirrors `tal_bot._cheapest_capture_on` (that module's own recapture step,
    used in its own material-offer heuristic) - not shared code, since the two
    live in otherwise-unrelated modules, but deliberately the same rule: a
    real player recaptures with their cheapest attacker, not their first one.
    """
    recaptures = [
        move
        for move in board.legal_moves
        if move.to_square == square and board.is_capture(move)
    ]
    if not recaptures:
        return None
    return min(
        recaptures,
        key=lambda move: PIECE_VALUES.get(
            board.piece_at(move.from_square).piece_type, 0
        )
        if board.piece_at(move.from_square)
        else 0,
    )
