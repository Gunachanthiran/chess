"""Do your real errors cluster when your clock is running low?

Chess.com (and Lichess) PGN exports embed each move's remaining clock time
as a `{ [%clk h:mm:ss] }` comment — already sitting in every imported game's
stored `pgn` text, unused until now. Same split as the other `*_stats.py`
modules: parsing/bucketing is pure and unit-tested without a database: the
router hands this module raw PGN text plus each move's already-computed
classification, and gets a phase_stats-shaped breakdown back.
"""

from __future__ import annotations

import io
import re
from dataclasses import dataclass, field
from typing import Literal

import chess.pgn

from app.models.move_analysis import MoveClassification, Side

TimeBucket = Literal["plenty", "low", "critical"]
# Most time remaining to least - the order results are always returned in.
TIME_BUCKETS: tuple[TimeBucket, ...] = ("plenty", "low", "critical")

# Seconds remaining *after* a move, at or below which that move counts as
# played in real time trouble - low enough that "increment or safety
# buffer" doesn't realistically cover a bad decision anymore.
CRITICAL_THRESHOLD_S = 30.0
# Above this, a player still has a genuinely comfortable amount of clock
# left; the band between the two thresholds is "aware of the clock but not
# yet desperate".
PLENTY_THRESHOLD_S = 120.0

_CLOCK_RE = re.compile(r"\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)\]")


def parse_clock_seconds(comment: str) -> float | None:
    """Seconds remaining from a raw PGN move comment, or `None` when it
    carries no `%clk` annotation at all (an uploaded game with no clock
    data, or a bot game, which never has one)."""
    match = _CLOCK_RE.search(comment)
    if not match:
        return None
    hours, minutes, seconds = match.groups()
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def clock_seconds_by_ply(pgn_text: str) -> dict[int, float]:
    """`{ply: seconds remaining}` for every move that actually carries a
    `%clk` comment, keyed the same way `move_analysis.ply` is (1-indexed,
    White's first move is 1) - so a caller can zip the two by ply directly,
    with no assumption that *every* move in the game has clock data (an
    increment-only late-game move, or a game exported without clocks at
    all, just contributes no entries).
    """
    game = chess.pgn.read_game(io.StringIO(pgn_text))
    if game is None:
        return {}

    result: dict[int, float] = {}
    for ply, node in enumerate(game.mainline(), start=1):
        seconds = parse_clock_seconds(node.comment)
        if seconds is not None:
            result[ply] = seconds
    return result


def classify_time_bucket(seconds: float) -> TimeBucket:
    if seconds <= CRITICAL_THRESHOLD_S:
        return "critical"
    if seconds <= PLENTY_THRESHOLD_S:
        return "low"
    return "plenty"


@dataclass(frozen=True)
class MoveInput:
    """One of your own moves in a game, already classified."""

    ply: int
    side: Side
    classification: MoveClassification


@dataclass(frozen=True)
class TimePressureGameInput:
    """One analysed game's worth of raw data - the PGN text (for clock
    parsing) plus every one of your own moves' classifications (for the
    error breakdown). `moves` should be pre-filtered to "my side" by the
    caller alongside the imported_username match, mirroring every other
    report here - kept as an explicit filter step in the router rather than
    threaded through this module, since "which side is mine" doesn't need
    the PGN at all and is identical to `opening_stats`'s own version of it.
    """

    pgn: str
    moves: list[MoveInput]


@dataclass(frozen=True)
class TimeBucketBreakdown:
    bucket: TimeBucket
    total_moves: int
    inaccuracies: int
    mistakes: int
    blunders: int

    @property
    def error_rate_pct(self) -> float:
        if self.total_moves == 0:
            return 0.0
        errors = self.inaccuracies + self.mistakes + self.blunders
        return 100.0 * errors / self.total_moves


_ERROR_CLASSIFICATIONS = (
    MoveClassification.inaccuracy,
    MoveClassification.mistake,
    MoveClassification.blunder,
)


@dataclass
class _Bucket:
    total: int = 0
    counts: dict[MoveClassification, int] = field(
        default_factory=lambda: {c: 0 for c in _ERROR_CLASSIFICATIONS}
    )

    def add(self, classification: MoveClassification) -> None:
        self.total += 1
        if classification in _ERROR_CLASSIFICATIONS:
            self.counts[classification] += 1

    def finish(self, bucket: TimeBucket) -> TimeBucketBreakdown:
        return TimeBucketBreakdown(
            bucket=bucket,
            total_moves=self.total,
            inaccuracies=self.counts[MoveClassification.inaccuracy],
            mistakes=self.counts[MoveClassification.mistake],
            blunders=self.counts[MoveClassification.blunder],
        )


def compute_time_pressure(games: list[TimePressureGameInput]) -> list[TimeBucketBreakdown]:
    """One row per time bucket, in most-time-to-least order, always all
    three - the same "never omit a bucket just because it's empty" contract
    `phase_stats.compute_phase_breakdown` uses, for the same reason (a
    caller should never have to guess whether "critical" is missing because
    you've never blundered under time pressure or because something broke).

    Games with no clock data at all (bot games; some uploads) simply
    contribute no moves to any bucket - not an error, just nothing to
    bucket.
    """
    buckets: dict[TimeBucket, _Bucket] = {bucket: _Bucket() for bucket in TIME_BUCKETS}

    for game in games:
        clocks = clock_seconds_by_ply(game.pgn)
        for move in game.moves:
            seconds = clocks.get(move.ply)
            if seconds is None:
                continue
            bucket = classify_time_bucket(seconds)
            buckets[bucket].add(move.classification)

    return [buckets[bucket].finish(bucket) for bucket in TIME_BUCKETS]
