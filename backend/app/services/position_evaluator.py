"""Position evaluation: Lichess cloud eval first, local Stockfish as fallback.

`evaluate_position` is a drop-in replacement for `StockfishEngine.analyse()`.
It first asks Lichess for a cached evaluation of the position - free, and for
opening theory usually far deeper than a local search - and only runs local
Stockfish when the cloud has nothing good enough. The return shape is identical
either way, so callers never need to know which path answered.

Deliberately *not* used by the bot move-selection path (`tal_bot`): the bot
needs fast, synchronous, consistently *weakened* local evaluations, and a
full-strength cloud eval there would make it play above its configured strength.
"""

from __future__ import annotations

import chess

from app.services import lichess_cloud_eval
from app.services.engine_pool import StockfishEngine

# A cached eval is only worth using if it is at least as deep as the local
# search it replaces, and never below this floor - a shallow cached entry is
# strictly worse than what local Stockfish would produce.
MIN_CLOUD_DEPTH = 20

# Keys of the `analyse()` contract, used to strip the cloud response's extra
# `depth` field so both paths return exactly the same shape.
ANALYSIS_KEYS = ("cp", "mate", "best_move", "second_best_cp", "second_best_mate")


def evaluate_position(
    engine: StockfishEngine,
    board: chess.Board,
    depth: int | None = None,
    cloud_session: lichess_cloud_eval.CloudEvalSession | None = None,
) -> dict:
    """Evaluate `board`, preferring a deep cached Lichess eval over local search.

    Returns the same dict shape as `StockfishEngine.analyse()`. Cloud lookups
    are best-effort: any miss, timeout or failure falls through to the engine.

    Pass a `CloudEvalSession` when evaluating many positions in a row (one per
    `analyze_game` run): it throttles requests and trips a circuit breaker once
    Lichess starts rejecting us, so a rate-limited service costs one failed
    round-trip for the whole job rather than one per position. Without it each
    call is an independent, unthrottled lookup.
    """
    # Terminal positions have no engine score at all; `analyse()` handles them
    # directly and the cloud has nothing useful to say about them.
    if not board.is_game_over(claim_draw=False):
        lookup = (
            lichess_cloud_eval.fetch_cloud_eval
            if cloud_session is None
            else cloud_session.fetch
        )
        cloud = lookup(board.fen(), multipv=2)
        if _is_usable(cloud, engine, depth):
            return {key: cloud[key] for key in ANALYSIS_KEYS}

    return engine.analyse(board, depth=depth)


def _is_usable(
    cloud: dict | None, engine: StockfishEngine, depth: int | None
) -> bool:
    """True when a cloud result is present, scored, and deep enough to trust."""
    if cloud is None:
        return False

    if cloud.get("best_move") is None:
        return False

    if cloud.get("cp") is None and cloud.get("mate") is None:
        return False

    cloud_depth = cloud.get("depth")
    if not isinstance(cloud_depth, int):
        return False

    return cloud_depth >= _required_depth(engine, depth)


def _required_depth(engine: StockfishEngine, depth: int | None) -> int:
    """Minimum acceptable cloud depth: the local search depth, floored."""
    local_depth = depth or engine.depth
    return max(MIN_CLOUD_DEPTH, local_depth or MIN_CLOUD_DEPTH)
