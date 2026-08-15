"""Tests for the parallel position-evaluation phase of `analyze_game`.

No Stockfish process and no network here: the engine class is replaced by a
recording fake and `evaluate_position` by a function that answers from the board
alone, so the assertions are about *scheduling* - that every position is
evaluated exactly once, that results come back in board order however the worker
threads interleave, that each worker starts exactly one engine for its whole
chunk, and that a worker failure still reaches the caller.

The last class exercises the real thing under real threads: `CloudEvalSession`
is now shared by every worker in a job, so its circuit breaker has to count
failures per job rather than per thread.
"""

from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor

import chess
import pytest

from app.errors import EngineError
from app.services import lichess_cloud_eval
from app.services.lichess_cloud_eval import CloudEvalOutcome, CloudEvalSession
from app.tasks import analyze_game as task
from app.tasks.analyze_game import chunk_ranges, evaluate_positions

# A short real game, used wherever a genuine move list is needed.
SCHOLARS_MATE = ["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7"]

# Knights shuffling out and back: a legal move list of any length, so a test can
# ask for more positions than there are workers without inventing a real game.
# Every position is still distinct (the halfmove clock keeps climbing).
SHUFFLE = ["g1f3", "g8f6", "f3g1", "f6g8"]
LONG_GAME = SHUFFLE * 6  # 24 plies -> 25 positions
LONGER_GAME = SHUFFLE * 12


def moves(ucis: list[str]) -> list[chess.Move]:
    """Turn UCI strings into moves legal in sequence from the start position."""
    board = chess.Board()
    parsed = []
    for uci in ucis:
        move = chess.Move.from_uci(uci)
        parsed.append(move)
        board.push(move)
    return parsed


class FakeEngine:
    """Stands in for `StockfishEngine`: records its own lifecycle and boards."""

    instances: list["FakeEngine"] = []
    lock = threading.Lock()

    def __init__(self, threads: int | None = None, **kwargs):
        self.threads = threads
        self.kwargs = kwargs
        self.opened = 0
        self.closed = 0
        self.boards: list[str] = []
        with FakeEngine.lock:
            FakeEngine.instances.append(self)

    def __enter__(self):
        self.opened += 1
        return self

    def __exit__(self, exc_type, exc, tb):
        self.closed += 1
        return False


@pytest.fixture
def fake_pool(monkeypatch):
    """Replace the engine class and the evaluator; return the engine registry.

    `evaluate` answers `{"cp": <plies played>}`, which for the checkpoint boards
    `_replay` produces is exactly the board's index - so a caller can assert on
    ordering without knowing anything about chess.
    """
    FakeEngine.instances = []
    monkeypatch.setattr(task, "StockfishEngine", FakeEngine)

    def evaluate(engine, board, cloud_session=None, **kwargs):
        engine.boards.append(board.fen())
        return {"cp": len(board.move_stack), "cloud_session": cloud_session}

    monkeypatch.setattr(task.position_evaluator, "evaluate_position", evaluate)
    return FakeEngine


class TestChunkRanges:
    def test_even_split(self):
        assert chunk_ranges(8, 4) == [(0, 2), (2, 4), (4, 6), (6, 8)]

    def test_uneven_split_differs_by_at_most_one(self):
        ranges = chunk_ranges(71, 4)

        sizes = [end - start for start, end in ranges]
        assert max(sizes) - min(sizes) <= 1
        assert sum(sizes) == 71

    @pytest.mark.parametrize("total", list(range(1, 30)))
    def test_every_position_is_covered_exactly_once(self, total):
        covered = [
            index for start, end in chunk_ranges(total, 4) for index in range(start, end)
        ]

        assert covered == list(range(total))  # contiguous, ordered, no gaps

    def test_fewer_positions_than_workers_starts_fewer_engines(self):
        """A 1-move game must not spin up four Stockfish processes for two positions."""
        assert chunk_ranges(2, 4) == [(0, 1), (1, 2)]

    def test_a_single_position_is_one_chunk(self):
        assert chunk_ranges(1, 4) == [(0, 1)]

    def test_nothing_to_do_means_no_chunks(self):
        assert chunk_ranges(0, 4) == []

    @pytest.mark.parametrize("workers", [0, -1])
    def test_a_nonsensical_pool_size_still_evaluates_everything(self, workers):
        assert chunk_ranges(5, workers) == [(0, 5)]


class TestEvaluatePositions:
    def test_results_come_back_in_board_order(self, fake_pool):
        boards, _ = task._replay(moves(SCHOLARS_MATE))

        results = evaluate_positions(boards, pool_size=4)

        assert [result["cp"] for result in results] == list(range(len(boards)))

    def test_one_result_per_position(self, fake_pool):
        boards, _ = task._replay(moves(SCHOLARS_MATE))

        assert len(evaluate_positions(boards, pool_size=4)) == len(boards) == 8

    def test_order_survives_workers_finishing_out_of_order(self, monkeypatch, fake_pool):
        """Later chunks are made to finish first; the output must still be ordered."""
        boards, _ = task._replay(moves(LONG_GAME))

        def slow_for_early_boards(engine, board, cloud_session=None, **kwargs):
            # The earlier the position, the slower it is: without index-keyed
            # writes this would come back roughly reversed.
            time.sleep(0.02 * (len(boards) - len(board.move_stack)) / len(boards))
            return {"cp": len(board.move_stack)}

        monkeypatch.setattr(
            task.position_evaluator, "evaluate_position", slow_for_early_boards
        )

        results = evaluate_positions(boards, pool_size=4)

        assert [result["cp"] for result in results] == list(range(len(boards)))

    def test_each_worker_opens_exactly_one_engine_for_its_whole_chunk(self, fake_pool):
        """Per-position engine spawning would hand back the time parallelism saved."""
        boards, _ = task._replay(moves(LONG_GAME))

        evaluate_positions(boards, pool_size=4)

        assert len(fake_pool.instances) == 4  # one per chunk, not one per position
        for engine in fake_pool.instances:
            assert engine.opened == 1
            assert engine.closed == 1
        assert sum(len(engine.boards) for engine in fake_pool.instances) == len(boards)

    def test_each_engine_sees_one_contiguous_chunk(self, fake_pool):
        boards, _ = task._replay(moves(LONG_GAME))
        order = {board.fen(): index for index, board in enumerate(boards)}

        evaluate_positions(boards, pool_size=4)

        chunks = [
            [order[fen] for fen in engine.boards] for engine in fake_pool.instances
        ]
        for chunk in chunks:
            assert chunk == list(range(chunk[0], chunk[0] + len(chunk)))
        assert sorted(index for chunk in chunks for index in chunk) == list(
            range(len(boards))
        )

    def test_pooled_engines_get_the_reduced_thread_count(self, fake_pool):
        boards, _ = task._replay(moves(SCHOLARS_MATE))

        evaluate_positions(boards, pool_size=2, threads_per_engine=2)

        assert [engine.threads for engine in fake_pool.instances] == [2, 2]

    def test_defaults_come_from_settings(self, fake_pool):
        boards, _ = task._replay(moves(LONG_GAME))

        evaluate_positions(boards)

        assert len(fake_pool.instances) == task.settings.ANALYSIS_POOL_SIZE
        assert all(
            engine.threads == task.settings.ANALYSIS_POOL_THREADS_PER_ENGINE
            for engine in fake_pool.instances
        )

    def test_a_one_move_game_is_handled(self, fake_pool):
        boards, _ = task._replay(moves(["e2e4"]))

        results = evaluate_positions(boards, pool_size=4)

        assert [result["cp"] for result in results] == [0, 1]
        assert len(fake_pool.instances) == 2  # two positions, two chunks

    def test_no_positions_means_no_engines(self, fake_pool):
        assert evaluate_positions([]) == []
        assert fake_pool.instances == []

    def test_the_shared_cloud_session_reaches_every_worker(self, fake_pool):
        boards, _ = task._replay(moves(LONG_GAME))
        session = CloudEvalSession()

        results = evaluate_positions(boards, cloud_session=session, pool_size=4)

        # One breaker for the job, not one per worker thread.
        assert {id(result["cloud_session"]) for result in results} == {id(session)}


class TestWorkerFailures:
    def test_an_engine_error_reaches_the_caller(self, monkeypatch, fake_pool):
        boards, _ = task._replay(moves(SCHOLARS_MATE))

        def explode(engine, board, cloud_session=None, **kwargs):
            raise EngineError("Stockfish died.")

        monkeypatch.setattr(task.position_evaluator, "evaluate_position", explode)

        with pytest.raises(EngineError):
            evaluate_positions(boards, pool_size=4)

    def test_a_failure_stops_the_other_workers_early(self, monkeypatch, fake_pool):
        """Siblings must abandon their chunk, not grind through it while shutting down."""
        boards, _ = task._replay(moves(LONGER_GAME))
        evaluated = []

        def explode_on_the_first_position(engine, board, cloud_session=None, **kwargs):
            if len(board.move_stack) == 0:
                raise EngineError("Stockfish died.")
            time.sleep(0.01)
            evaluated.append(board.fen())
            return {"cp": 0}

        monkeypatch.setattr(
            task.position_evaluator, "evaluate_position", explode_on_the_first_position
        )

        with pytest.raises(EngineError):
            evaluate_positions(boards, pool_size=4)

        assert len(evaluated) < len(boards) - 1

    def test_every_engine_is_closed_even_when_a_worker_fails(
        self, monkeypatch, fake_pool
    ):
        boards, _ = task._replay(moves(LONG_GAME))

        def explode(engine, board, cloud_session=None, **kwargs):
            raise EngineError("Stockfish died.")

        monkeypatch.setattr(task.position_evaluator, "evaluate_position", explode)

        with pytest.raises(EngineError):
            evaluate_positions(boards, pool_size=4)

        assert all(engine.closed == 1 for engine in fake_pool.instances)


class TestProgressReporting:
    def test_progress_is_reported_and_ends_at_the_total(self, fake_pool):
        boards, _ = task._replay(moves(LONG_GAME))
        seen: list[tuple[int, int]] = []

        evaluate_positions(
            boards,
            pool_size=4,
            on_progress=lambda done, total: seen.append((done, total)),
        )

        assert seen, "progress must be reported at least once"
        assert seen[-1] == (len(boards), len(boards))
        assert all(total == len(boards) for _, total in seen)

    def test_progress_never_goes_backwards_or_overshoots(self, fake_pool):
        boards, _ = task._replay(moves(LONG_GAME))
        seen: list[int] = []

        evaluate_positions(
            boards, pool_size=4, on_progress=lambda done, total: seen.append(done)
        )

        assert seen == sorted(seen)
        assert max(seen) == len(boards)

    def test_progress_runs_on_the_calling_thread(self, fake_pool):
        """The callback touches a SQLAlchemy session, which is not thread-safe."""
        boards, _ = task._replay(moves(LONG_GAME))
        threads: set[int] = set()

        evaluate_positions(
            boards,
            pool_size=4,
            on_progress=lambda done, total: threads.add(threading.get_ident()),
        )

        assert threads == {threading.get_ident()}


class TestReplay:
    def test_one_checkpoint_per_position(self):
        played = moves(SCHOLARS_MATE)

        boards, contexts = task._replay(played)

        assert len(boards) == len(played) + 1
        assert len(contexts) == len(played)

    def test_checkpoints_are_the_positions_before_and_after_each_ply(self):
        played = moves(SCHOLARS_MATE)

        boards, contexts = task._replay(played)

        for context in contexts:
            assert boards[context.ply - 1].fen() == context.fen_before

    def test_checkpoint_after_a_ply_is_the_position_the_move_leads_to(self):
        """Phase 2 reads `results[ply - 1]` as before and `results[ply]` as after."""
        played = moves(SCHOLARS_MATE)

        boards, contexts = task._replay(played)

        for context, move in zip(contexts, played):
            expected = chess.Board(context.fen_before)
            expected.push(move)
            assert boards[context.ply].board_fen() == expected.board_fen()

    def test_checkpoints_keep_the_full_move_history(self):
        """Stockfish is given the same history it saw when this walked one board."""
        played = moves(SCHOLARS_MATE)

        boards, _ = task._replay(played)

        assert [len(board.move_stack) for board in boards] == list(
            range(len(played) + 1)
        )

    def test_contexts_carry_the_pre_move_facts(self):
        played = moves(SCHOLARS_MATE)

        _, contexts = task._replay(played)

        assert [context.san for context in contexts[:4]] == ["e4", "e5", "Bc4", "Nc6"]
        assert contexts[0].side.value == "white"
        assert contexts[1].side.value == "black"
        assert contexts[0].legal_move_count == 20


class TestCloudEvalSessionThreadSafety:
    """One session is now shared by every worker thread of a job."""

    @pytest.fixture
    def failing(self, monkeypatch):
        """Every lookup is a service failure; returns the list of FENs requested."""
        asked: list[str] = []
        lock = threading.Lock()

        def outcome(fen, multipv=2, timeout=2.0):
            with lock:
                asked.append(fen)
            return CloudEvalOutcome(None, failed=True)

        monkeypatch.setattr(lichess_cloud_eval, "fetch_cloud_eval_outcome", outcome)
        return asked

    def test_concurrent_failures_are_all_counted(self, failing):
        """A lost `+= 1` is exactly what an unlocked counter would produce."""
        # A limit high enough that the breaker never trips, so the counter is
        # free to record every single failure.
        session = CloudEvalSession(failure_limit=10_000, min_interval_s=0.0)
        calls_per_thread = 50
        threads = 8

        with ThreadPoolExecutor(max_workers=threads) as pool:
            futures = [
                pool.submit(
                    lambda: [
                        session.fetch("fen") for _ in range(calls_per_thread)
                    ]
                )
                for _ in range(threads)
            ]
            for future in futures:
                future.result()

        expected = threads * calls_per_thread
        assert len(failing) == expected
        assert session.consecutive_failures == expected

    def test_the_breaker_trips_once_for_the_whole_job(self, failing):
        session = CloudEvalSession(failure_limit=3, min_interval_s=0.0)
        workers = 4

        def hammer():
            return [session.fetch("fen") for _ in range(50)]

        with ThreadPoolExecutor(max_workers=workers) as pool:
            results = [pool.submit(hammer) for _ in range(workers)]
            for future in results:
                assert future.result() == [None] * 50

        assert session.enabled is False
        # Requests already in flight when the breaker trips still land, so the
        # bound is per-job (limit + one wave), never per-thread (limit x N).
        assert len(failing) <= session.failure_limit + workers
        assert len(failing) >= session.failure_limit

    def test_a_tripped_session_stays_tripped_under_load(self, failing):
        session = CloudEvalSession(failure_limit=3, min_interval_s=0.0)
        for _ in range(3):
            session.fetch("fen")
        before = len(failing)

        with ThreadPoolExecutor(max_workers=8) as pool:
            for future in [pool.submit(session.fetch, "fen") for _ in range(80)]:
                assert future.result() is None

        assert len(failing) == before  # not one more round-trip

    def test_a_success_resets_the_counter_under_concurrency(self, monkeypatch):
        """Interleaved successes and failures must not leave a stale count."""
        monkeypatch.setattr(
            lichess_cloud_eval,
            "fetch_cloud_eval_outcome",
            lambda fen, multipv=2, timeout=2.0: CloudEvalOutcome(None, failed=False),
        )
        session = CloudEvalSession(failure_limit=3, min_interval_s=0.0)

        with ThreadPoolExecutor(max_workers=8) as pool:
            for future in [pool.submit(session.fetch, "fen") for _ in range(200)]:
                future.result()

        assert session.consecutive_failures == 0
        assert session.enabled is True

    def test_concurrent_requests_are_still_spaced_out(self, failing):
        """The throttle is per-session, so threads queue rather than burst."""
        interval = 0.01
        calls = 12
        session = CloudEvalSession(failure_limit=10_000, min_interval_s=interval)

        started = time.monotonic()
        with ThreadPoolExecutor(max_workers=4) as pool:
            for future in [pool.submit(session.fetch, "fen") for _ in range(calls)]:
                future.result()
        elapsed = time.monotonic() - started

        assert len(failing) == calls
        # Each request reserves a slot one interval after the previous one, so
        # the last of `calls` requests cannot start before this.
        assert elapsed >= (calls - 1) * interval
