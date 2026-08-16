"""Stockfish access.

Callers never touch the engine subprocess directly: they go through
`StockfishEngine`, used as a context manager. Swapping this for a real pool of
long-lived engine processes later only requires keeping `analyse()`'s contract.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field

import chess
import chess.engine

from app.config import settings
from app.errors import EngineError

# Terminal positions have no engine score; we synthesise a mate-in-1 style score
# so the sign convention (White POV) still works downstream.
TERMINAL_MATE = 1


# Stockfish's own supported UCI_Elo range (Stockfish 18: min 1320, max 3190).
# Callers may pass anything; values outside the range are clamped, not rejected.
MIN_UCI_ELO = 1320
MAX_UCI_ELO = 3190

# How many ranked candidate moves `analyse()` requests from Stockfish — one
# search covers both classification's `second_best_gap_cp` (needs 2) and the
# "Stockfish recommends" panel (wants a short list, not just one). Kept small:
# each extra line is extra search work inside the same time-bounded budget.
ANALYSIS_MULTIPV = 3

# How many plies of each candidate's principal variation `analyse()` keeps,
# not just its first move — the engine already searches this whole line to
# produce the move's score, so reading further into `info["pv"]` costs
# nothing extra; this only bounds how much of it gets converted to SAN and
# stored.
PV_DISPLAY_PLIES = 10

# Wall-clock ceiling for a single `analyse_candidates` search, so a synchronous
# HTTP request can never stall on the engine.
CANDIDATE_TIME_LIMIT_S = 1.5

# Wall-clock ceiling for a single `analyse` search — see
# `Settings.ANALYSIS_TIME_LIMIT_S` for why this is configurable rather than a
# fixed constant. Depth alone is an unbounded promise: how long depth N takes
# varies by orders of magnitude with the position and the machine, so one
# pathological middlegame position could otherwise dominate a whole game's
# analysis time. Whichever bound is reached first ends the search.

# Search budget for an elo-capped engine.
#
# Measured, not assumed: `UCI_LimitStrength`/`UCI_Elo` only perturb the single
# `bestmove` Stockfish reports from a `go` command. The `info ... multipv` lines
# a `analyse()` call reads are produced by the *full-strength* search and are
# bit-identical at UCI_Elo 1320 and 3190. So a candidate pool taken from an
# "elo-limited" engine is not weakened at all unless the search itself is.
#
# Shrinking the node budget is what actually weakens the pool: fewer nodes means
# genuinely shallower evaluations and a genuinely worse ranking, which is the
# invariant the bot depends on (the aggression bias must never see a stronger
# evaluation than the bot's own capped strength). Doubling roughly every 200
# rating points is the usual shape for this kind of mapping.
NODES_AT_MIN_ELO = 200
ELO_PER_NODE_DOUBLING = 200
MAX_CANDIDATE_NODES = 200_000


def nodes_for_elo(elo: int) -> int:
    """Node budget approximating `elo`'s playing strength. Clamped both ends."""
    clamped = max(MIN_UCI_ELO, min(MAX_UCI_ELO, elo))
    budget = NODES_AT_MIN_ELO * 2 ** ((clamped - MIN_UCI_ELO) / ELO_PER_NODE_DOUBLING)
    return min(MAX_CANDIDATE_NODES, max(NODES_AT_MIN_ELO, round(budget)))


@dataclass
class CandidateMove:
    """One move from a multipv search. `cp`/`mate` are from White's POV."""

    move: chess.Move
    cp: int | None
    mate: int | None

    def as_dict(self) -> dict:
        return {"move": self.move, "cp": self.cp, "mate": self.mate}


@dataclass
class EngineAnalysis:
    """One analysed position. `cp`/`mate` are always from White's POV."""

    cp: int | None
    mate: int | None
    best_move: chess.Move | None
    second_best_cp: int | None = None
    second_best_mate: int | None = None
    # The engine's ranked pool of candidate moves at this position — the
    # "Stockfish recommends" panel's data source. `list[dict]` (not
    # `list[CandidateMove]`) so this is the exact shape both `analyse()` and
    # the Lichess cloud-eval fallback (`lichess_cloud_eval._parse`) produce,
    # letting `position_evaluator.evaluate_position` pass either straight
    # through unchanged. Empty, never `None`, when nothing is available.
    top_moves: list[dict] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "cp": self.cp,
            "mate": self.mate,
            "best_move": self.best_move,
            "second_best_cp": self.second_best_cp,
            "second_best_mate": self.second_best_mate,
            "top_moves": self.top_moves,
        }


# --- Shared, long-lived processes ------------------------------------------
#
# Everything above assumes one `StockfishEngine` = one UCI process, opened and
# quit around a single search. That is the right shape for the analysis
# pipeline (a Celery task that runs many positions back to back inside one
# `with` block), but wrong for the bot: `choose_bot_move` is called once per
# synchronous HTTP request, so "open" meant "spawn a fresh process, do the UCI
# handshake, configure it" on *every single move* - pure fixed overhead paid
# again and again, and the dominant cost of a bot move on a CPU-starved host
# (see tal_bot.GRANDMASTER_TIME_LIMIT_S's history of chasing this exact
# latency by cutting search time, which was never the actual bottleneck).
#
# `reuse_process=True` opts a `StockfishEngine` into a small process cache
# keyed by binary path instead: the same handful of subprocesses persist for
# the life of the app, `configure()` (cheap - just UCI setoption commands, not
# a restart) re-applies elo/threads/hash on every call. Guarded by a lock
# because two bot-move requests racing to spawn the first process must not
# both `popen_uci`, and because the UCI stdin/stdout protocol itself is not
# safe to use from two threads at once.
_shared_process_lock = threading.Lock()
_shared_processes: dict[str, chess.engine.SimpleEngine] = {}


def _shared_process(path: str) -> chess.engine.SimpleEngine:
    with _shared_process_lock:
        engine = _shared_processes.get(path)
        if engine is None:
            try:
                engine = chess.engine.SimpleEngine.popen_uci(path)
            except (OSError, chess.engine.EngineError) as exc:
                raise EngineError(
                    "Could not start Stockfish.", {"path": path, "reason": str(exc)}
                ) from exc
            _shared_processes[path] = engine
        return engine


def shutdown_shared_processes() -> None:
    """Quit every cached shared process. Called from the app's shutdown hook
    so a reload/exit doesn't leave orphaned Stockfish processes behind."""
    with _shared_process_lock:
        for engine in _shared_processes.values():
            try:
                engine.quit()
            except Exception:  # noqa: BLE001 - never mask shutdown on this
                pass
        _shared_processes.clear()


class StockfishEngine:
    """Context manager wrapping a single Stockfish UCI process."""

    def __init__(
        self,
        path: str | None = None,
        depth: int | None = None,
        elo: int | None = None,
        threads: int | None = None,
        hash_mb: int | None = None,
        reuse_process: bool = False,
    ) -> None:
        self.path = path or settings.STOCKFISH_PATH
        self.depth = depth or settings.STOCKFISH_DEPTH
        # Search resources default to the global settings, so every existing
        # caller is unaffected. A caller that runs *several* engines at once
        # (the parallel analysis pool) overrides them, because the budget that
        # is right for one engine on this machine is not right for four.
        self.threads = threads if threads is not None else settings.STOCKFISH_THREADS
        self.hash_mb = hash_mb if hash_mb is not None else settings.STOCKFISH_HASH_MB
        # None means full strength: the engine is left completely unconfigured,
        # which is the behaviour every existing caller relies on.
        self.elo = None if elo is None else max(MIN_UCI_ELO, min(MAX_UCI_ELO, elo))
        # Only an elo-capped engine gets a node budget; full-strength callers
        # keep the unbounded depth-only search they have always had.
        self.nodes = None if self.elo is None else nodes_for_elo(self.elo)
        # See "Shared, long-lived processes" above - the bot sets this, the
        # analysis pipeline never does.
        self.reuse_process = reuse_process
        self._engine: chess.engine.SimpleEngine | None = None

    # --- lifecycle ---------------------------------------------------------

    def open(self) -> "StockfishEngine":
        if self._engine is None:
            if self.reuse_process:
                self._engine = _shared_process(self.path)
            else:
                try:
                    self._engine = chess.engine.SimpleEngine.popen_uci(self.path)
                except (OSError, chess.engine.EngineError) as exc:
                    raise EngineError(
                        "Could not start Stockfish.",
                        {"path": self.path, "reason": str(exc)},
                    ) from exc

            # Resource configuration, applied to *every* engine instance: the
            # bot's, the analysis pipeline's, elo-capped and full-strength
            # alike. Stockfish's own defaults (1 thread, 16MB hash) leave most
            # of the machine idle, so this is free strength within the same
            # wall-clock budget.
            #
            # This is deliberately independent of the node budget below.
            # `nodes_for_elo` bounds how many nodes an elo-capped search may
            # visit; threads and hash only change how *fast* those nodes are
            # produced and how much of the tree is remembered. A node-limited
            # search still stops at the same node count, so the capped tiers
            # stay exactly as strong as before - they just reach their budget
            # sooner. The measured finding that `UCI_LimitStrength` alone does
            # not weaken the multipv pool is likewise untouched: it is a
            # property of how Stockfish applies the strength limit (to the
            # reported `bestmove` only), not of its search resources.
            try:
                self._engine.configure(
                    {"Threads": self.threads, "Hash": self.hash_mb}
                )
            except (chess.engine.EngineError, ValueError) as exc:
                self.close()
                raise EngineError(
                    "Could not configure Stockfish search resources.",
                    {
                        "path": self.path,
                        "threads": self.threads,
                        "hash_mb": self.hash_mb,
                        "reason": str(exc),
                    },
                ) from exc

            if self.elo is not None:
                try:
                    self._engine.configure(
                        {"UCI_LimitStrength": True, "UCI_Elo": self.elo}
                    )
                except (chess.engine.EngineError, ValueError) as exc:
                    self.close()
                    raise EngineError(
                        "Could not limit Stockfish strength.",
                        {"path": self.path, "elo": self.elo, "reason": str(exc)},
                    ) from exc
            elif self.reuse_process:
                # A shared process may carry an elo cap left behind by a
                # *previous* caller (a different game's practice-tier move,
                # say) - a freshly spawned process never needs this since it
                # starts with UCI_LimitStrength already off, but a reused one
                # must be told explicitly or a later Grandmaster-tier request
                # would silently inherit someone else's strength cap.
                try:
                    self._engine.configure({"UCI_LimitStrength": False})
                except (chess.engine.EngineError, ValueError) as exc:
                    self.close()
                    raise EngineError(
                        "Could not reset Stockfish strength limit.",
                        {"path": self.path, "reason": str(exc)},
                    ) from exc
        return self

    def close(self) -> None:
        if self._engine is not None:
            if self.reuse_process:
                # The process itself outlives this wrapper - see "Shared,
                # long-lived processes" above - so closing just detaches this
                # instance from it rather than quitting it out from under
                # whichever caller uses it next.
                self._engine = None
                return
            try:
                self._engine.quit()
            except Exception:  # noqa: BLE001 - never mask the original error
                pass
            finally:
                self._engine = None

    def __enter__(self) -> "StockfishEngine":
        return self.open()

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    # --- analysis ----------------------------------------------------------

    def analyse(self, board: chess.Board, depth: int | None = None) -> dict:
        """Analyse `board`, returning cp/mate/best_move, the 2nd-best score, and
        a ranked pool of the top `ANALYSIS_MULTIPV` candidate moves.

        Every line comes from the one `multipv=ANALYSIS_MULTIPV` search, so a
        position is only ever handed to the engine once — the "Stockfish
        recommends" panel's data costs nothing beyond what this call already
        did for classification's `second_best_gap_cp`.

        The search is bounded by depth *and* by
        `settings.ANALYSIS_TIME_LIMIT_S`; whichever is hit first ends it, so no
        single position can run away with an unbounded amount of wall-clock
        time. Asking for one more PV line than before (3 instead of 2) spends
        that same time budget across more root moves, so a time-bounded search
        settles at a marginally shallower effective depth than it used to —
        an acceptable trade for what was otherwise a second engine call away.
        """
        if board.is_game_over(claim_draw=False):
            return self._terminal_analysis(board).as_dict()

        if self._engine is None:
            raise EngineError("Stockfish engine is not running.", {"path": self.path})

        limit = chess.engine.Limit(
            depth=depth or self.depth, time=settings.ANALYSIS_TIME_LIMIT_S
        )
        try:
            infos = self._engine.analyse(board, limit, multipv=ANALYSIS_MULTIPV)
        except chess.engine.EngineError as exc:
            raise EngineError(
                "Stockfish failed to analyse a position.",
                {"fen": board.fen(), "reason": str(exc)},
            ) from exc

        if isinstance(infos, dict):  # multipv unsupported -> single info dict
            infos = [infos]
        if not infos:
            raise EngineError("Stockfish returned no analysis.", {"fen": board.fen()})

        best_cp, best_mate = _score_to_white_pov(infos[0])
        best_move = _first_pv_move(infos[0])

        second_cp: int | None = None
        second_mate: int | None = None
        if len(infos) > 1:
            second_cp, second_mate = _score_to_white_pov(infos[1])

        top_moves: list[dict] = []
        for info in infos:
            sans = _pv_to_sans(board, info.get("pv"), PV_DISPLAY_PLIES)
            if not sans:
                continue
            cp, mate = _score_to_white_pov(info)
            top_moves.append({"sans": sans, "cp": cp, "mate": mate})

        return EngineAnalysis(
            cp=best_cp,
            mate=best_mate,
            best_move=best_move,
            second_best_cp=second_cp,
            second_best_mate=second_mate,
            top_moves=top_moves,
        ).as_dict()

    def analyse_candidates(
        self,
        board: chess.Board,
        depth: int | None = None,
        multipv: int = 5,
        time_limit: float | None = None,
    ) -> list[CandidateMove]:
        """Return the engine's top `multipv` moves, best first.

        Same search machinery as `analyse()`, but the whole ranked pool is
        returned instead of collapsing it to best + second-best. Scores are
        White-POV, exactly as in `analyse()`.

        On an elo-capped engine the search is additionally bounded by
        `nodes_for_elo` - see that function for why the UCI options alone are
        not enough. Depth and wall-clock bounds always apply so a synchronous
        HTTP request can never stall here.

        `time_limit` overrides `CANDIDATE_TIME_LIMIT_S` for this one call. The
        default is tuned for the elo-capped bot tiers, where a deep search would
        be wasted anyway; a full-strength caller that asks for real depth needs a
        longer leash or the wall-clock bound, not the depth, decides the search.

        A terminal position has no candidates, so an empty list is returned
        (mirroring how `analyse()` short-circuits before touching the engine).
        """
        if board.is_game_over(claim_draw=False):
            return []

        if self._engine is None:
            raise EngineError("Stockfish engine is not running.", {"path": self.path})

        limit = chess.engine.Limit(
            depth=depth or self.depth,
            time=time_limit or CANDIDATE_TIME_LIMIT_S,
            nodes=self.nodes,
        )
        try:
            infos = self._engine.analyse(board, limit, multipv=multipv)
        except chess.engine.EngineError as exc:
            raise EngineError(
                "Stockfish failed to analyse a position.",
                {"fen": board.fen(), "reason": str(exc)},
            ) from exc

        if isinstance(infos, dict):  # multipv unsupported -> single info dict
            infos = [infos]

        candidates: list[CandidateMove] = []
        for info in infos:
            move = _first_pv_move(info)
            if move is None:  # no principal variation -> nothing playable here
                continue
            cp, mate = _score_to_white_pov(info)
            candidates.append(CandidateMove(move=move, cp=cp, mate=mate))
        return candidates

    def _terminal_analysis(self, board: chess.Board) -> EngineAnalysis:
        if board.is_checkmate():
            # Side to move is mated: White POV is -1 if White is mated, else +1.
            mate = -TERMINAL_MATE if board.turn == chess.WHITE else TERMINAL_MATE
            return EngineAnalysis(cp=None, mate=mate, best_move=None)
        return EngineAnalysis(cp=0, mate=None, best_move=None)


def _score_to_white_pov(info: dict) -> tuple[int | None, int | None]:
    score = info.get("score")
    if score is None:
        return None, None
    white_score = score.pov(chess.WHITE)
    return white_score.score(), white_score.mate()


def _first_pv_move(info: dict) -> chess.Move | None:
    pv = info.get("pv")
    if pv:
        return pv[0]
    return None


def _pv_to_sans(board: chess.Board, pv: list[chess.Move] | None, limit: int) -> list[str]:
    """The first `limit` moves of `pv`, as SAN, replayed on a scratch copy of
    `board` — never the board `analyse()` was actually called with. `is_legal`
    is a defensive check, not an expected failure: a `pv` straight from the
    engine's own search is legal by construction, but stopping at the first
    move that somehow isn't is safer than a SAN conversion raising mid-line."""
    if not pv:
        return []
    sans: list[str] = []
    working = board.copy(stack=False)
    for move in pv[:limit]:
        if not working.is_legal(move):
            break
        sans.append(working.san(move))
        working.push(move)
    return sans
