import os
import subprocess
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[2]
TEST_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg://roofsignal:roofsignal@localhost:5432/roofsignal_test"
)


@pytest.fixture(scope="session")
def engine():
    eng = create_engine(TEST_URL)
    try:
        with eng.connect() as c:
            c.execute(text("SELECT 1"))
    except Exception as exc:  # pragma: no cover
        pytest.skip(f"PostGIS test database not reachable ({exc}); set TEST_DATABASE_URL")
    subprocess.run(["alembic", "upgrade", "head"], cwd=ROOT, check=True,
                   env={**os.environ, "DATABASE_URL": TEST_URL}, capture_output=True)
    return eng


@pytest.fixture
def session(engine, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", TEST_URL)
    from roofsignal.core.settings import get_settings
    from roofsignal.db.session import get_engine

    get_settings.cache_clear()
    get_engine.cache_clear()
    with engine.begin() as c:
        tables = c.execute(text(
            "SELECT string_agg(quote_ident(tablename), ',') FROM pg_tables WHERE schemaname='public' "
            "AND tablename NOT IN ('alembic_version','spatial_ref_sys')")).scalar()
        c.execute(text(f"TRUNCATE {tables} CASCADE"))
    with Session(engine) as s:
        yield s
    get_settings.cache_clear()
    get_engine.cache_clear()
