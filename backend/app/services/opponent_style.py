"""Cheap, engine-free read on how the human opponent has been playing.

Deliberately no Stockfish call: this runs on every bot move, and the whole
point is to nudge `tal_bot`'s personality weights (see `gambit_strategy.py`)
without adding a second engine workload on top of the bot's own search — this
host is already CPU-starved (see `tal_bot`'s notes on that). Everything here
is a handful of cheap counts over the already-replayed move history.

These are approximate signals, not a full behavioural model: they are meant to
nudge a few personality weights in a plausible direction, not to diagnose an
opponent's rating or repertoire.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import chess

from app.services.classification import PIECE_VALUES, material_balance

# Minimum material given up (in pawn-units) across a move-then-reply pair to
# count that move as a "sacrifice offered" — see `_sacrifice_deltas`.
SACRIFICE_THRESHOLD = 2

# Ply (half-move) count within which minor-piece development is judged "fast".
DEVELOPMENT_PLY_WINDOW = 16  # ~8 own moves

# Plies beyond which the game is considered to have reached an endgame phase
# for the purposes of "endgame_oriented" — combined with a material check
# below so a short, quiet draw doesn't get mislabelled.
ENDGAME_PLY_FLOOR = 40

KINGSIDE_FILES = frozenset("fgh")
QUEENSIDE_FILES = frozenset("abc")
MINOR_PIECE_LETTERS = frozenset("NB")


@dataclass(frozen=True)
class OpponentProfile:
    """A snapshot of how the opponent has played so far this game."""

    tags: tuple[str, ...] = ("positional",)
    scores: dict[str, float] = field(default_factory=dict)

    @property
    def is_aggressive(self) -> bool:
        return "aggressive" in self.tags or "tactical" in self.tags

    @property
    def is_passive(self) -> bool:
        return "passive" in self.tags or "defensive" in self.tags or "positional" in self.tags


NEUTRAL_PROFILE = OpponentProfile()


def _san_destination(san: str) -> str | None:
    """Destination square from a SAN string, or None for castling."""
    if san.startswith("O-O"):
        return None
    body = san.rstrip("+#")
    body = body.split("=")[0]
    if len(body) < 2:
        return None
    return body[-2:]


def classify(
    moves: list[tuple[str, str, chess.Color]],
    opponent_color: chess.Color,
) -> OpponentProfile:
    """Classify the opponent's play from `moves`: `(san, uci, side)` triples
    in ply order for the *whole* game (both sides), as already replayed by
    the caller. Only `opponent_color`'s own moves are scored; the other
    side's moves are replayed to give sacrifice-detection something to check
    the very next ply against.
    """
    opponent_moves = [(i, san, uci) for i, (san, uci, side) in enumerate(moves) if side == opponent_color]
    if not opponent_moves:
        return NEUTRAL_PROFILE

    board = chess.Board()
    balances: list[int] = [material_balance(board, opponent_color)]
    for _san, uci, _side in moves:
        board.push(chess.Move.from_uci(uci))
        balances.append(material_balance(board, opponent_color))

    n = len(opponent_moves)
    captures = 0
    checks = 0
    sacrifices = 0
    kingside_pushes = 0
    queenside_pushes = 0
    developed_minors: set[str] = set()
    castled = False

    for ply_index, san, _uci in opponent_moves:
        if "x" in san:
            captures += 1
        if san.endswith("+") or san.endswith("#"):
            checks += 1
        if san.startswith("O-O"):
            castled = True

        piece_letter = san[0] if san[0] in MINOR_PIECE_LETTERS else None
        dest = _san_destination(san)
        if dest is not None:
            file_letter = dest[0]
            rank = int(dest[1])
            # "Advancing" is relative to the opponent's own side.
            advanced = rank >= 4 if opponent_color == chess.WHITE else rank <= 5
            if piece_letter is None and advanced:  # a pawn push
                if file_letter in KINGSIDE_FILES:
                    kingside_pushes += 1
                elif file_letter in QUEENSIDE_FILES:
                    queenside_pushes += 1
            if piece_letter in MINOR_PIECE_LETTERS and ply_index < DEVELOPMENT_PLY_WINDOW:
                developed_minors.add(f"{piece_letter}{dest}")

        # Sacrifice: material given up by this move that is still missing
        # after the very next ply (the opponent's own following reply to
        # whatever we played). Undetectable for the most recent move if
        # there's no reply recorded yet — that's fine, it just isn't counted.
        before = balances[ply_index]
        after_index = ply_index + 2
        if after_index < len(balances):
            if before - balances[after_index] >= SACRIFICE_THRESHOLD:
                sacrifices += 1

    capture_rate = captures / n
    check_rate = checks / n
    sacrifice_rate = sacrifices / n
    development_rate = len(developed_minors) / 2  # 2 minors per side, cheap normalisation
    kingside_rate = kingside_pushes / n
    queenside_rate = queenside_pushes / n

    total_plies = len(moves)
    pieces_left = chess.popcount(board.occupied) - 2  # excluding both kings
    is_endgame = total_plies >= ENDGAME_PLY_FLOOR and pieces_left <= 10

    scores = {
        "aggressive": 0.6 * check_rate + 0.4 * kingside_rate + (0.15 if not castled and n >= 6 else 0.0),
        "tactical": 0.5 * capture_rate + 0.5 * check_rate,
        "material_focused": capture_rate,
        "sacrificial": min(1.0, sacrifice_rate * 3),
        "fast_developing": min(1.0, development_rate),
        "passive": max(0.0, 1.0 - development_rate - capture_rate - check_rate),
        "defensive": (0.4 if castled and n >= 6 else 0.0) + max(0.0, 0.3 - check_rate),
        "kingside_attacking": kingside_rate,
        "queenside_attacking": queenside_rate,
        "positional": max(0.0, 0.5 - capture_rate) + (0.2 if development_rate >= 0.5 else 0.0),
        "endgame_oriented": 1.0 if is_endgame else 0.0,
    }

    ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    tags = tuple(tag for tag, score in ranked[:3] if score >= 0.3)
    if not tags:
        tags = ("positional",)

    return OpponentProfile(tags=tags, scores=scores)
