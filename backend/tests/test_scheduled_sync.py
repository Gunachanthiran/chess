"""Tests for the pure, DB-reading half of the scheduled sync task
(`build_sync_jobs`/`_latest_played_at_ms`) - the actual Celery task
(`sync_all_connections`) owns its own session and calls `bulk_import.delay`,
which needs a real broker and would enqueue a real network-calling import;
that part is exercised live instead (same as `bulk_import`'s own task
wrapper - see test_bulk_import.py's own module docstring).

Needs a real, shared database (the `db` fixture from conftest.py, rolled
back after each test) - which means it may already hold real games for
every `GameSource`. Every assertion here is written to hold regardless of
that pre-existing data: test rows use a `played_at`/`created_at` far enough
in the future that they deterministically sort ahead of anything a real
imported game could ever have (games are always imported *after* they were
played), rather than asserting an exact value that pre-existing rows could
also affect.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from app.models.account_connection import AccountConnection
from app.models.analysis_job import JobStatus
from app.models.game import Game, GameSource
from app.tasks.scheduled_sync import _latest_played_at_ms, build_sync_jobs

FAR_FUTURE = datetime(2099, 1, 1, tzinfo=UTC)


def unique_id(prefix: str) -> str:
    return f"{prefix}{uuid.uuid4().hex[:8]}"


def make_game(db, *, source: GameSource, played_at) -> Game:
    game = Game(
        source=source,
        white_name="someone",
        black_name="Opponent",
        result="1-0",
        pgn="1. e4 1-0",
        played_at=played_at,
        chess_com_game_id=unique_id("cc") if source is GameSource.chess_com else None,
        lichess_game_id=unique_id("lc") if source is GameSource.lichess else None,
    )
    db.add(game)
    db.flush()
    return game


class TestLatestPlayedAtMs:
    def test_a_dominant_future_game_wins_regardless_of_other_data(self, db):
        make_game(db, source=GameSource.lichess, played_at=FAR_FUTURE)
        result = _latest_played_at_ms(db, GameSource.lichess)
        assert result == int(FAR_FUTURE.timestamp() * 1000)

    def test_an_even_later_game_wins_over_the_first(self, db):
        make_game(db, source=GameSource.chess_com, played_at=FAR_FUTURE)
        later = FAR_FUTURE + timedelta(days=1)
        make_game(db, source=GameSource.chess_com, played_at=later)

        result = _latest_played_at_ms(db, GameSource.chess_com)
        assert result == int(later.timestamp() * 1000)


class TestBuildSyncJobs:
    def test_one_job_per_connection(self, db):
        connections = [
            AccountConnection(source=GameSource.lichess, username="alice"),
            AccountConnection(source=GameSource.chess_com, username="bob"),
        ]
        jobs = build_sync_jobs(db, connections)
        assert len(jobs) == 2
        assert {job.username for job in jobs} == {"alice", "bob"}

    def test_since_ms_reflects_a_dominant_latest_game(self, db):
        make_game(db, source=GameSource.lichess, played_at=FAR_FUTURE)

        [job] = build_sync_jobs(db, [AccountConnection(source=GameSource.lichess, username="alice")])
        assert job.since_ms == int(FAR_FUTURE.timestamp() * 1000)

    def test_jobs_start_pending_with_zeroed_counters(self, db):
        [job] = build_sync_jobs(db, [AccountConnection(source=GameSource.lichess, username="alice")])
        assert job.status == JobStatus.pending
        assert job.games_found == 0
        assert job.games_imported == 0
        assert job.games_skipped == 0

    def test_empty_connections_list(self, db):
        assert build_sync_jobs(db, []) == []
