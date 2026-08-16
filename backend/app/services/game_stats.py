"""Aggregate game stats for the dashboard's stats widget.

Split out from `routers/games.py` so the actual streak/accuracy maths - the
part worth unit-testing - has no FastAPI/SQLAlchemy `Session` in the way;
`GameStatsRow` decouples it from the ORM model entirely.

Deliberately computed from every game, not a paginated page of them: "how
many games have I analysed" and "what's my current streak" both need to see
the whole history, not just whatever page happens to be on screen.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

from app.schemas.game import GameStatsOut

# How many of the most recent analysed games "recent form" averages over -
# recent play, not an all-time blend a game from a year ago still drags on.
RECENT_ACCURACY_WINDOW = 20


@dataclass(frozen=True)
class GameStatsRow:
    """One game's worth of raw data `compute_stats` needs."""

    played_at: datetime | None
    created_at: datetime
    white_name: str
    black_name: str
    imported_username: str | None
    white_accuracy: float | None
    black_accuracy: float | None


def my_accuracy(row: GameStatsRow) -> float | None:
    """The `imported_username` side's accuracy for one game, or `None` when
    the game has no completed analysis or the side can't be determined.

    Mirrors `lib/gameDisplay.ts`'s `describeMatchup` matching rule exactly:
    case/whitespace-insensitive, and only when *exactly one* side matches (a
    player facing themselves, or a name matching neither, gives no usable
    perspective either).
    """
    who = (row.imported_username or "").strip().lower()
    if not who:
        return None
    is_white = row.white_name.strip().lower() == who
    is_black = row.black_name.strip().lower() == who
    if is_white == is_black:
        return None
    return row.white_accuracy if is_white else row.black_accuracy


def compute_stats(rows: list[GameStatsRow], *, today: date | None = None) -> GameStatsOut:
    total_games = len(rows)

    analyzed = 0
    dated: list[tuple[datetime, float]] = []
    all_dates: set[date] = set()

    for row in rows:
        # A completed job always writes both sides' accuracy together (see
        # `analyze_game.py`), so either being set means this game has one.
        if row.white_accuracy is not None or row.black_accuracy is not None:
            analyzed += 1

        mine = my_accuracy(row)
        when = row.played_at or row.created_at
        if mine is not None:
            dated.append((when, mine))
        all_dates.add(when.date())

    dated.sort(key=lambda item: item[0], reverse=True)
    recent = [accuracy for _when, accuracy in dated[:RECENT_ACCURACY_WINDOW]]
    recent_accuracy = sum(recent) / len(recent) if recent else None

    streak = _current_streak(all_dates, today or datetime.now(UTC).date())

    return GameStatsOut(
        total_games=total_games,
        analyzed_games=analyzed,
        recent_accuracy=recent_accuracy,
        current_streak_days=streak,
    )


def _current_streak(dates: set[date], today: date) -> int:
    """Consecutive days with at least one game, walking back from `today`.

    No game recorded *today yet* doesn't break a streak still alive as of
    yesterday - the day isn't over. Anything older than that resets it to 0.
    """
    cursor = today
    if cursor not in dates:
        cursor -= timedelta(days=1)
        if cursor not in dates:
            return 0

    streak = 0
    while cursor in dates:
        streak += 1
        cursor -= timedelta(days=1)
    return streak
