"""Bundled opening book: ECO/name lookup and book-move detection.

The table in `app/data/openings.json` is a curated subset of opening theory
(~190 mainlines), which is plenty to name most games and to recognise the first
handful of moves as "book".
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "openings.json"


@dataclass(frozen=True)
class Opening:
    eco: str
    name: str
    moves_san: tuple[str, ...]


@lru_cache(maxsize=1)
def load_openings() -> tuple[Opening, ...]:
    with DATA_PATH.open(encoding="utf-8") as handle:
        raw = json.load(handle)
    return tuple(
        Opening(eco=item["eco"], name=item["name"], moves_san=tuple(item["moves_san"]))
        for item in raw
    )


@lru_cache(maxsize=1)
def _book_prefixes() -> frozenset[tuple[str, ...]]:
    """Every position along every known line, as a SAN-sequence prefix set."""
    prefixes: set[tuple[str, ...]] = set()
    for opening in load_openings():
        for length in range(1, len(opening.moves_san) + 1):
            prefixes.add(opening.moves_san[:length])
    return frozenset(prefixes)


@lru_cache(maxsize=1)
def _lines_by_sequence() -> dict[tuple[str, ...], Opening]:
    return {opening.moves_san: opening for opening in load_openings()}


def is_book_line(moves_san: tuple[str, ...] | list[str]) -> bool:
    """True if this exact SAN sequence still follows a known opening line."""
    if not moves_san:
        return False
    return tuple(moves_san) in _book_prefixes()


def match_opening(moves_san: list[str] | tuple[str, ...]) -> Opening | None:
    """Longest known opening line that is a prefix of the given game."""
    sequence = tuple(moves_san)
    lines = _lines_by_sequence()
    for length in range(min(len(sequence), _max_line_length()), 0, -1):
        opening = lines.get(sequence[:length])
        if opening is not None:
            return opening
    return None


def current_opening(moves_san: list[str] | tuple[str, ...]) -> Opening | None:
    """The opening naming this position, or None once the game has left book.

    Differs from `match_opening` in exactly one way, and it is the point of the
    function: `match_opening` answers "what opening was this game?", so it keeps
    reporting the last line it recognised for the rest of the game. This answers
    "what opening are we *in* right now?", which stops being a meaningful
    question the moment the players leave theory - so a sequence that is no
    longer a prefix of any known line returns None rather than a stale name.

    Both halves reuse the existing matcher: `is_book_line` decides whether the
    sequence is still on a known path, `match_opening` names the deepest
    complete line reached along it.
    """
    if not moves_san:
        return None
    if not is_book_line(moves_san):
        return None
    return match_opening(moves_san)


@lru_cache(maxsize=1)
def _max_line_length() -> int:
    return max((len(opening.moves_san) for opening in load_openings()), default=0)
