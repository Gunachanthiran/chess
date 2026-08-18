"""Bundled gambit/aggressive-opening library: the "Choose Your Gambit" data
source for the Play Bot setup screen.

Same shape and loading pattern as `openings.py`'s bundled opening book — a
curated JSON file, loaded once and cached, with prefix-matching helpers so the
UI never needs the gambit logic hard-coded into it (the list endpoint just
serialises `load_gambits()`, and adding a new gambit is a JSON entry, not a
code change).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import chess

DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "gambits.json"

# Multiplier applied to a personality term when a gambit's data doesn't
# specify one — "no opinion", not "suppress it".
DEFAULT_WEIGHT = 1.0


@dataclass(frozen=True)
class GambitWeights:
    """Multipliers on `tal_bot`'s personality terms plus the two gambit-only
    ones (`development`, `center_control`) — see `gambit_strategy.py`."""

    development: float = DEFAULT_WEIGHT
    king_attack: float = DEFAULT_WEIGHT
    center_control: float = DEFAULT_WEIGHT
    sacrifice: float = DEFAULT_WEIGHT


@dataclass(frozen=True)
class Gambit:
    id: str
    name: str
    side: str  # "white" or "black" — the colour this gambit belongs to
    eco: str
    starting_moves: tuple[str, ...]  # SAN, from the game's start position
    description: str
    style: tuple[str, ...]
    aggression_level: int
    recommended_response: str
    weights: GambitWeights = field(default_factory=GambitWeights)


@lru_cache(maxsize=1)
def load_gambits() -> tuple[Gambit, ...]:
    with DATA_PATH.open(encoding="utf-8") as handle:
        raw = json.load(handle)
    return tuple(
        Gambit(
            id=item["id"],
            name=item["name"],
            side=item["side"],
            eco=item["eco"],
            starting_moves=tuple(item["starting_moves"]),
            description=item["description"],
            style=tuple(item["style"]),
            aggression_level=item["aggression_level"],
            recommended_response=item["recommended_response"],
            weights=GambitWeights(**item.get("weights", {})),
        )
        for item in raw
    )


@lru_cache(maxsize=1)
def _by_id() -> dict[str, Gambit]:
    return {gambit.id: gambit for gambit in load_gambits()}


def get_gambit(gambit_id: str) -> Gambit | None:
    return _by_id().get(gambit_id)


def list_gambits(side: str | None = None) -> tuple[Gambit, ...]:
    """Every bundled gambit, optionally filtered to one side.

    `side` is the colour the *bot* will play — a White gambit is meaningless
    with the bot playing Black, so the setup form filters by this before
    ever showing the list.
    """
    gambits = load_gambits()
    if side is None:
        return gambits
    return tuple(gambit for gambit in gambits if gambit.side == side)


def is_gambit_line(gambit: Gambit, moves_san: tuple[str, ...] | list[str]) -> bool:
    """True if `moves_san` is still a prefix of `gambit.starting_moves`."""
    sequence = tuple(moves_san)
    return sequence == gambit.starting_moves[: len(sequence)]


def validate_gambits() -> None:
    """Every gambit's `starting_moves` must replay legally from the start
    position. Exercised by `tests/test_gambits.py` so a bad SAN entry in the
    JSON fails a test, never a live game."""
    for gambit in load_gambits():
        board = chess.Board()
        for san in gambit.starting_moves:
            board.push_san(san)
