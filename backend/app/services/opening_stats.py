"""Aggregate performance by opening, across every analysed game.

Same split as `game_stats.py`: a plain dataclass carrying exactly what the
maths needs (`OpeningStatsRow`), and a pure function computing the real
result — no ORM/session in the way, so the actual "which side is mine, did
I win" logic is unit-testable without a database.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

Result = Literal["win", "loss", "draw"]


@dataclass(frozen=True)
class OpeningStatsRow:
    """One game's worth of raw data `compute_opening_performance` needs."""

    opening_name: str | None
    eco: str | None
    result: str
    white_name: str
    black_name: str
    imported_username: str | None
    white_accuracy: float | None
    black_accuracy: float | None


@dataclass(frozen=True)
class OpeningPerformance:
    opening_name: str
    # The eco code shown alongside the name - whichever one most of this
    # opening's games actually used, since a single opening name can span
    # several eco codes (e.g. every Sicilian sub-line) and the row can only
    # show one.
    eco: str | None
    games: int
    wins: int
    losses: int
    draws: int
    # Standard chess "score" convention: a win counts 1, a draw 0.5 - not a
    # plain win/games ratio, which would silently make a string of draws
    # look identical to a string of losses.
    score_pct: float
    # `None` when none of this opening's games have completed analysis yet.
    avg_accuracy: float | None


@dataclass
class _Bucket:
    """Mutable running total for one opening name, while scanning rows."""

    wins: int = 0
    losses: int = 0
    draws: int = 0
    eco_counts: dict[str, int] = field(default_factory=dict)
    accuracies: list[float] = field(default_factory=list)

    def add(self, result: Result, eco: str | None, accuracy: float | None) -> None:
        if result == "win":
            self.wins += 1
        elif result == "loss":
            self.losses += 1
        else:
            self.draws += 1
        if eco:
            self.eco_counts[eco] = self.eco_counts.get(eco, 0) + 1
        if accuracy is not None:
            self.accuracies.append(accuracy)

    def finish(self, opening_name: str) -> OpeningPerformance:
        games = self.wins + self.losses + self.draws
        score_pct = 100.0 * (self.wins + 0.5 * self.draws) / games if games else 0.0
        avg_accuracy = sum(self.accuracies) / len(self.accuracies) if self.accuracies else None
        top_eco = (
            max(self.eco_counts, key=lambda code: self.eco_counts[code])
            if self.eco_counts
            else None
        )
        return OpeningPerformance(
            opening_name=opening_name,
            eco=top_eco,
            games=games,
            wins=self.wins,
            losses=self.losses,
            draws=self.draws,
            score_pct=score_pct,
            avg_accuracy=avg_accuracy,
        )


def my_result(row: OpeningStatsRow) -> Result | None:
    """The `imported_username` side's result for one game, or `None` when
    the side can't be determined (mirrors `game_stats.my_accuracy` and
    `lib/gameDisplay.ts::describeMatchup` exactly - same matching rule, same
    ambiguous-name exclusion) or the result itself isn't decisive or drawn
    (an in-progress or abandoned game has no informative result)."""
    who = (row.imported_username or "").strip().lower()
    if not who:
        return None
    is_white = row.white_name.strip().lower() == who
    is_black = row.black_name.strip().lower() == who
    if is_white == is_black:
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


def compute_opening_performance(rows: list[OpeningStatsRow]) -> list[OpeningPerformance]:
    """One row per distinct `opening_name`, sorted by games played (most
    first) - the most-repeated openings are the ones a fix actually pays off
    in, so they lead regardless of how good or bad the score is.

    Games with no `opening_name`, or where "which side is mine" can't be
    determined, contribute nothing: an "Unknown opening" bucket mixing
    unrelated games would not be actionable, and there is nowhere meaningful
    to attribute it.
    """
    buckets: dict[str, _Bucket] = {}

    for row in rows:
        if not row.opening_name:
            continue
        result = my_result(row)
        if result is None:
            continue

        who = (row.imported_username or "").strip().lower()
        is_white = row.white_name.strip().lower() == who
        accuracy = row.white_accuracy if is_white else row.black_accuracy

        bucket = buckets.setdefault(row.opening_name, _Bucket())
        bucket.add(result, row.eco, accuracy)

    performances = [bucket.finish(name) for name, bucket in buckets.items()]
    performances.sort(key=lambda item: item.games, reverse=True)
    return performances
