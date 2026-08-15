"""Tests for Settings' DATABASE_URL normalisation.

A managed Postgres provider (Render, in particular) hands out a bare
`postgres://`/`postgresql://` URL; SQLAlchemy needs the driver named
explicitly to use psycopg3 here. Getting this wrong doesn't fail until the
app tries to actually connect, so it's worth pinning down directly rather
than only finding out against a real deployment.
"""

from app.config import Settings


class TestDatabaseUrlNormalisation:
    def test_leaves_a_url_with_a_driver_already_named_untouched(self):
        settings = Settings(DATABASE_URL="postgresql+psycopg://u:p@host/db")
        assert settings.DATABASE_URL == "postgresql+psycopg://u:p@host/db"

    def test_rewrites_bare_postgres_scheme(self):
        settings = Settings(DATABASE_URL="postgres://u:p@host/db")
        assert settings.DATABASE_URL == "postgresql+psycopg://u:p@host/db"

    def test_rewrites_bare_postgresql_scheme(self):
        settings = Settings(DATABASE_URL="postgresql://u:p@host/db")
        assert settings.DATABASE_URL == "postgresql+psycopg://u:p@host/db"

    def test_leaves_other_drivers_untouched(self):
        settings = Settings(DATABASE_URL="postgresql+asyncpg://u:p@host/db")
        assert settings.DATABASE_URL == "postgresql+asyncpg://u:p@host/db"
