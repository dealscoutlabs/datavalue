"""End-to-end Phase 1 pipeline on PostGIS with fixture data: parcels -> storms/swaths -> permits -> score ->
campaign -> print CSV -> API."""

import csv
import io
import json
from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from roofsignal.adapters.parcels.base import ParcelRecord, ParcelSource
from roofsignal.adapters.storms.base import StormSource
from roofsignal.adapters.storms.noaa_storm_events import parse_row
from roofsignal.adapters.storms.spc_reports import parse_csv
from roofsignal.core.config import load_county, load_scoring
from roofsignal.core.settings import get_settings
from roofsignal.db.models import Campaign, County, IngestionRun, MailPiece, Permit, Property, Score
from roofsignal.ingestion.loaders import load_parcels, load_permits, load_storms
from roofsignal.outreach import tracking
from roofsignal.outreach.campaigns import CSV_COLUMNS, create_campaign, export_csv
from roofsignal.outreach.copy import find_banned
from roofsignal.scoring.run import latest_run, run_scoring
from roofsignal.db.models import StormType

pytestmark = pytest.mark.integration
FIX = Path(__file__).parent.parent / "fixtures"
AS_OF = date(2026, 1, 1)


def square(lon, lat, d=0.0002):
    return {"type": "Polygon", "coordinates": [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]]}


PARCELS = [
    # near the July 2025 Islip hail (1.25") + roof permit 2004 -> A
    ParcelRecord("P1", sbl="0500-001.00-01.00-001.000", town="Islip", municipality="Islip", site_address="10 Main Street",
                 zip="11751", property_class="210", year_built=1960, owner_name="DOE JOHN",
                 owner_mail_address="10 Main St", owner_mail_state="NY", owner_mail_zip="11751",
                 geometry=square(-73.2100, 40.7410)),
    # near the storm, solar permit only (not a roof) -> roof age from year built
    ParcelRecord("P2", sbl="0500-001.00-01.00-002.000", town="Islip", municipality="Islip", site_address="12 Main St",
                 zip="11751", property_class="210", year_built=1990, owner_name="ROE JANE",
                 owner_mail_address="12 Main Street", owner_mail_state="NY", owner_mail_zip="11751",
                 geometry=square(-73.2120, 40.7420)),
    # far from any storm, newer house -> D
    ParcelRecord("P3", sbl="0500-001.00-01.00-004.000", town="Islip", municipality="Islip", site_address="14 Main St",
                 zip="11751", property_class="210", year_built=2018, owner_name="POE AL",
                 owner_mail_address="14 Main St", owner_mail_state="NY", owner_mail_zip="11751",
                 geometry=square(-72.9000, 40.9000)),
    # near the storm, re-roofed 2022 (matched by SBL) -> storm only
    ParcelRecord("P4", sbl="0500-001.00-01.00-003.000", town="Islip", municipality="Islip", site_address="16 Main St",
                 zip="11751", property_class="210", year_built=1955, owner_name="LOE ED",
                 owner_mail_address="16 Main St", owner_mail_state="NY", owner_mail_zip="11751",
                 geometry=square(-73.2110, 40.7400)),
    # near the storm, old, but owned by an LLC that lives elsewhere -> scored but never mailed
    ParcelRecord("P5", sbl="0500-001.00-01.00-005.000", town="Islip", municipality="Islip", site_address="18 Main St",
                 zip="11751", property_class="210", year_built=1950, owner_name="MAIN STREET HOLDINGS LLC",
                 owner_mail_address="1 Wall St", owner_mail_state="NY", owner_mail_zip="10005",
                 geometry=square(-73.2105, 40.7405)),
]

PERMIT_COLS = {"permit_no": "Permit #", "issued_on": "Issue Date", "description": "Work Description",
               "address": "Location", "zip": "Zip", "parcel_id": "SBL"}


class FakeParcels(ParcelSource):
    name = "fixture_parcels"
    source_version = "fixture"

    def iter_parcels(self, *, limit=None):
        yield from PARCELS[:limit] if limit else PARCELS


class FixtureStorms(StormSource):
    name = "fixture_storms"

    def iter_reports(self, start, end, bbox):
        with (FIX / "storm_events_sample.csv").open() as fh:
            for row in csv.DictReader(fh):
                rep = parse_row(row)
                if rep and bbox[0] <= rep.lon <= bbox[2] and bbox[1] <= rep.lat <= bbox[3]:
                    yield rep
        yield from parse_csv((FIX / "spc_wind.csv").read_text(), StormType.wind, date(2025, 7, 14))


@pytest.fixture
def loaded(session):
    cfg = load_county("suffolk_ny")
    load_parcels(session, cfg, FakeParcels())
    load_storms(session, cfg, [FixtureStorms()], date(2025, 1, 1), date(2025, 12, 31))
    load_permits(session, cfg, "Islip", FIX / "permits_islip.csv", PERMIT_COLS)
    return cfg


def scores_by_parcel(session, run):
    rows = session.execute(
        select(Property.parcel_id, Score).join(Score, Score.property_id == Property.id).where(Score.run_id == run.id)
    ).all()
    return {pid: s for pid, s in rows}


def test_parcels_loaded_with_geometry_and_owner_occupancy(session, loaded):
    props = {p.parcel_id: p for p in session.scalars(select(Property))}
    assert len(props) == 5
    assert props["P1"].owner_occupied_guess is True  # "10 Main Street" == "10 Main St"
    assert props["P5"].owner_occupied_guess is False

    assert session.scalar(text("SELECT count(*) FROM property WHERE centroid IS NOT NULL")) == 5
    run = session.scalar(select(IngestionRun).where(IngestionRun.kind == "parcels"))
    assert run.status == "ok" and run.stats["loaded"] == 5


def test_site_zip_falls_back_to_mail_zip_only_when_owner_occupied(session):
    cfg = load_county("suffolk_ny")
    recs = [
        ParcelRecord("Z1", site_address="5 Elm St", zip=None, owner_mail_address="5 Elm Street",
                     owner_mail_zip="11706-1234", geometry=square(-73.3, 40.7)),
        ParcelRecord("Z2", site_address="6 Elm St", zip=None, owner_mail_address="1 Wall St",
                     owner_mail_zip="10005", geometry=square(-73.3, 40.71)),
    ]

    class Src(FakeParcels):
        def iter_parcels(self, *, limit=None):
            yield from recs

    load_parcels(session, cfg, Src())
    zips = dict(session.execute(text("SELECT parcel_id, zip FROM property")).all())
    assert zips == {"Z1": "11706", "Z2": None}

def test_parcel_reload_is_idempotent(session, loaded):
    load_parcels(session, loaded, FakeParcels())
    assert session.scalar(text("SELECT count(*) FROM property")) == 5


def test_storms_filtered_to_bbox_and_swathed(session, loaded):
    rows = session.execute(text("SELECT source, event_type, magnitude, swath IS NOT NULL AS has_swath FROM storm_event")).all()
    # Storm Events: Islip hail + Bay Shore TSTM wind (Texas hail and zone/rain rows excluded); SPC: 2 wind
    assert len(rows) == 4
    assert all(r.has_swath for r in rows)
    radius = session.scalar(text("SELECT swath_radius_m FROM storm_event WHERE event_type='hail'"))
    assert radius == 2000


def test_permits_matched_and_classified(session, loaded):
    permits = {p.permit_no: p for p in session.scalars(select(Permit))}
    assert permits["B-1001"].match_method == "address_zip" and permits["B-1001"].work_category.value == "roof"
    assert permits["B-1002"].work_category.value == "solar"
    assert permits["B-1003"].work_category.value == "hvac"
    assert permits["B-1004"].match_method == "parcel_id" and permits["B-1004"].match_confidence == 1.0
    assert permits["B-1005"].property_id is None  # address not in parcels
    status = session.scalar(text("SELECT permit_data_status FROM jurisdiction WHERE name='Islip'"))
    assert status == "loaded"


def test_scoring_tiers_reasons_and_transparency(session, loaded):
    run = run_scoring(session, loaded, load_scoring(), "roofing", AS_OF)
    s = scores_by_parcel(session, run)

    assert s["P1"].tier == "A"
    assert {"STORM_HAIL_12MO", "ROOF_AGE_FROM_PERMIT", "ROOF_AGE_GE_20Y"} <= set(s["P1"].reason_codes)

    assert "ROOF_AGE_FROM_YEAR_BUILT" in s["P2"].reason_codes  # solar permit doesn't count as a roof

    assert s["P3"].tier == "D" and "NO_QUALIFYING_STORM" in s["P3"].reason_codes

    assert "ROOF_PERMIT_RECENT" in s["P4"].reason_codes and "STORM_HAIL_12MO" in s["P4"].reason_codes
    assert s["P4"].tier == "C"

    # every score carries its components and they add up
    for sc in s.values():
        assert sc.score == pytest.approx(sum(c["points"] for c in sc.components), abs=0.05)
        img = next(c for c in sc.components if c["signal"] == "imagery")
        assert img["is_mock"] and not img["counted"]

    assert run.stats["properties"] == 5
    assert run.config_hash == load_scoring().config_hash()
    assert session.scalar(text("SELECT count(*) FROM signal_result WHERE run_id = :r"), {"r": run.id}) == 15


def test_storm_outside_lookback_does_not_count(session, loaded):
    run = run_scoring(session, loaded, load_scoring(), "roofing", date(2026, 9, 1))  # July 2025 is >12 months back
    s = scores_by_parcel(session, run)
    assert all("STORM_HAIL_12MO" not in sc.reason_codes for sc in s.values())


def test_disabled_trade_refused(session, loaded):
    with pytest.raises(ValueError, match="disabled"):
        run_scoring(session, loaded, load_scoring(), "hvac", AS_OF)


def test_campaign_and_print_csv(session, loaded):
    run = run_scoring(session, loaded, load_scoring(), "roofing", AS_OF)
    county = session.scalar(select(County))
    camp = create_campaign(session, county, run, "islip-test-1", ["A", "B", "C"], limit=10)
    assert camp.tracking_phone_is_mock and camp.tracking_phone.startswith("+1631555")

    data = export_csv(session, camp)
    rows = list(csv.DictReader(io.StringIO(data)))
    assert list(rows[0].keys()) == CSV_COLUMNS
    owners = {r["owner_name"] for r in rows}
    assert "MAIN STREET HOLDINGS LLC" not in owners  # non-household / not owner-occupied
    assert "POE AL" not in owners  # tier D
    for r in rows:
        assert tracking.is_valid(r["tracking_code"])
        assert r["landing_url"].endswith("/r/" + tracking.normalize(r["tracking_code"]))
        assert find_banned(r["trigger_text"]) == []
    p1 = next(r for r in rows if r["owner_name"] == "DOE JOHN")
    assert p1["message_variant"] == "storm" and "July 14, 2025" in p1["trigger_text"]

    # the same homes are not mailed twice for the same trade
    camp2 = create_campaign(session, county, run, "islip-test-2", ["A", "B", "C"], limit=10)
    assert session.scalar(select(MailPiece).where(MailPiece.campaign_id == camp2.id)) is None
    assert session.scalar(text("SELECT count(*) FROM mail_piece WHERE exported_at IS NULL")) == 0


@pytest.fixture
def client(session, loaded, monkeypatch):
    monkeypatch.setenv("ADMIN_API_TOKEN", "test-token")
    get_settings.cache_clear()
    run_scoring(session, loaded, load_scoring(), "roofing", AS_OF)
    session.commit()
    from roofsignal.api.main import app

    return TestClient(app)


AUTH = {"Authorization": "Bearer test-token"}


def test_api_requires_token(client):
    assert client.get("/api/counties").status_code == 401
    assert client.get("/api/counties", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert client.get("/health").json() == {"ok": True}


def test_api_refuses_without_configured_token(client, monkeypatch):
    monkeypatch.setenv("ADMIN_API_TOKEN", "")
    get_settings.cache_clear()
    assert client.get("/api/counties", headers=AUTH).status_code == 503


def test_api_properties_and_detail(client):
    counties = client.get("/api/counties", headers=AUTH).json()
    suffolk = next(c for c in counties if c["key"] == "suffolk_ny")
    assert suffolk["properties"] == 5 and suffolk["latest_run"]["stats"]["properties"] == 5

    res = client.get("/api/counties/suffolk_ny/properties", params={"tier": ["A"]}, headers=AUTH).json()
    assert res["total"] >= 1 and all(i["tier"] == "A" for i in res["items"])
    by_reason = client.get("/api/counties/suffolk_ny/properties", params={"reason": "ROOF_PERMIT_RECENT"},
                           headers=AUTH).json()
    assert [i["parcel_id"] for i in by_reason["items"]] == ["P4"]

    pid = res["items"][0]["id"]
    detail = client.get(f"/api/properties/{pid}", headers=AUTH).json()
    assert detail["score"]["tier"] == "A"
    assert {s["signal"] for s in detail["signals"]} == {"storm", "roof_age", "imagery"}
    assert detail["property"]["geometry"]["type"] == "Polygon"
    assert client.get("/api/properties/00000000-0000-0000-0000-000000000000", headers=AUTH).status_code == 404
    assert client.get("/api/counties/nassau_ny/properties", headers=AUTH).status_code == 404

    codes = client.get("/api/reason-codes", headers=AUTH).json()
    assert codes["IMAGERY_POOR_CONDITION"]["agent_visible"] is False


def test_api_campaign_export(client, session):
    county = session.scalar(select(County))
    run = latest_run(session, county)
    camp = create_campaign(session, county, run, "api-camp", ["A", "B", "C"], limit=5)
    session.commit()
    listing = client.get("/api/campaigns", headers=AUTH).json()
    assert listing[0]["name"] == "api-camp" and listing[0]["pieces"] >= 1
    r = client.get(f"/api/campaigns/{camp.id}/export.csv", headers=AUTH)
    assert r.status_code == 200 and r.text.startswith("tracking_code,")
    assert "attachment" in r.headers["content-disposition"]
