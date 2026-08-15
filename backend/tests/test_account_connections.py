"""Tests for the single-user "which accounts are connected" state.

Runs against the real dev Postgres and rolls every change back, the same
pattern `test_bulk_import.py::TestImportDedup` uses. `trigger_bulk_import`
monkeypatches `bulk_import.delay` so these tests only assert the `ImportJob`
row it creates — they do not actually enqueue a Celery task or touch a real
external API.
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
import sqlalchemy as sa

from app.models.game import GameSource
from app.services import account_connections


@pytest.fixture(scope="session")
def db_engine():
    from app.db import engine

    try:
        with engine.connect() as connection:
            connection.execute(sa.text("select 1"))
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"Postgres is not reachable, skipping account connection tests: {exc}")
    return engine


@pytest.fixture
def db(db_engine):
    from sqlalchemy.orm import Session

    from app.models.account_connection import AccountConnection

    connection = db_engine.connect()
    transaction = connection.begin()
    session = Session(
        bind=connection, expire_on_commit=False, join_transaction_mode="create_savepoint"
    )
    try:
        # A real, already-connected dev instance (e.g. from manually testing
        # the login flow in a browser) would otherwise make "a fresh database
        # has no connections" false for reasons that have nothing to do with
        # this test — cleared here, inside the savepoint, so it never touches
        # what's actually committed once `transaction.rollback()` restores it.
        session.query(AccountConnection).delete()
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


def unique_username(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


class TestConnectionStatus:
    def test_a_fresh_database_has_no_connections(self, db):
        assert account_connections.get_status(db) == {}
        assert account_connections.is_any_connected(db) is False

    def test_upsert_creates_a_connection(self, db):
        username = unique_username("alice")
        connection = account_connections.upsert_connection(db, GameSource.lichess, username)

        assert connection.username == username
        assert connection.source == GameSource.lichess
        assert account_connections.is_any_connected(db) is True

    def test_upsert_again_overwrites_rather_than_duplicates(self, db):
        first_username = unique_username("alice")
        second_username = unique_username("alice-renamed")

        account_connections.upsert_connection(db, GameSource.lichess, first_username)
        account_connections.upsert_connection(db, GameSource.lichess, second_username)

        status = account_connections.get_status(db)
        assert len(status) == 1
        assert status[GameSource.lichess].username == second_username

    def test_lichess_and_chess_com_are_independent(self, db):
        lichess_username = unique_username("lc")
        chesscom_username = unique_username("cc")

        account_connections.upsert_connection(db, GameSource.lichess, lichess_username)
        account_connections.upsert_connection(db, GameSource.chess_com, chesscom_username)

        status = account_connections.get_status(db)
        assert status[GameSource.lichess].username == lichess_username
        assert status[GameSource.chess_com].username == chesscom_username

    def test_remove_connection_clears_it(self, db):
        username = unique_username("alice")
        account_connections.upsert_connection(db, GameSource.lichess, username)

        account_connections.remove_connection(db, GameSource.lichess)

        assert account_connections.get_status(db) == {}
        assert account_connections.is_any_connected(db) is False

    def test_removing_a_connection_that_does_not_exist_is_a_no_op(self, db):
        account_connections.remove_connection(db, GameSource.lichess)
        assert account_connections.get_status(db) == {}


class TestTriggerBulkImport:
    def test_creates_a_pending_import_job_with_the_full_cap_by_default(self, db, monkeypatch):
        monkeypatch.setattr(
            account_connections.bulk_import,
            "delay",
            lambda job_id: SimpleNamespace(id="fake-task-id"),
        )

        username = unique_username("alice")
        job = account_connections.trigger_bulk_import(db, GameSource.lichess, username)

        assert job.source == GameSource.lichess
        assert job.username == username
        assert job.max_games == 500  # MAX_GAMES_CEILING
        assert job.celery_task_id == "fake-task-id"

    def test_respects_an_explicit_max_games(self, db, monkeypatch):
        monkeypatch.setattr(
            account_connections.bulk_import,
            "delay",
            lambda job_id: SimpleNamespace(id="fake-task-id"),
        )

        job = account_connections.trigger_bulk_import(
            db, GameSource.chess_com, unique_username("bob"), max_games=25
        )
        assert job.max_games == 25
