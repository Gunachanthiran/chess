"""Tests for the Lichess cloud-eval client.

The HTTP layer is faked at `httpx.Client`, so nothing here touches the network:
what matters is that a cache hit parses into exactly the shape
`StockfishEngine.analyse()` returns, and that every other outcome - a 404 miss,
a server error, a timeout, a malformed body - degrades to `None` without
raising, because the caller treats this module as best-effort only.
"""

from __future__ import annotations

import chess
import httpx
import pytest

from app.services import lichess_cloud_eval
from app.services.lichess_cloud_eval import (
    CloudEvalSession,
    fetch_cloud_eval,
    fetch_cloud_eval_outcome,
)

START_FEN = chess.Board().fen()

# After 1. f3 e5 2. g4 - Black has 2...Qh4#, so mate-scored pvs are legal here.
FOOLS_MATE_FEN = "rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq g3 0 2"

# After 1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 - White can castle short, which
# Lichess reports in Chess960 king-takes-rook form.
CASTLING_FEN = "r1bqkb1r/1ppp1ppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 2 5"

# Shape of a real hit on the starting position (Lichess caches it very deeply).
CACHE_HIT = {
    "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -",
    "knodes": 13859410,
    "depth": 46,
    "pvs": [
        {"moves": "e2e4 c7c5 g1f3 d7d6 d2d4", "cp": 25},
        {"moves": "d2d4 g8f6 c2c4 e7e6", "cp": 19},
    ],
}


class FakeResponse:
    def __init__(self, status_code: int, payload=None, *, text: str | None = None):
        self.status_code = status_code
        self._payload = payload
        self._text = text

    def json(self):
        if self._text is not None:
            raise ValueError("not JSON")
        return self._payload


class FakeClient:
    """Stands in for `httpx.Client`, recording every request it serves."""

    last_call: dict = {}
    call_count: int = 0

    def __init__(self, response=None, error: Exception | None = None):
        self._response = response
        self._error = error

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def get(self, url, params=None, headers=None):
        FakeClient.last_call = {"url": url, "params": params, "headers": headers}
        FakeClient.call_count += 1
        if self._error is not None:
            raise self._error
        return self._response


@pytest.fixture
def serve(monkeypatch):
    """Make every `httpx.Client` in the module return `response` (or raise)."""

    def _serve(response=None, error: Exception | None = None):
        FakeClient.last_call = {}
        FakeClient.call_count = 0
        monkeypatch.setattr(
            lichess_cloud_eval.httpx,
            "Client",
            lambda *args, **kwargs: FakeClient(response, error),
        )

    return _serve


@pytest.fixture
def no_sleep(monkeypatch):
    """Record the throttle's sleeps instead of actually waiting them out."""
    slept: list[float] = []
    monkeypatch.setattr(lichess_cloud_eval.time, "sleep", slept.append)
    return slept


class TestCacheHit:
    def test_parses_into_the_analyse_shape(self, serve):
        serve(FakeResponse(200, CACHE_HIT))

        result = fetch_cloud_eval(START_FEN)

        assert result is not None
        assert result["cp"] == 25
        assert result["mate"] is None
        assert result["best_move"] == chess.Move.from_uci("e2e4")
        assert result["second_best_cp"] == 19
        assert result["second_best_mate"] is None
        assert result["depth"] == 46

    def test_best_move_is_the_first_uci_token_only(self, serve):
        serve(FakeResponse(200, CACHE_HIT))

        result = fetch_cloud_eval(START_FEN)

        assert result["best_move"] in chess.Board().legal_moves

    def test_mate_scores_are_carried_through(self, serve):
        serve(
            FakeResponse(
                200,
                {
                    "depth": 40,
                    "pvs": [
                        {"moves": "d8h4", "mate": 3},
                        {"moves": "d8f6", "mate": 5},
                    ],
                },
            )
        )

        result = fetch_cloud_eval(FOOLS_MATE_FEN)

        assert result["mate"] == 3
        assert result["cp"] is None
        assert result["second_best_mate"] == 5
        assert result["second_best_cp"] is None

    def test_chess960_style_castling_is_normalised(self, serve):
        """Lichess writes O-O as `e1h1`; read literally that is an illegal move."""
        serve(FakeResponse(200, {"depth": 55, "pvs": [{"moves": "e1h1 f8e7", "cp": 28}]}))

        result = fetch_cloud_eval(CASTLING_FEN)

        assert result["best_move"] == chess.Move.from_uci("e1g1")
        assert result["best_move"] in chess.Board(CASTLING_FEN).legal_moves

    def test_move_illegal_in_the_queried_position_is_rejected(self, serve):
        serve(FakeResponse(200, {"depth": 55, "pvs": [{"moves": "a1a8", "cp": 28}]}))

        assert fetch_cloud_eval(START_FEN) is None

    def test_single_pv_leaves_the_second_best_empty(self, serve):
        serve(FakeResponse(200, {"depth": 38, "pvs": [{"moves": "e2e4", "cp": 25}]}))

        result = fetch_cloud_eval(START_FEN)

        assert result["cp"] == 25
        assert result["second_best_cp"] is None
        assert result["second_best_mate"] is None

    def test_sends_the_required_user_agent_and_query(self, serve):
        serve(FakeResponse(200, CACHE_HIT))

        fetch_cloud_eval(START_FEN, multipv=2)

        call = FakeClient.last_call
        assert call["url"].endswith("/api/cloud-eval")
        assert call["params"] == {"fen": START_FEN, "multiPv": 2}
        # Lichess 404s requests using an HTTP-library default User-Agent.
        assert "ChessScope" in call["headers"]["User-Agent"]


class TestMissesAndFailures:
    def test_404_is_a_clean_none(self, serve):
        """A cache miss is the common case, not an error."""
        serve(FakeResponse(404, {"error": "Not found"}))

        assert fetch_cloud_eval(START_FEN) is None

    def test_server_error_returns_none(self, serve):
        serve(FakeResponse(500, {"error": "boom"}))

        assert fetch_cloud_eval(START_FEN) is None

    def test_network_failure_returns_none(self, serve):
        serve(error=httpx.ConnectError("no route to host"))

        assert fetch_cloud_eval(START_FEN) is None

    def test_timeout_returns_none(self, serve):
        serve(error=httpx.ReadTimeout("too slow"))

        assert fetch_cloud_eval(START_FEN) is None

    def test_non_json_body_returns_none(self, serve):
        serve(FakeResponse(200, text="<html>404</html>"))

        assert fetch_cloud_eval(START_FEN) is None

    @pytest.mark.parametrize(
        "payload",
        [
            None,
            [],
            {},
            {"depth": 40},
            {"depth": 40, "pvs": []},
            {"depth": 40, "pvs": [{"cp": 25}]},
            {"depth": 40, "pvs": [{"moves": "", "cp": 25}]},
            {"depth": 40, "pvs": [{"moves": "not-a-move", "cp": 25}]},
        ],
    )
    def test_malformed_payloads_return_none(self, serve, payload):
        serve(FakeResponse(200, payload))

        assert fetch_cloud_eval(START_FEN) is None

    def test_empty_fen_never_hits_the_network(self, serve):
        serve(FakeResponse(200, CACHE_HIT))

        assert fetch_cloud_eval("  ") is None
        assert FakeClient.last_call == {}


class TestFailureClassification:
    """Only outcomes that are *Lichess's* fault should count against it."""

    def test_rate_limiting_is_a_service_failure(self, serve):
        serve(FakeResponse(429, {"error": "Too Many Requests"}))

        outcome = fetch_cloud_eval_outcome(START_FEN)

        assert outcome.data is None
        assert outcome.failed is True

    def test_cache_miss_is_not_a_failure(self, serve):
        serve(FakeResponse(404, {"error": "Not found"}))

        assert fetch_cloud_eval_outcome(START_FEN).failed is False

    def test_timeout_is_a_service_failure(self, serve):
        serve(error=httpx.ReadTimeout("too slow"))

        assert fetch_cloud_eval_outcome(START_FEN).failed is True

    def test_server_error_is_a_service_failure(self, serve):
        serve(FakeResponse(500, {"error": "boom"}))

        assert fetch_cloud_eval_outcome(START_FEN).failed is True

    def test_unusable_body_is_the_positions_fault_not_the_services(self, serve):
        """A 200 we cannot parse says nothing about the service's health."""
        serve(FakeResponse(200, {"depth": 40, "pvs": []}))

        outcome = fetch_cloud_eval_outcome(START_FEN)

        assert outcome.data is None
        assert outcome.failed is False

    def test_hit_is_not_a_failure(self, serve):
        serve(FakeResponse(200, CACHE_HIT))

        assert fetch_cloud_eval_outcome(START_FEN).failed is False


class TestCloudEvalSession:
    """The per-job circuit breaker: stop paying for a service that says no."""

    def test_repeated_rate_limiting_stops_the_requests(self, serve, no_sleep):
        serve(FakeResponse(429, {"error": "Too Many Requests"}))
        session = CloudEvalSession(failure_limit=3)

        results = [session.fetch(START_FEN) for _ in range(10)]

        assert results == [None] * 10
        # Three doomed round-trips for the whole job, not ten.
        assert FakeClient.call_count == 3
        assert session.enabled is False

    def test_a_disabled_session_never_touches_the_network_again(self, serve, no_sleep):
        serve(FakeResponse(429, {"error": "Too Many Requests"}))
        session = CloudEvalSession(failure_limit=3)
        for _ in range(3):
            session.fetch(START_FEN)

        # Even a suddenly healthy Lichess is not consulted again this job.
        serve(FakeResponse(200, CACHE_HIT))

        assert session.fetch(START_FEN) is None
        assert FakeClient.call_count == 0

    def test_a_cache_miss_does_not_count_against_the_service(self, serve, no_sleep):
        serve(FakeResponse(404, {"error": "Not found"}))
        session = CloudEvalSession(failure_limit=3)

        for _ in range(10):
            session.fetch(START_FEN)

        # Most middlegame positions are simply uncached; that must not trip it.
        assert session.enabled is True
        assert FakeClient.call_count == 10

    def test_failures_must_be_consecutive_to_trip_it(self, serve, no_sleep):
        session = CloudEvalSession(failure_limit=3)

        serve(FakeResponse(429, {"error": "Too Many Requests"}))
        session.fetch(START_FEN)
        session.fetch(START_FEN)
        serve(FakeResponse(200, CACHE_HIT))
        session.fetch(START_FEN)
        serve(FakeResponse(429, {"error": "Too Many Requests"}))
        session.fetch(START_FEN)
        session.fetch(START_FEN)

        assert session.consecutive_failures == 2
        assert session.enabled is True

    def test_a_hit_is_returned_unchanged(self, serve, no_sleep):
        serve(FakeResponse(200, CACHE_HIT))

        result = CloudEvalSession().fetch(START_FEN)

        assert result == fetch_cloud_eval(START_FEN)
        assert result["depth"] == 46

    def test_requests_are_spaced_out(self, serve, no_sleep):
        """Be a good citizen of a free service: never hammer it back-to-back."""
        serve(FakeResponse(404, {"error": "Not found"}))
        session = CloudEvalSession(min_interval_s=0.3)

        session.fetch(START_FEN)
        session.fetch(START_FEN)

        assert len(no_sleep) == 1  # the first request waits for nobody
        assert 0 < no_sleep[0] <= 0.3

    def test_a_slow_caller_is_never_made_to_wait(self, serve, no_sleep):
        serve(FakeResponse(404, {"error": "Not found"}))
        session = CloudEvalSession(min_interval_s=0.0)

        session.fetch(START_FEN)
        session.fetch(START_FEN)

        assert no_sleep == []
