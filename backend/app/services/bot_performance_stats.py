"""How the Tal bot itself is actually playing, across every analysed bot
game — reuses the exact same win/loss, classification, and phase-breakdown
shapes already built for *your* games (see opening_stats.py, phase_stats.py,
game_stats.py), just pointed at the bot's own moves instead.

This is deliberately a report, not a control: it changes nothing about how
the bot plays. A real, inspectable, data-driven foundation to tune the bot
from — the same approach that actually fixed it earlier this session
(measuring real games through the real analysis pipeline), rather than a
black-box "auto-tuning" system nobody could verify was moving the bot's own
volatile aggression settings in the right direction.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime

from app.models.move_analysis import MoveClassification, Side
from app.services.phase_stats import PHASES, Phase, classify_phase

# Every bot-authored PGN header names the bot this way (see
# bot_game_service._bot_display_name) - "Tal Bot (Grandmaster, aggression 5)"
# or "Tal Bot (1500, aggression 3)" - so a name-prefix match identifies a bot
# game regardless of the specific elo/aggression it was played at.
BOT_NAME_PREFIX = "Tal Bot"

_ALL_CLASSIFICATIONS: tuple[MoveClassification, ...] = tuple(MoveClassification)
_ERROR_CLASSIFICATIONS = (
    MoveClassification.inaccuracy,
    MoveClassification.mistake,
    MoveClassification.blunder,
)


def is_bot_game(white_name: str, black_name: str) -> bool:
    return white_name.startswith(BOT_NAME_PREFIX) or black_name.startswith(BOT_NAME_PREFIX)


def bot_side(white_name: str, black_name: str) -> Side | None:
    """Which side the bot played, or `None` when it can't be resolved
    (neither name matches, or - a real game should never produce this -
    both do)."""
    white_is_bot = white_name.startswith(BOT_NAME_PREFIX)
    black_is_bot = black_name.startswith(BOT_NAME_PREFIX)
    if white_is_bot == black_is_bot:
        return None
    return Side.white if white_is_bot else Side.black


@dataclass(frozen=True)
class BotAnalysisRow:
    """One move of one analysed bot game - per-move fields for the
    classification/phase breakdowns, per-game fields (repeated on every row
    of that game, the same denormalised shape phase_stats.py/
    time_pressure_stats.py already use) for the record and accuracy trend."""

    game_id: uuid.UUID
    ply: int
    side: Side
    classification: MoveClassification
    fen_before: str
    white_name: str
    black_name: str
    result: str
    played_at: datetime | None
    white_accuracy: float | None
    black_accuracy: float | None


@dataclass(frozen=True)
class BotRecord:
    games: int
    wins: int
    losses: int
    draws: int
    score_pct: float
    avg_accuracy: float | None


@dataclass(frozen=True)
class BotPhaseBreakdown:
    phase: Phase
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


@dataclass(frozen=True)
class BotAccuracyPoint:
    played_at: datetime
    accuracy: float


def _bot_rows_by_game(rows: list[BotAnalysisRow]) -> dict[uuid.UUID, BotAnalysisRow]:
    """One representative row per game (any of them - the per-game fields
    are identical across a game's own rows), for the record/trend
    computations below, which only care about per-game data."""
    return {row.game_id: row for row in rows if bot_side(row.white_name, row.black_name)}


def compute_bot_record(rows: list[BotAnalysisRow]) -> BotRecord:
    by_game = _bot_rows_by_game(rows)
    wins = losses = draws = 0
    accuracies: list[float] = []

    for row in by_game.values():
        side = bot_side(row.white_name, row.black_name)
        is_white = side is Side.white
        bot_won = row.result == "1-0" if is_white else row.result == "0-1"
        bot_lost = row.result == "0-1" if is_white else row.result == "1-0"
        if bot_won:
            wins += 1
        elif bot_lost:
            losses += 1
        elif row.result == "1/2-1/2":
            draws += 1

        accuracy = row.white_accuracy if is_white else row.black_accuracy
        if accuracy is not None:
            accuracies.append(accuracy)

    games = wins + losses + draws
    score_pct = 100.0 * (wins + 0.5 * draws) / games if games else 0.0
    avg_accuracy = sum(accuracies) / len(accuracies) if accuracies else None

    return BotRecord(
        games=games, wins=wins, losses=losses, draws=draws,
        score_pct=score_pct, avg_accuracy=avg_accuracy,
    )


def compute_bot_classification_breakdown(
    rows: list[BotAnalysisRow],
) -> dict[MoveClassification, int]:
    """Every one of the bot's *own* moves (not the opponent's), across every
    classification - "how often does the bot actually play a Brilliant vs.
    how often does it blunder", the direct evidence behind any future
    tuning decision."""
    counts: dict[MoveClassification, int] = {c: 0 for c in _ALL_CLASSIFICATIONS}
    for row in rows:
        side = bot_side(row.white_name, row.black_name)
        if side is None or row.side != side:
            continue
        counts[row.classification] += 1
    return counts


def compute_bot_phase_breakdown(rows: list[BotAnalysisRow]) -> list[BotPhaseBreakdown]:
    totals: dict[Phase, int] = {phase: 0 for phase in PHASES}
    errors: dict[Phase, dict[MoveClassification, int]] = {
        phase: {c: 0 for c in _ERROR_CLASSIFICATIONS} for phase in PHASES
    }

    for row in rows:
        side = bot_side(row.white_name, row.black_name)
        if side is None or row.side != side:
            continue
        phase = classify_phase(row.fen_before, row.ply)
        totals[phase] += 1
        if row.classification in _ERROR_CLASSIFICATIONS:
            errors[phase][row.classification] += 1

    return [
        BotPhaseBreakdown(
            phase=phase,
            total_moves=totals[phase],
            inaccuracies=errors[phase][MoveClassification.inaccuracy],
            mistakes=errors[phase][MoveClassification.mistake],
            blunders=errors[phase][MoveClassification.blunder],
        )
        for phase in PHASES
    ]


def compute_bot_accuracy_trend(rows: list[BotAnalysisRow], limit: int) -> list[BotAccuracyPoint]:
    """Up to `limit` most recent analysed bot games, oldest first - same
    shape/ordering as game_stats.compute_stats's own accuracy_trend."""
    by_game = _bot_rows_by_game(rows)
    dated: list[tuple[datetime, float]] = []

    for row in by_game.values():
        side = bot_side(row.white_name, row.black_name)
        accuracy = row.white_accuracy if side is Side.white else row.black_accuracy
        if accuracy is None:
            continue
        when = row.played_at
        if when is None:
            continue
        dated.append((when, accuracy))

    dated.sort(key=lambda item: item[0], reverse=True)
    trend = list(reversed(dated[:limit]))
    return [BotAccuracyPoint(played_at=when, accuracy=accuracy) for when, accuracy in trend]
