import pytest
import sqlalchemy as sa

from app.services import engine_pool


@pytest.fixture(scope="session")
def db_engine():
    """Shared across every test needing a real database - moved here from
    test_bulk_import.py (its original, and until now only, user) once
    test_scheduled_sync.py needed the identical fixture rather than a
    second copy of it. Skips - loudly - if Postgres is not reachable."""
    from app.db import engine

    try:
        with engine.connect() as connection:
            connection.execute(sa.text("select 1"))
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"Postgres is not reachable, skipping tests that need it: {exc}")
    return engine


@pytest.fixture
def db(db_engine):
    """A session whose work is rolled back, so the dev database stays clean."""
    from sqlalchemy.orm import Session

    connection = db_engine.connect()
    transaction = connection.begin()
    session = Session(
        bind=connection, expire_on_commit=False, join_transaction_mode="create_savepoint"
    )
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


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
