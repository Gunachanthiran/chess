"""Turns a selected gambit plus the opponent's observed style into a small,
additive nudge on `tal_bot`'s candidate scoring.

This deliberately extends `tal_bot.py`'s existing two-knob design (strength
cap, then personality re-rank over an already-eligible candidate pool — see
that module's docstring) with a third, smaller knob: a gambit is one more
*preference* among moves `tal_bot` has already decided are sound. Nothing
here ever sees or changes eligibility (`score_candidates`' tolerance gate) —
`personality_multiplier` and `candidate_bonus` are only ever applied to the
personality score of a candidate that already passed that gate.

Priority order, matching the product requirement directly:
  1-4. legal move / tactical safety / position eval / best move — tal_bot's
       existing tolerance gate, untouched by anything in this module.
  5. opponent adaptation — `personality_multiplier` scales tal_bot's
     existing sacrifice/king-attack personality terms.
  6. selected gambit preference — `candidate_bonus`'s line-continuation
     bonus, the very last and smallest term in the score.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import chess

from app.services.engine_pool import CandidateMove
from app.services.gambits import Gambit, is_gambit_line
from app.services.opponent_style import NEUTRAL_PROFILE, OpponentProfile, classify

GambitStatus = Literal["no_gambit", "active", "extended", "deviated"]

# Fixed bonus for playing the gambit's own next scripted move. Well inside the
# range that only breaks a near-tie among moves tal_bot's tolerance gate has
# already accepted as sound — see the module docstring's priority order and
# tal_bot.AGGRESSION_TOLERANCE_CP for the gate this can never reach past.
GAMBIT_LINE_BONUS = 40.0

DEVELOPMENT_BONUS_UNIT = 6.0
CENTER_BONUS_UNIT = 5.0

# How far opponent-adaptation can scale a style weight, up or down.
ADAPT_BOOST = 1.35
ADAPT_DAMPEN = 0.75
# Combined aggressive+tactical opponent score at/above which the bot treats
# the opponent as genuinely coming after it (see `_opponent_multiplier`).
AGGRESSION_PRESSURE_THRESHOLD = 0.5

_MINOR_HOME_SQUARES = {
    chess.WHITE: frozenset({chess.B1, chess.C1, chess.F1, chess.G1}),
    chess.BLACK: frozenset({chess.B8, chess.C8, chess.F8, chess.G8}),
}
_CENTER_SQUARES = (chess.D4, chess.D5, chess.E4, chess.E5)


@dataclass(frozen=True)
class StrategyContext:
    gambit: Gambit | None
    status: GambitStatus
    next_move_san: str | None
    opponent: OpponentProfile
    bot_color: chess.Color


NO_GAMBIT_CONTEXT = StrategyContext(None, "no_gambit", None, NEUTRAL_PROFILE, chess.WHITE)


def build_context(
    board: chess.Board,
    gambit: Gambit | None,
    moves: list[tuple[str, str, chess.Color]],
    bot_color: chess.Color,
    adapt_to_opponent: bool,
) -> StrategyContext:
    """`moves` is the whole game so far as `(san, uci, side)` triples, in ply
    order, for *both* sides — the shape `bot_game_service` already has after
    replaying the stored move list.
    """
    opponent_color = not bot_color
    opponent = classify(moves, opponent_color) if adapt_to_opponent and moves else NEUTRAL_PROFILE

    if gambit is None:
        return StrategyContext(None, "no_gambit", None, opponent, bot_color)

    moves_san = tuple(san for san, _uci, _side in moves)
    played_so_far = len(moves_san)

    if not is_gambit_line(gambit, moves_san):
        return StrategyContext(gambit, "deviated", None, opponent, bot_color)

    if played_so_far >= len(gambit.starting_moves):
        return StrategyContext(gambit, "extended", None, opponent, bot_color)

    # Still on the line — but the scripted continuation only exists for
    # whoever moves next, and that isn't always the bot.
    next_mover_color = board.turn
    if next_mover_color != bot_color:
        return StrategyContext(gambit, "active", None, opponent, bot_color)

    return StrategyContext(
        gambit, "active", gambit.starting_moves[played_so_far], opponent, bot_color
    )


def _opponent_multiplier(opponent: OpponentProfile) -> tuple[float, float]:
    """(sacrifice_scale, alertness_scale) derived from the opponent's style.

    An opponent playing aggressively/tactically is more likely to overextend,
    so the bot gets more willing to complicate and counterattack (both scales
    rise). Against a passive/defensive/positional opponent there is less to
    punish yet, so the bot keeps its gambit's own attacking character but
    skips the speculative material-for-initiative sacrifices — "controlled"
    rather than reckless.
    """
    pressure = opponent.scores.get("aggressive", 0.0) + opponent.scores.get("tactical", 0.0)
    if pressure >= AGGRESSION_PRESSURE_THRESHOLD:
        return ADAPT_BOOST, ADAPT_BOOST
    if opponent.is_passive:
        return ADAPT_DAMPEN, 1.0
    return 1.0, 1.0


def personality_multiplier(context: StrategyContext | None) -> float:
    """Scales `tal_bot`'s existing sacrifice/king-exposure/king-pressure
    personality terms as a group — priority 5 (opponent adaptation) applied
    on top of the gambit's own base sacrifice/king_attack weights."""
    if context is None or context.gambit is None:
        return 1.0
    sac_scale, alert_scale = _opponent_multiplier(context.opponent)
    weights = context.gambit.weights
    return ((weights.sacrifice * sac_scale) + (weights.king_attack * alert_scale)) / 2


def candidate_bonus(
    board: chess.Board, candidate: CandidateMove, context: StrategyContext | None
) -> float:
    """Additive score bonus for one candidate — priority 6, the very last and
    smallest term. Zero with no gambit selected, or when it isn't actually
    the bot's turn to move in `board`."""
    if context is None or context.gambit is None:
        return 0.0
    if board.turn != context.bot_color:
        return 0.0

    bonus = 0.0

    if context.status == "active" and context.next_move_san is not None:
        san = board.san(candidate.move)
        if san == context.next_move_san:
            bonus += GAMBIT_LINE_BONUS

    if context.status in ("active", "extended"):
        bonus += _style_bonus(board, candidate.move, context)

    return bonus


def _style_bonus(board: chess.Board, move: chess.Move, context: StrategyContext) -> float:
    weights = context.gambit.weights  # type: ignore[union-attr]  # gambit is not None here
    _, alert_scale = _opponent_multiplier(context.opponent)

    dev = _development_delta(board, move) * weights.development * alert_scale * DEVELOPMENT_BONUS_UNIT
    center = _center_control_delta(board, move) * weights.center_control * alert_scale * CENTER_BONUS_UNIT
    return dev + center


def _development_delta(board: chess.Board, move: chess.Move) -> int:
    """1 when this move brings a minor piece off its home square, else 0."""
    piece = board.piece_at(move.from_square)
    if piece is None or piece.piece_type not in (chess.KNIGHT, chess.BISHOP):
        return 0
    return 1 if move.from_square in _MINOR_HOME_SQUARES[piece.color] else 0


def _center_control_delta(board: chess.Board, move: chess.Move) -> int:
    """Net change in how many central squares (d4/d5/e4/e5) the mover attacks."""
    mover = board.turn
    before = sum(1 for square in _CENTER_SQUARES if board.is_attacked_by(mover, square))

    after_board = board.copy(stack=False)
    if move not in after_board.legal_moves:
        return 0
    after_board.push(move)

    after = sum(1 for square in _CENTER_SQUARES if after_board.is_attacked_by(mover, square))
    return after - before
