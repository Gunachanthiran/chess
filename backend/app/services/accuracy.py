"""Win-probability and accuracy maths.

Everything here is pure and unit-testable: no engine, no DB.

Convention: `cp` / `mate` values passed in are always from White's point of
view, matching how they are stored on `move_analysis`. `win_percent` therefore
returns White's winning chances; a side's own chances are `100 - white_pct`.
"""

import math
import statistics
from collections.abc import Iterable, Sequence
from typing import Protocol

# Lichess' win-probability curve constant.
WIN_PCT_K = 0.00368208

# Per-move accuracy curve, reverse-engineered from chess.com and also used by
# Lichess: accuracy = A * exp(-K * win%_loss) + B.
ACCURACY_A = 103.1668100711649
ACCURACY_K = 0.04354415386753951
ACCURACY_B = -3.166924740191411

# Volatility window bounds (in that side's own moves).
MIN_VOLATILITY_WINDOW = 2
MAX_VOLATILITY_WINDOW = 8

# The harmonic mean is undefined for a zero term; a totally lost move is floored
# here so one catastrophe cannot collapse the whole game to exactly zero.
HARMONIC_FLOOR = 1.0

# Evaluations beyond this are clamped before exponentiating, purely to avoid
# overflow warnings on absurd inputs.
MAX_CP = 10_000


def win_percent(cp: int | None = None, mate: int | None = None) -> float:
    """White's winning chances (0-100) for an evaluation.

    A mate score dominates: mate for White is 100%, mate against White is 0%.
    """
    if mate is not None:
        if mate > 0:
            return 100.0
        if mate < 0:
            return 0.0
        # Mate(0) means the side to move is already mated. We never store an
        # unsigned 0 (see engine_pool, which emits +/-1 for terminal mates), so
        # this is only a defensive fallback.
        return 0.0

    if cp is None:
        return 50.0

    clamped = max(-MAX_CP, min(MAX_CP, cp))
    return 50 + 50 * (2 / (1 + math.exp(-WIN_PCT_K * clamped)) - 1)


def win_pct_drop(
    side: str,
    win_pct_before: float,
    win_pct_after: float,
) -> float:
    """How much winning chance the mover lost, in percentage points (>= 0).

    `win_pct_before` / `win_pct_after` are White-POV; for Black the drop is the
    mirror image.
    """
    if _side_value(side) == "white":
        drop = win_pct_before - win_pct_after
    else:
        drop = win_pct_after - win_pct_before
    return max(0.0, drop)


class MoveAnalysisLike(Protocol):
    """Structural type matching both the ORM model and plain test doubles."""

    side: object
    win_pct_before: float
    win_pct_after: float


def mover_pov_pairs(moves: Iterable[MoveAnalysisLike]) -> list[tuple[float, float]]:
    """Turn move rows into `(win_pct_before, win_pct_after)` in the mover's POV.

    Stored win percentages are White-POV, so Black's are mirrored. Input order is
    preserved: `compute_side_accuracy` needs the side's moves in play order.
    """
    pairs: list[tuple[float, float]] = []
    for move in moves:
        before = float(move.win_pct_before)
        after = float(move.win_pct_after)
        if _side_value(move.side) != "white":
            before, after = 100.0 - before, 100.0 - after
        pairs.append((before, after))
    return pairs


def move_accuracy(win_pct_before_mover: float, win_pct_after_mover: float) -> float:
    """Accuracy (0-100) for a single move, from the mover's own POV.

    Win% given away decays accuracy exponentially: giving up a couple of points
    barely dents it, giving up twenty points roughly halves it.
    """
    win_pct_loss = max(0.0, win_pct_before_mover - win_pct_after_mover)
    accuracy = ACCURACY_A * math.exp(-ACCURACY_K * win_pct_loss) + ACCURACY_B
    return max(0.0, min(100.0, accuracy))


def compute_side_accuracy(moves: Sequence[tuple[float, float]]) -> float:
    """Accuracy for one side, given its moves in order as mover-POV win% pairs.

    Blends two means of the per-move accuracies:
      - a *weighted* mean, where each move's weight is the local volatility
        (rolling standard deviation) of the position - errors in sharp positions
        cost more than errors in dead-flat ones;
      - the *harmonic* mean, which is dragged down hard by low outliers, so a
        single blunder tanks the score even in an otherwise clean game.

    Approximation note: this follows the publicly documented chess.com/Lichess
    approach; the exact rolling-window alignment is not published, so the window
    is centred on the move and clipped at the sequence boundaries.
    """
    if not moves:
        return 100.0

    accuracies = [move_accuracy(before, after) for before, after in moves]
    weights = _volatility_weights([before for before, _ in moves])

    total_weight = sum(weights)
    if total_weight > 1e-9:
        weighted_mean = (
            sum(weight * value for weight, value in zip(weights, accuracies))
            / total_weight
        )
    else:
        # Dead-flat game: every weight is ~0, so fall back to a plain mean.
        weighted_mean = sum(accuracies) / len(accuracies)

    harmonic_mean = len(accuracies) / sum(
        1.0 / max(value, HARMONIC_FLOOR) for value in accuracies
    )

    return max(0.0, min(100.0, (weighted_mean + harmonic_mean) / 2))


def _volatility_weights(win_pcts: Sequence[float]) -> list[float]:
    """Rolling standard deviation of win% over a window centred on each move."""
    count = len(win_pcts)
    window = max(
        MIN_VOLATILITY_WINDOW, min(MAX_VOLATILITY_WINDOW, round(count / 10))
    )

    weights: list[float] = []
    for index in range(count):
        start = max(0, index - window // 2)
        end = min(count, start + window)
        start = max(0, end - window)
        chunk = win_pcts[start:end]
        weights.append(statistics.pstdev(chunk) if len(chunk) > 1 else 0.0)
    return weights


def _side_value(side: object) -> str:
    """Accept the `Side` enum, a plain string, or anything with `.value`."""
    return str(getattr(side, "value", side)).lower()
