"""PGN parsing and validation."""

from __future__ import annotations

import io
import logging
import re
from dataclasses import dataclass
from datetime import UTC, datetime

import chess
import chess.pgn

from app.errors import ValidationError
from app.services import openings as openings_service

logger = logging.getLogger(__name__)

UNKNOWN_PLAYER = "Unknown"
DEFAULT_RESULT = "*"


@dataclass
class ParsedGame:
    """Everything the `games` table needs, extracted from a PGN."""

    pgn: str
    white_name: str
    black_name: str
    white_elo: int | None
    black_elo: int | None
    result: str
    eco: str | None
    opening_name: str | None
    played_at: datetime | None
    moves_san: list[str]
    moves_uci: list[str]


def read_game(pgn_text: str) -> chess.pgn.Game:
    """Parse PGN text into a python-chess Game, or raise ValidationError."""
    if not pgn_text or not pgn_text.strip():
        raise ValidationError("PGN is empty.")

    try:
        game = chess.pgn.read_game(io.StringIO(pgn_text))
    except Exception as exc:  # pragma: no cover - python-chess is forgiving
        raise ValidationError("Could not parse PGN.", {"reason": str(exc)}) from exc

    if game is None:
        raise ValidationError("Could not parse PGN: no game found in the input.")

    if game.errors:
        raise ValidationError(
            "PGN contains illegal or unreadable moves.",
            {"errors": [str(error) for error in game.errors]},
        )

    return game


def parse_pgn(pgn_text: str) -> ParsedGame:
    """Validate a PGN and pull out headers plus the mainline moves."""
    game = read_game(pgn_text)

    board = game.board()
    moves_san: list[str] = []
    moves_uci: list[str] = []
    for move in game.mainline_moves():
        moves_san.append(board.san(move))
        moves_uci.append(move.uci())
        board.push(move)

    if not moves_san:
        raise ValidationError("PGN contains no moves.")

    headers = game.headers
    eco = _clean(headers.get("ECO"))
    opening_name = _clean(headers.get("Opening"))

    # Fall back to the bundled book when the PGN carries no opening tags.
    if eco is None or opening_name is None:
        matched = openings_service.match_opening(moves_san)
        if matched is not None:
            eco = eco or matched.eco
            opening_name = opening_name or matched.name

    return ParsedGame(
        pgn=pgn_text.strip(),
        white_name=_clean(headers.get("White")) or UNKNOWN_PLAYER,
        black_name=_clean(headers.get("Black")) or UNKNOWN_PLAYER,
        white_elo=_parse_int(headers.get("WhiteElo")),
        black_elo=_parse_int(headers.get("BlackElo")),
        result=_parse_result(headers.get("Result")),
        eco=eco,
        opening_name=opening_name,
        played_at=_parse_played_at(headers),
        moves_san=moves_san,
        moves_uci=moves_uci,
    )


def split_pgn_games(blob: str) -> list[str]:
    """Split a multi-game PGN blob into one clean PGN string per game.

    Bulk exports (Lichess's `/api/games/user`, Chess.com's monthly archives)
    concatenate games with inconsistent spacing, so each game is re-serialised
    from the parsed tree rather than sliced out of the input by offset. A game
    that fails to parse is logged and skipped so one bad entry cannot take down
    a whole batch.
    """
    if not blob or not blob.strip():
        return []

    stream = io.StringIO(blob)
    games: list[str] = []

    while True:
        position_before = stream.tell()
        try:
            game = chess.pgn.read_game(stream)
        except Exception:  # noqa: BLE001 - one unreadable game must not abort the batch
            logger.warning("Skipping unreadable game in PGN blob", exc_info=True)
            if stream.tell() == position_before:
                # The reader made no progress; continuing would spin forever.
                break
            continue

        if game is None:  # end of stream
            break

        if game.errors:
            logger.warning(
                "Skipping game with PGN errors: %s",
                "; ".join(str(error) for error in game.errors),
            )
            continue

        # A trailing fragment (e.g. stray headers with no moves) parses into an
        # empty game; there is nothing to import from it.
        if not any(True for _ in game.mainline_moves()):
            continue

        exporter = chess.pgn.StringExporter(headers=True, variations=True, comments=True)
        text = game.accept(exporter).strip()
        if text:
            games.append(text)

    return games


def mainline_moves(pgn_text: str) -> tuple[chess.pgn.Game, list[chess.Move]]:
    """Game object plus its mainline moves, for the analysis task."""
    game = read_game(pgn_text)
    moves = list(game.mainline_moves())
    if not moves:
        raise ValidationError("PGN contains no moves.")
    return game, moves


# [Site "https://lichess.org/abcd1234"] -> abcd1234
LICHESS_SITE_GAME_ID_RE = re.compile(r'\[Site\s+"[^"]*lichess\.org/([A-Za-z0-9]+)"\]')

# [Link "https://www.chess.com/game/live/123456789"]
CHESSCOM_LINK_RE = re.compile(r'\[Link\s+"([^"]+)"\]')
_TRAILING_ID_RE = re.compile(r"/(\d+)/?\s*$")


def lichess_game_id_from_pgn(pgn_text: str) -> str | None:
    """The Lichess game id carried in a PGN's Site header, if any."""
    match = LICHESS_SITE_GAME_ID_RE.search(pgn_text or "")
    return match.group(1) if match else None


def chess_com_game_id_from_pgn(pgn_text: str) -> str | None:
    """The Chess.com game id carried in a PGN's Link header, if any.

    Live and daily games are numbered in separate namespaces, so the kind is
    kept in the id (`live_123456789`) - otherwise a live game and a daily game
    that happen to share a number would dedup against each other.
    """
    link_match = CHESSCOM_LINK_RE.search(pgn_text or "")
    if link_match is None:
        return None

    url = link_match.group(1)
    id_match = _TRAILING_ID_RE.search(url)
    if id_match is None:
        return None

    if "/daily" in url:
        kind = "daily"
    elif "/live" in url:
        kind = "live"
    else:
        kind = "game"
    return f"{kind}_{id_match.group(1)}"[:32]


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    if not stripped or set(stripped) <= {"?", "-"}:
        return None
    return stripped


def _parse_int(value: str | None) -> int | None:
    cleaned = _clean(value)
    if cleaned is None:
        return None
    try:
        return int(cleaned)
    except ValueError:
        return None


def _parse_result(value: str | None) -> str:
    cleaned = (value or "").strip()
    if cleaned in {"1-0", "0-1", "1/2-1/2", "*"}:
        return cleaned
    return DEFAULT_RESULT


def _parse_played_at(headers: chess.pgn.Headers) -> datetime | None:
    """Combine the (UTC)Date and (UTC)Time headers into a tz-aware datetime."""
    date_value = _clean(headers.get("UTCDate")) or _clean(headers.get("Date"))
    if date_value is None:
        return None

    date_value = date_value.replace("-", ".")
    try:
        parsed_date = datetime.strptime(date_value, "%Y.%m.%d")
    except ValueError:
        return None

    time_value = _clean(headers.get("UTCTime")) or _clean(headers.get("Time"))
    if time_value:
        try:
            parsed_time = datetime.strptime(time_value, "%H:%M:%S").time()
            parsed_date = datetime.combine(parsed_date.date(), parsed_time)
        except ValueError:
            pass

    return parsed_date.replace(tzinfo=UTC)
