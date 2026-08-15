"""The Celery task that runs a game through Stockfish.

The work is split into three phases:

  0. replay the PGN to collect every position that needs an evaluation
     (cheap, no engine involved);
  1. evaluate those positions *in parallel* on a small pool of Stockfish
     processes;
  2. walk the moves in order and turn the evaluations into `MoveAnalysis` rows.

Only phase 2 is order-dependent, and it does no engine I/O, so phase 1 is where
essentially all the wall-clock time goes and is the only phase worth
parallelising.
"""

from __future__ import annotations

import concurrent.futures
import json
import logging
import threading
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

import chess
import redis

from app.celery_app import celery_app
from app.config import settings
from app.db import SessionLocal
from app.errors import EngineError, NotFoundError
from app.models.analysis_job import AnalysisJob, JobStatus
from app.models.game import Game
from app.models.move_analysis import MoveAnalysis, Side
from app.services import accuracy as accuracy_service
from app.services import classification as classification_service
from app.services import openings as openings_service
from app.services import pgn_service
from app.services import position_evaluator
from app.services.engine_pool import StockfishEngine
from app.services.lichess_cloud_eval import CloudEvalSession

logger = logging.getLogger(__name__)

# Rows are buffered and flushed in batches rather than committed per move.
FLUSH_EVERY_PLIES = 10

# Mate scores are folded into a large centipawn value when comparing lines.
MATE_SCORE_CP = 10_000

# How often the main thread wakes up during the parallel phase to publish
# progress. Short enough that the bar moves smoothly, long enough that it costs
# nothing next to a multi-second engine search.
PROGRESS_POLL_INTERVAL_S = 0.5


def _channel(job_id: str) -> str:
    return f"analysis:{job_id}"


def _publish(client: redis.Redis, job_id: str, payload: dict) -> None:
    """Best-effort progress publish; a dead Redis must not fail the analysis."""
    try:
        client.publish(_channel(job_id), json.dumps(payload))
    except Exception:  # noqa: BLE001
        logger.warning("Failed to publish progress for job %s", job_id, exc_info=True)


def _to_cp(cp: int | None, mate: int | None) -> int:
    """Collapse a (cp, mate) pair into a single comparable White-POV number."""
    if mate is not None:
        if mate > 0:
            return MATE_SCORE_CP - mate
        if mate < 0:
            return -MATE_SCORE_CP - mate
        return 0
    return cp if cp is not None else 0


def _mover_pov(value: int, side: Side) -> int:
    return value if side is Side.white else -value


# --- Phase 0: replay the game ----------------------------------------------


@dataclass(frozen=True)
class MoveContext:
    """Everything about one played move that needs no engine to work out."""

    ply: int
    side: Side
    fen_before: str
    san: str
    uci: str
    legal_move_count: int
    board_before: chess.Board


def _replay(moves: Sequence[chess.Move]) -> tuple[list[chess.Board], list[MoveContext]]:
    """Turn a move list into the positions to evaluate and their move context.

    Returns `len(moves) + 1` checkpoint boards - the starting position plus the
    position after each move - and one `MoveContext` per move. Every board keeps
    its full move stack, exactly as the single walking board did before, so
    Stockfish still sees the game history (and therefore repetitions) it saw
    when these positions were evaluated one at a time.
    """
    board = chess.Board()
    checkpoints: list[chess.Board] = [board.copy()]
    contexts: list[MoveContext] = []

    for index, move in enumerate(moves):
        contexts.append(
            MoveContext(
                ply=index + 1,
                side=Side.white if board.turn == chess.WHITE else Side.black,
                fen_before=board.fen(),
                san=board.san(move),
                uci=move.uci(),
                legal_move_count=board.legal_moves.count(),
                board_before=board.copy(stack=False),
            )
        )
        board.push(move)
        checkpoints.append(board.copy())

    return checkpoints, contexts


# --- Phase 1: parallel evaluation ------------------------------------------


def chunk_ranges(total: int, workers: int) -> list[tuple[int, int]]:
    """Split `total` items into at most `workers` contiguous `[start, end)` ranges.

    Sizes differ by at most one, the ranges are disjoint and cover everything,
    and no empty range is ever produced - so more workers than items simply
    means fewer, smaller chunks rather than idle engines being started.
    """
    if total <= 0:
        return []

    count = max(1, min(workers, total))
    base, remainder = divmod(total, count)

    ranges: list[tuple[int, int]] = []
    start = 0
    for index in range(count):
        end = start + base + (1 if index < remainder else 0)
        ranges.append((start, end))
        start = end
    return ranges


def evaluate_positions(
    boards: Sequence[chess.Board],
    cloud_session: CloudEvalSession | None = None,
    on_progress: Callable[[int, int], None] | None = None,
    pool_size: int | None = None,
    threads_per_engine: int | None = None,
) -> list[dict]:
    """Evaluate every board in `boards`, in parallel, returning results in order.

    Each worker thread owns exactly one Stockfish process for the whole of its
    contiguous chunk: the engine is started once and reused, because starting one
    per position would trade the search time we just saved for process-spawn
    overhead. The engines are deliberately configured with fewer search threads
    than a lone engine gets (`ANALYSIS_POOL_THREADS_PER_ENGINE`), since several
    of them now share the machine.

    The GIL is not a factor: `SimpleEngine` drives a subprocess, so a worker
    thread spends its time blocked on a pipe while Stockfish searches in its own
    OS process.

    `on_progress(done, total)` is called from *this* thread (never from a
    worker) roughly every `PROGRESS_POLL_INTERVAL_S`, so a caller can touch a DB
    session from it safely. Any worker exception propagates to the caller,
    exactly as a sequential engine failure would.
    """
    total = len(boards)
    if total == 0:
        return []

    size = pool_size if pool_size is not None else settings.ANALYSIS_POOL_SIZE
    threads = (
        threads_per_engine
        if threads_per_engine is not None
        else settings.ANALYSIS_POOL_THREADS_PER_ENGINE
    )
    ranges = chunk_ranges(total, size)

    # Pre-sized so each worker writes only into its own disjoint index range;
    # distinct indices of a list need no lock, and the ranges never overlap.
    results: list[dict | None] = [None] * total

    done_lock = threading.Lock()
    done_count = 0
    abort = threading.Event()

    def run_chunk(start: int, end: int) -> None:
        nonlocal done_count
        with StockfishEngine(threads=threads) as engine:
            for index in range(start, end):
                if abort.is_set():  # a sibling worker failed; stop early
                    return
                results[index] = position_evaluator.evaluate_position(
                    engine, boards[index], cloud_session=cloud_session
                )
                with done_lock:
                    done_count += 1

    def snapshot() -> int:
        with done_lock:
            return done_count

    with concurrent.futures.ThreadPoolExecutor(max_workers=len(ranges)) as pool:
        pending = {pool.submit(run_chunk, start, end) for start, end in ranges}
        try:
            while pending:
                finished, pending = concurrent.futures.wait(
                    pending, timeout=PROGRESS_POLL_INTERVAL_S
                )
                if on_progress is not None:
                    on_progress(snapshot(), total)
                for future in finished:
                    future.result()  # re-raises EngineError & friends here
        except BaseException:
            # Let the still-running workers finish their current position and
            # bail out, instead of grinding through their whole chunk while the
            # executor's shutdown waits for them.
            abort.set()
            raise

    if any(result is None for result in results):  # pragma: no cover - defensive
        raise EngineError("Parallel analysis did not evaluate every position.")

    if on_progress is not None:
        on_progress(total, total)

    return [result for result in results if result is not None]


@celery_app.task(name="analyze_game")
def analyze_game(job_id: str) -> dict:
    """Analyse every half-move of a game, storing results and live progress."""
    session = SessionLocal()
    redis_client = redis.Redis.from_url(settings.REDIS_URL)
    # One breaker per job, shared by every worker thread in the pool: if Lichess
    # rate-limits us, the first few lookups pay for the discovery and the rest of
    # the game goes straight to local search.
    cloud_session = CloudEvalSession()

    try:
        job = session.get(AnalysisJob, _as_uuid(job_id))
        if job is None:
            raise NotFoundError(f"Analysis job {job_id} not found.")

        game: Game | None = session.get(Game, job.game_id)
        if game is None:
            raise NotFoundError(f"Game {job.game_id} not found.")

        job.status = JobStatus.running
        job.started_at = datetime.now(UTC)
        job.progress_pct = 0
        job.error_message = None
        session.commit()

        _publish(
            redis_client,
            job_id,
            {"job_id": job_id, "status": "running", "progress_pct": 0},
        )

        _, moves = pgn_service.mainline_moves(game.pgn)

        # --- Phase 0: replay the game (no engine, so no reason to parallelise).
        checkpoints, contexts = _replay(moves)

        # --- Phase 1: evaluate every checkpoint position in parallel.
        #
        # Each position is evaluated exactly once and used twice: as the "after"
        # of one ply and the "before" of the next. `evaluate_position` answers
        # from Lichess's cloud cache when it has a deep enough entry (typical for
        # opening theory) and falls back to local Stockfish otherwise.
        def report(done: int, total: int) -> None:
            progress = round(100 * done / total) if total else 100
            if progress == job.progress_pct:
                return
            job.progress_pct = progress
            session.commit()
            _publish(
                redis_client,
                job_id,
                {"job_id": job_id, "status": "running", "progress_pct": progress},
            )

        evaluations = evaluate_positions(
            checkpoints, cloud_session=cloud_session, on_progress=report
        )

        # --- Phase 2: classify and persist, in ply order. No engine I/O left.
        rows: list[MoveAnalysis] = []
        pending: list[MoveAnalysis] = []
        played_sans: list[str] = []

        for context, move in zip(contexts, moves):
            ply = context.ply
            side = context.side
            before = evaluations[ply - 1]
            after = evaluations[ply]

            win_before = accuracy_service.win_percent(before["cp"], before["mate"])
            win_after = accuracy_service.win_percent(after["cp"], after["mate"])
            drop = accuracy_service.win_pct_drop(side, win_before, win_after)

            # Mover-POV numbers for classification.
            best_cp_white = _to_cp(before["cp"], before["mate"])
            after_cp_white = _to_cp(after["cp"], after["mate"])
            cp_loss = _mover_pov(best_cp_white - after_cp_white, side)

            gap = _second_best_gap(before, side)

            played_sans.append(context.san)
            is_book = openings_service.is_book_line(played_sans)

            is_sacrifice = classification_service.is_material_sacrifice(
                context.board_before, move, after["best_move"]
            )

            win_before_mover = win_before if side is Side.white else 100.0 - win_before

            classification = classification_service.classify_move(
                win_pct_drop=drop,
                cp_loss=cp_loss,
                legal_move_count=context.legal_move_count,
                second_best_gap_cp=gap,
                is_book=is_book,
                is_sacrifice=is_sacrifice,
                win_pct_before=win_before_mover,
                ply=ply,
            )

            best_move = before["best_move"]
            row = MoveAnalysis(
                job_id=job.id,
                ply=ply,
                move_number=(ply + 1) // 2,
                side=side,
                fen_before=context.fen_before,
                san=context.san,
                uci=context.uci,
                eval_cp_before=before["cp"],
                eval_cp_after=after["cp"],
                mate_before=before["mate"],
                mate_after=after["mate"],
                best_move_uci=best_move.uci() if best_move is not None else context.uci,
                best_move_eval_cp=before["cp"],
                win_pct_before=win_before,
                win_pct_after=win_after,
                classification=classification,
            )
            rows.append(row)
            pending.append(row)

            if len(pending) >= FLUSH_EVERY_PLIES:
                session.add_all(pending)
                pending = []
                session.commit()

        if pending:
            session.add_all(pending)

        # Rows are already in play order; accuracy needs each side's own POV.
        white_accuracy = accuracy_service.compute_side_accuracy(
            accuracy_service.mover_pov_pairs(
                row for row in rows if row.side is Side.white
            )
        )
        black_accuracy = accuracy_service.compute_side_accuracy(
            accuracy_service.mover_pov_pairs(
                row for row in rows if row.side is Side.black
            )
        )

        job.white_accuracy = white_accuracy
        job.black_accuracy = black_accuracy
        job.status = JobStatus.completed
        job.progress_pct = 100
        job.completed_at = datetime.now(UTC)
        session.commit()

        payload = {
            "job_id": job_id,
            "status": "completed",
            "progress_pct": 100,
            "white_accuracy": white_accuracy,
            "black_accuracy": black_accuracy,
        }
        _publish(redis_client, job_id, payload)
        return payload

    except Exception as exc:  # noqa: BLE001 - job status must always be recorded
        logger.exception("Analysis job %s failed", job_id)
        session.rollback()
        try:
            job = session.get(AnalysisJob, _as_uuid(job_id))
            if job is not None:
                job.status = JobStatus.failed
                job.error_message = str(exc)
                job.completed_at = datetime.now(UTC)
                session.commit()
        except Exception:  # noqa: BLE001
            session.rollback()
            logger.exception("Could not mark job %s as failed", job_id)

        _publish(
            redis_client,
            job_id,
            {"job_id": job_id, "status": "failed", "error": str(exc)},
        )
        raise

    finally:
        session.close()
        try:
            redis_client.close()
        except Exception:  # noqa: BLE001
            pass


def _second_best_gap(analysis: dict, side: Side) -> int | None:
    """Mover-POV centipawn gap between the best and second-best moves."""
    if analysis.get("second_best_cp") is None and analysis.get("second_best_mate") is None:
        return None

    best = _mover_pov(_to_cp(analysis["cp"], analysis["mate"]), side)
    second = _mover_pov(
        _to_cp(analysis["second_best_cp"], analysis["second_best_mate"]), side
    )
    return best - second


def _as_uuid(value: str) -> uuid.UUID:
    return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))
