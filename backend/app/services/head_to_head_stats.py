"""Your real record against one specific opponent, across every game you've
played against them (any source — Lichess, Chess.com, uploaded, bot games).

Same split as `opening_stats.py`, which this deliberately mirrors move for
move (same "my side" matching, same score% convention) — the two reports
answer different groupings of the same underlying question ("how did I do
against X") and there was no reason for the arithmetic to differ.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class HeadToHeadStatsRow:
    """One game's worth of raw data `compute_head_to_head` needs."""

    white_name: str
    black_name: str
    imported_username: str | None
    result: str
    white_accuracy: float | None
    black_accuracy: float | None


@dataclass(frozen=True)
class HeadToHeadSummary:
    opponent_name: str
    games: int
    wins: int
    losses: int
    draws: int
    score_pct: float
    avg_accuracy: float | None


def _my_result_against(row: HeadToHeadStatsRow, opponent: str) -> str | None:
    """`"win"`/`"loss"`/`"draw"`, or `None` when this row isn't a game
    against `opponent` at all, or "which side is mine" can't be resolved
    (mirrors `opening_stats.my_result`'s matching rule exactly).
    """
    who = (row.imported_username or "").strip().lower()
    if not who:
        return None
    is_white = row.white_name.strip().lower() == who
    is_black = row.black_name.strip().lower() == who
    if is_white == is_black:
        return None

    opponent_name = row.black_name if is_white else row.white_name
    if opponent_name.strip().lower() != opponent.strip().lower():
        return None

    you_won = row.result == "1-0" if is_white else row.result == "0-1"
    you_lost = row.result == "0-1" if is_white else row.result == "1-0"
    if you_won:
        return "win"
    if you_lost:
        return "loss"
    if row.result == "1/2-1/2":
        return "draw"
    return None


def compute_head_to_head(
    rows: list[HeadToHeadStatsRow], opponent: str
) -> HeadToHeadSummary:
    """`games == 0` (with an empty `opponent_name` echoed back as given)
    means exactly that — no resolvable game against this name — rather than
    raising, so a typo'd or never-played name is just an empty result the
    caller can render plainly, not an error to handle."""
    wins = losses = draws = 0
    accuracies: list[float] = []

    for row in rows:
        result = _my_result_against(row, opponent)
        if result is None:
            continue

        if result == "win":
            wins += 1
        elif result == "loss":
            losses += 1
        else:
            draws += 1

        who = (row.imported_username or "").strip().lower()
        is_white = row.white_name.strip().lower() == who
        accuracy = row.white_accuracy if is_white else row.black_accuracy
        if accuracy is not None:
            accuracies.append(accuracy)

    games = wins + losses + draws
    score_pct = 100.0 * (wins + 0.5 * draws) / games if games else 0.0
    avg_accuracy = sum(accuracies) / len(accuracies) if accuracies else None

    return HeadToHeadSummary(
        opponent_name=opponent,
        games=games,
        wins=wins,
        losses=losses,
        draws=draws,
        score_pct=score_pct,
        avg_accuracy=avg_accuracy,
    )
