"""Lichess Cloud Eval lookups: free, pre-computed evaluations for cached FENs.

Lichess keeps a crowd-sourced cache of deep engine evaluations, mostly of
opening theory, and serves it from a public unauthenticated endpoint. A hit is
usually far deeper than anything local Stockfish would produce in a comparable
amount of time; a miss is a plain HTTP 404 and is completely normal - most
non-opening positions have simply never been cached.

This module is a best-effort optimisation layer, so *nothing* here ever raises:
every failure mode (miss, timeout, network error, malformed payload) collapses
to `None`, and the caller falls back to local Stockfish, which remains the
reliable evaluator of record.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass

import chess
import httpx

from app.config import settings

logger = logging.getLogger(__name__)

CLOUD_EVAL_PATH = "/api/cloud-eval"

# How many consecutive *service* failures (429s, 5xx, timeouts - not plain
# cache misses) a `CloudEvalSession` tolerates before giving up on Lichess for
# the rest of its lifetime.
FAILURE_LIMIT = 3

# Floor on the spacing between two requests from the same session. Lichess
# serves this endpoint for free and rate-limits aggressively; a few hundred
# milliseconds costs nothing next to a local search but markedly reduces how
# often we trip the limiter in the first place.
MIN_REQUEST_INTERVAL_S = 0.3


@dataclass(frozen=True)
class CloudEvalOutcome:
    """One lookup's result plus whether Lichess itself failed to answer.

    `failed` distinguishes "the service refused or could not be reached"
    (HTTP 429/5xx, timeout, connection error) from "the service answered and
    has nothing cached for this position" (HTTP 404). Both give `data is None`
    and both fall back to local search, but only the former says anything about
    whether further requests are worth making.
    """

    data: dict | None
    failed: bool


class CloudEvalSession:
    """Cloud-eval lookups for one job, with a one-way circuit breaker.

    Instantiate one per `analyze_game` run and call `fetch` instead of
    `fetch_cloud_eval`. After `failure_limit` consecutive service failures the
    session stops calling out entirely and every later lookup returns `None`
    immediately, so a rate-limited Lichess costs one round-trip per job instead
    of one per ply. There is deliberately no resumption policy: local Stockfish
    is always correct and always available, so re-probing a service that is
    actively rejecting us only buys latency back.

    Thread-safe. One job now evaluates its positions on a pool of worker
    threads, all sharing this session, and the breaker's semantics are stated
    per *job*: three consecutive failures in total, not three per thread. The
    lock guards the counter, the `enabled` flag and the throttle's slot
    bookkeeping so both stay true under concurrent `fetch` calls. Only the
    bookkeeping is serialised - the HTTP round-trip and the throttle's sleep
    both happen outside the lock, so N threads still have N requests in flight.
    """

    def __init__(
        self,
        failure_limit: int = FAILURE_LIMIT,
        min_interval_s: float = MIN_REQUEST_INTERVAL_S,
    ) -> None:
        self.failure_limit = failure_limit
        self.min_interval_s = min_interval_s
        self.enabled = True
        self.consecutive_failures = 0
        self._last_request_at: float | None = None
        self._lock = threading.Lock()

    def fetch(self, fen: str, multipv: int = 2, timeout: float = 2.0) -> dict | None:
        """Same contract as `fetch_cloud_eval`, minus the doomed round-trips."""
        with self._lock:
            if not self.enabled:
                return None

        self._wait_for_slot()
        outcome = fetch_cloud_eval_outcome(fen, multipv=multipv, timeout=timeout)
        self._record(outcome)
        return outcome.data

    def _record(self, outcome: CloudEvalOutcome) -> None:
        """Fold one outcome into the breaker's state."""
        with self._lock:
            if not outcome.failed:
                self.consecutive_failures = 0
                return

            self.consecutive_failures += 1
            if self.consecutive_failures >= self.failure_limit and self.enabled:
                self.enabled = False
                logger.warning(
                    "Disabling Lichess cloud eval for this job after %s consecutive "
                    "failures; falling back to local Stockfish for every position.",
                    self.consecutive_failures,
                )

    def _wait_for_slot(self) -> None:
        """Claim the next request slot, then wait for it outside the lock.

        Each caller reserves a distinct instant at least `min_interval_s` after
        the previously reserved one, so concurrent threads queue up rather than
        all sleeping against the same stale timestamp and firing together.
        """
        with self._lock:
            now = time.monotonic()
            if self._last_request_at is None:
                self._last_request_at = now
                return
            slot = max(now, self._last_request_at + self.min_interval_s)
            self._last_request_at = slot
            delay = slot - now

        if delay > 0:
            time.sleep(delay)


def fetch_cloud_eval(fen: str, multipv: int = 2, timeout: float = 2.0) -> dict | None:
    """Cached Lichess evaluation for `fen`, or `None` if unavailable.

    `timeout` is deliberately short: a slow or unreachable Lichess must never
    add meaningful latency, because the local engine can always do the work.

    The returned dict has exactly the shape `StockfishEngine.analyse()` returns
    (`cp`, `mate`, `best_move`, `second_best_cp`, `second_best_mate`) plus a
    `depth` key carrying the cloud entry's own search depth, so a caller can
    decide whether the cached eval is deep enough to trust.

    `None` means "no usable answer" and is never an error condition.
    """
    return fetch_cloud_eval_outcome(fen, multipv=multipv, timeout=timeout).data


def fetch_cloud_eval_outcome(
    fen: str, multipv: int = 2, timeout: float = 2.0
) -> CloudEvalOutcome:
    """`fetch_cloud_eval` plus whether the failure (if any) was Lichess's.

    Callers that only want the evaluation should use `fetch_cloud_eval`; this
    exists for `CloudEvalSession`, which needs to tell a rate-limited service
    apart from an uncached position.
    """
    position = (fen or "").strip()
    if not position:
        return CloudEvalOutcome(None, failed=False)

    url = f"{settings.LICHESS_API_BASE.rstrip('/')}{CLOUD_EVAL_PATH}"
    headers = {
        "Accept": "application/json",
        # Lichess answers requests carrying an HTTP-library default User-Agent
        # with a 404 HTML page, so a descriptive one is required here too.
        "User-Agent": settings.LICHESS_USER_AGENT,
    }

    try:
        with httpx.Client(timeout=httpx.Timeout(timeout)) as client:
            response = client.get(
                url,
                params={"fen": position, "multiPv": multipv},
                headers=headers,
            )
    except httpx.HTTPError as exc:
        logger.debug("Cloud eval unreachable for %s: %s", position, exc)
        return CloudEvalOutcome(None, failed=True)

    # A miss is the common case, not a failure: stay silent about it. The
    # service answered us perfectly well; it just has nothing cached here.
    if response.status_code == 404:
        return CloudEvalOutcome(None, failed=False)

    # Anything else - 429 rate limiting above all, but equally 5xx - means the
    # service did not do its job, and says something about whether the next
    # request is worth making.
    if response.status_code != 200:
        logger.debug(
            "Cloud eval returned HTTP %s for %s", response.status_code, position
        )
        return CloudEvalOutcome(None, failed=True)

    try:
        payload = response.json()
    except ValueError as exc:
        logger.debug("Cloud eval returned non-JSON for %s: %s", position, exc)
        return CloudEvalOutcome(None, failed=True)

    # A 200 whose body we cannot use is the position's fault, not the service's.
    return CloudEvalOutcome(_parse(payload, position), failed=False)


def _parse(payload: object, fen: str) -> dict | None:
    """Turn a cloud-eval payload into an `analyse()`-shaped dict, or `None`."""
    if not isinstance(payload, dict):
        logger.debug("Cloud eval payload was not an object for %s", fen)
        return None

    pvs = payload.get("pvs")
    if not isinstance(pvs, list) or not pvs or not isinstance(pvs[0], dict):
        logger.debug("Cloud eval payload had no usable pvs for %s", fen)
        return None

    try:
        board = chess.Board(fen)
    except ValueError as exc:
        logger.debug("Cloud eval was queried with an unparseable FEN %s: %s", fen, exc)
        return None

    best_move = _first_move(pvs[0], board)
    if best_move is None:
        logger.debug("Cloud eval payload had no playable move for %s", fen)
        return None

    cp, mate = _score(pvs[0])
    second_cp: int | None = None
    second_mate: int | None = None
    if len(pvs) > 1 and isinstance(pvs[1], dict):
        second_cp, second_mate = _score(pvs[1])

    # Same shape as `StockfishEngine.analyse()`'s own `top_moves` — see that
    # method for why the panel this feeds needs a ranked pool, not just one
    # move. Built from every returned pv, not just the first two.
    top_moves: list[dict] = []
    for pv in pvs:
        if not isinstance(pv, dict):
            continue
        move = _first_move(pv, board)
        if move is None:
            continue
        move_cp, move_mate = _score(pv)
        top_moves.append({"move": move, "cp": move_cp, "mate": move_mate})

    return {
        "cp": cp,
        "mate": mate,
        "best_move": best_move,
        "second_best_cp": second_cp,
        "second_best_mate": second_mate,
        "top_moves": top_moves,
        "depth": _depth(payload),
    }


def _first_move(pv: dict, board: chess.Board) -> chess.Move | None:
    """The move to play from the queried FEN: first UCI token of `moves`.

    Parsed against the board rather than with bare `Move.from_uci`, because
    Lichess writes castling in the Chess960 king-takes-rook form (`e1h1`), which
    is an illegal king move when read literally. `parse_uci` normalises that to
    `e1g1` and rejects anything not actually playable here.
    """
    moves = pv.get("moves")
    if not isinstance(moves, str):
        return None

    tokens = moves.split()
    if not tokens:
        return None

    try:
        return board.parse_uci(tokens[0])
    except ValueError:  # covers both invalid and illegal UCI
        return None


def _score(pv: dict) -> tuple[int | None, int | None]:
    """`(cp, mate)` for one pv entry; Lichess sends one or the other, never both.

    Cloud eval scores are already White-POV, matching `analyse()`'s convention.
    """
    cp = pv.get("cp")
    mate = pv.get("mate")
    return (
        cp if isinstance(cp, int) else None,
        mate if isinstance(mate, int) else None,
    )


def _depth(payload: dict) -> int | None:
    depth = payload.get("depth")
    return depth if isinstance(depth, int) else None
