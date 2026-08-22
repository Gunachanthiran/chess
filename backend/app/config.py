"""Application settings, loaded from backend/.env via pydantic-settings."""

from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    DATABASE_URL: str = (
        "postgresql+psycopg://chessscope:chessscope@localhost:5432/chessscope"
    )
    REDIS_URL: str = "redis://localhost:6379/0"

    @field_validator("DATABASE_URL")
    @classmethod
    def _normalise_database_url(cls, value: str) -> str:
        """A managed Postgres provider (e.g. Render) hands out a bare
        `postgres://` or `postgresql://` URL, but SQLAlchemy needs the driver
        named explicitly (`postgresql+psycopg://`) to know to use psycopg3
        rather than guessing/failing. Local dev's `.env` already spells this
        out by hand, so this only ever rewrites anything for a deployed
        DATABASE_URL set by the host — it is a no-op otherwise.
        """
        if value.startswith("postgres://"):
            return "postgresql+psycopg://" + value[len("postgres://") :]
        if value.startswith("postgresql://"):
            return "postgresql+psycopg://" + value[len("postgresql://") :]
        return value

    STOCKFISH_PATH: str = "/opt/homebrew/bin/stockfish"
    # Depth is the dominant cost of a full-game analysis: every extra ply of
    # search roughly doubles the work. Measured on this machine, depth 22 cost
    # 5-9s per position (a 40-ply game took ~7 minutes end to end), while 18
    # lands around 1-3s and is still meaningfully deeper than the original 14.
    # `StockfishEngine.analyse` additionally caps wall-clock time per position,
    # so a pathological position cannot blow past that budget.
    STOCKFISH_DEPTH: int = 18

    # Search threads handed to every Stockfish process. Stockfish defaults to 1,
    # which leaves most of a modern machine idle and costs real playing strength:
    # within a fixed wall-clock budget, more threads means more nodes searched
    # and a deeper effective search.
    #
    # Was 6, confirmed via the Celery log as a real cause of a reported slowdown:
    # the worker runs at `--concurrency=2`, and a bot move (a separate uvicorn
    # process) can land at the same time as an analysis job — so the *actual*
    # worst case is up to 3 engines running at once, not 1. At 6 threads each
    # that's 18 threads competing for this machine's 10 cores, and two jobs
    # overlapping at 6 threads apiece was directly observed in the log taking
    # noticeably longer than either would alone. 3 keeps 3 concurrent engines
    # at 9 threads total — under the core count with room to spare — while
    # still being 3x the original single-threaded baseline.
    STOCKFISH_THREADS: int = 3
    # Transposition table size, in MB. Stockfish's 16MB default thrashes almost
    # immediately at the depths used here; a bigger table means fewer positions
    # re-searched from scratch. Sized to stay comfortable alongside the rest of
    # the local stack rather than to claim all available RAM.
    STOCKFISH_HASH_MB: int = 512

    # --- Parallel analysis pool -------------------------------------------
    #
    # One analysis job evaluates `plies + 1` positions, and those evaluations
    # are independent of each other - only the classification pass that follows
    # needs them in order. So a job runs several Stockfish processes at once and
    # splits the positions between them.
    #
    # `python-chess` talks to Stockfish over a subprocess pipe, so the Python
    # threads driving the pool are blocked on I/O, not on the GIL: the search
    # itself happens in separate OS processes. Threads, not processes, are
    # therefore the right tool here.
    #
    # Sizing on this 10-core machine: 4 engines x 2 search threads = 8 threads
    # for one job's pool. That leaves headroom for OS overhead and for a
    # concurrent bot move, which runs its own single engine at
    # STOCKFISH_THREADS (3). The Celery worker runs at --concurrency=1 so two
    # such pools can never overlap; raising either number means revisiting that.
    ANALYSIS_POOL_SIZE: int = 4
    ANALYSIS_POOL_THREADS_PER_ENGINE: int = 2

    # Wall-clock ceiling for a single position's search in the full-game
    # analysis pipeline (`engine_pool.StockfishEngine.analyse`). Whichever
    # bound is hit first — STOCKFISH_DEPTH or this — ends the search, so one
    # pathological position can never run away with an unbounded amount of
    # time. On a CPU-constrained deployment (e.g. Render's free tier, ~0.1
    # CPU) the depth bound can be the one that's *never* reached within the
    # default 8s, silently analysing shallower than STOCKFISH_DEPTH promises
    # — raising this (not depth, and not thread/pool counts, which don't
    # help when the real bottleneck is a fractional CPU allocation) is the
    # actual fix for that, at the cost of a slower job overall.
    ANALYSIS_TIME_LIMIT_S: float = 8.0

    # Wall-clock ceiling for the Grandmaster bot tier's own move search
    # (tal_bot.choose_bot_move) - separate from ANALYSIS_TIME_LIMIT_S above,
    # which bounds the full-game analysis pipeline instead. Repeatedly cut
    # down in the past (20s -> 10s -> 5s -> 2s -> 0.5s) specifically to keep
    # a live Play Bot opponent from feeling like a real wait on a
    # CPU-constrained deployment (e.g. Render's free tier) - but measured
    # directly on this machine, 0.5s only reached depth ~11-12 in a real
    # middlegame, nowhere near GRANDMASTER_SEARCH_DEPTH's 26, silently
    # undermining "unrestricted full-strength Stockfish" for the one tier
    # whose entire premise is being genuinely hard to beat. 8.0 (matching
    # ANALYSIS_TIME_LIMIT_S's own established default above) measured to
    # depth ~20 in the same position - real, substantial strength, not a
    # cosmetic bump. The UI already shows a "bot thinking" state during this
    # wait (PlayBotPage's `botThinking`), so the extra time reads as the bot
    # actually calculating rather than a stall. A CPU-constrained deployment
    # can set this back down via its own `.env` without touching code, same
    # as every other setting on this page.
    GRANDMASTER_TIME_LIMIT_S: float = 8.0

    CORS_ORIGINS: str = "http://localhost:5173"

    LICHESS_API_BASE: str = "https://lichess.org"
    # Lichess answers requests carrying an HTTP-library default User-Agent with
    # a 404 HTML page, so a descriptive one is sent on every request.
    LICHESS_USER_AGENT: str = (
        "ChessScope/1.0 (self-hosted chess analysis; contact: chessscope@localhost)"
    )

    CHESSCOM_API_BASE: str = "https://api.chess.com/pub"
    # Chess.com's public API rejects requests without a descriptive User-Agent
    # with HTTP 403, so this header is sent on every chess.com request.
    CHESSCOM_USER_AGENT: str = (
        "ChessScope/1.0 (self-hosted chess analysis; contact: chessscope@localhost)"
    )

    # --- Login (Lichess OAuth / Chess.com connect) -------------------------
    #
    # Lichess's OAuth2 flow is designed for public clients: it needs no
    # pre-registered client secret, just an identifying `client_id` string and
    # a PKCE challenge (see app/services/lichess_oauth.py). Chess.com has no
    # equivalent third-party login at all — connecting it is username-only,
    # handled entirely in app/routers/auth.py without any settings here.
    LICHESS_OAUTH_CLIENT_ID: str = "chessscope-self-hosted"
    # Used to build the `redirect_uri` Lichess sends the browser back to.
    BACKEND_BASE_URL: str = "http://localhost:8000"
    # Used to build the URL the backend sends the browser to once a login
    # completes (or fails) — a human's browser lands there, not client code.
    FRONTEND_BASE_URL: str = "http://localhost:5173"

    @property
    def cors_origins(self) -> list[str]:
        """CORS_ORIGINS is a comma-separated string in .env."""
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
