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
# desperate swindle, and must give up at least this much material.
BRILLIANT_MIN_WIN_PCT = 20.0
# Above this, the mover is already crushing — giving back material there is
# mopping up, not a notable find, even if it's still technically sound.
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
) -> MoveClassification:
    """Classify a single half-move. First matching rule wins.

    All win-percentage inputs are from the *mover's* point of view:
      - `win_pct_drop`  : winning chances given up by this move (>= 0)
      - `win_pct_before`: the mover's winning chances before playing

    `cp_loss` is accepted for completeness (and future tie-breaking) but the
    bands are driven by win% drop, which is far better behaved in won/lost
    positions than raw centipawns.
    """
    # 1. Forced: no real choice existed.
    if legal_move_count <= 1:
        return MoveClassification.forced
    if second_best_gap_cp is not None and second_best_gap_cp > FORCED_GAP_CP:
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
        and BRILLIANT_MIN_WIN_PCT <= win_pct_before <= BRILLIANT_MAX_WIN_PCT
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

    Simplification: we look one ply past the move (the engine's best reply from
    the resulting position) rather than resolving the whole capture sequence.
    That is enough to separate a real sacrifice from an ordinary trade or a
    capture that gets recaptured immediately.
    """
    mover = board_before.turn
    balance_before = material_balance(board_before, mover)

    board = board_before.copy(stack=False)
    if move not in board.legal_moves:
        return False
    board.push(move)

    if reply is not None and reply in board.legal_moves:
        board.push(reply)

    balance_after = material_balance(board, mover)
    return balance_before - balance_after >= SACRIFICE_MIN_PAWNS
