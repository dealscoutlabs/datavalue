from datetime import date

import pytest
from typer.testing import CliRunner

from roofsignal.cli import app
from roofsignal.core.config import load_county
from roofsignal.ingestion.loaders import load_parcels, load_storms

from .test_pipeline import FakeParcels, FixtureStorms, FIX, PERMIT_COLS

pytestmark = pytest.mark.integration
runner = CliRunner()


def test_cli_end_to_end(session, tmp_path):
    cfg = load_county("suffolk_ny")
    load_parcels(session, cfg, FakeParcels())
    load_storms(session, cfg, [FixtureStorms()], date(2025, 1, 1), date(2025, 12, 31))
    session.commit()

    r = runner.invoke(app, ["counties"])
    assert r.exit_code == 0 and "suffolk_ny" in r.stdout and "csv_import" in r.stdout

    import json

    r = runner.invoke(app, ["permits", "load", "suffolk_ny", "--jurisdiction", "Islip", "--file",
                            str(FIX / "permits_islip.csv"), "--columns", json.dumps(PERMIT_COLS)])
    assert r.exit_code == 0, r.stdout
    assert json.loads(r.stdout)["matched"] == 4

    r = runner.invoke(app, ["mail", "create", "suffolk_ny", "--name", "x"])
    assert r.exit_code != 0  # no scoring run yet

    r = runner.invoke(app, ["score", "suffolk_ny", "--as-of", "2026-01-01"])
    assert r.exit_code == 0, r.stdout
    assert json.loads(r.stdout)["properties"] == 5

    out = tmp_path / "mail.csv"
    r = runner.invoke(app, ["mail", "create", "suffolk_ny", "--name", "cli-camp", "--tiers", "A,B,C",
                            "--out", str(out)])
    assert r.exit_code == 0, r.stdout
    assert out.read_text().startswith("tracking_code,")

    r = runner.invoke(app, ["status", "suffolk_ny"])
    assert r.exit_code == 0 and json.loads(r.stdout)["properties"] == 5

    r = runner.invoke(app, ["status", "nassau_ny"])
    assert "nothing loaded" in r.stdout


def test_cli_spend(session):
    import json

    r = runner.invoke(app, ["spend", "status"])
    assert json.loads(r.stdout)["spent_usd"] == "0"
    r = runner.invoke(app, ["spend", "approve", "--to", "10", "--by", "owner"])
    assert r.exit_code != 0  # more than one $5 step
    r = runner.invoke(app, ["spend", "approve", "--to", "5", "--by", "owner"])
    assert r.exit_code == 0
    assert json.loads(runner.invoke(app, ["spend", "status"]).stdout)["approved_through_usd"] == "5.0000"
