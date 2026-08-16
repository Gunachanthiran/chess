import pytest

from app.services import engine_pool


@pytest.fixture(scope="session", autouse=True)
def _shutdown_shared_stockfish_processes():
    """`engine_pool`'s bot-reuse path (`reuse_process=True`) keeps a Stockfish
    process - and the background thread `chess.engine.SimpleEngine` runs it
    on - alive past any single test, by design (see engine_pool.py). Without
    this, that thread is still alive when the session ends and pytest's own
    process never exits, since a non-daemon thread blocks interpreter
    shutdown. Production has the same cleanup via `main.py`'s FastAPI
    shutdown hook; tests need their own since there's no app lifecycle here.
    """
    yield
    engine_pool.shutdown_shared_processes()
