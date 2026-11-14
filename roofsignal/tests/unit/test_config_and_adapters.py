import json
from pathlib import Path

import httpx
import pytest
import respx

from roofsignal.adapters.parcels.csv_import import CsvParcels
from roofsignal.adapters.parcels.nys_public import DEFAULT_URL, NysPublicParcels, build_where, feature_to_record
from roofsignal.adapters.permits.csv_import import iter_permits, parse_date
from roofsignal.adapters.telephony.base import MockTelephony
from roofsignal.core.config import list_counties, load_county, load_scoring

FIX = Path(__file__).parent.parent / "fixtures"


def test_all_county_configs_load():
    keys = list_counties()
    assert {"suffolk_ny", "nassau_ny"} <= set(keys)
    for k in keys:
        c = load_county(k)
        assert len(c.fips) == 5 and c.bbox[0] < c.bbox[2] and c.bbox[1] < c.bbox[3]


def test_missing_county_config():
    with pytest.raises(FileNotFoundError):
        load_county("atlantis_xx")


def test_scoring_hash_is_stable_and_sensitive():
    a, b = load_scoring(), load_scoring()
    assert a.config_hash() == b.config_hash()
    b.trades["roofing"].signals["storm"].weight = 0.5
    assert a.config_hash() != b.config_hash()


def test_build_where_escapes_quotes():
    w = build_where("Suffolk", ["210"], ["O'Hare"])
    assert "COUNTY_NAME = 'Suffolk'" in w and "'O''Hare'" in w and "PROP_CLASS IN ('210')" in w
    assert build_where("Suffolk", [], None) == "COUNTY_NAME = 'Suffolk'"


def feat(**props):
    base = {"SWIS": "472000", "SBL": "0500001000100003000", "PARCEL_ADDR": " 10 Main St ", "LOC_ZIP": "11751",
            "PROP_CLASS": "210", "YR_BLT": 1962, "PRIMARY_OWNER": "DOE JOHN", "MAIL_ADDR": "10 Main St",
            "MAIL_CITY": "Islip", "MAIL_STATE": "NY", "MAIL_ZIP": "11751", "ROLL_YR": 2025, "CITYTOWN_NAME": "Islip"}
    base.update(props)
    return {"type": "Feature", "properties": base,
            "geometry": {"type": "Polygon", "coordinates": [[[-73.2, 40.7], [-73.2, 40.71], [-73.19, 40.71], [-73.2, 40.7]]]}}


def test_feature_to_record():
    r = feature_to_record(feat())
    assert r.parcel_id == "472000-0500001000100003000"
    assert r.site_address == "10 Main St" and r.year_built == 1962 and r.zip == "11751"
    assert feature_to_record(feat(YR_BLT=0)).year_built is None
    assert feature_to_record(feat(SWIS_SBL_ID="X1")).parcel_id == "X1"
    assert feature_to_record(feat(SWIS=None, SWIS_SBL_ID=None)) is None
    assert feature_to_record(feat(MAIL_ADDR=None, PO_BOX="12")).owner_mail_address == "PO BOX 12"


@respx.mock
def test_nys_adapter_pages_until_short_page():
    pages = [
        {"type": "FeatureCollection", "features": [feat(SBL=f"A{i}") for i in range(2)]},
        {"type": "FeatureCollection", "features": [feat(SBL="A9")]},
    ]
    route = respx.get(f"{DEFAULT_URL}/query").mock(side_effect=[httpx.Response(200, json=p) for p in pages])
    src = NysPublicParcels("Suffolk", ["210"], page_size=2, client=httpx.Client())
    recs = list(src.iter_parcels())
    assert [r.sbl for r in recs] == ["A0", "A1", "A9"]
    assert route.calls[1].request.url.params["resultOffset"] == "2"
    assert src.source_version == "roll_2025"


@respx.mock
def test_nys_adapter_limit_and_count():
    respx.get(f"{DEFAULT_URL}/query").mock(
        side_effect=lambda req: httpx.Response(
            200,
            json={"count": 7} if req.url.params.get("returnCountOnly") else
            {"features": [feat(SBL=f"B{i}") for i in range(int(req.url.params["resultRecordCount"]))]},
        )
    )
    src = NysPublicParcels("Suffolk", ["210"], page_size=2, client=httpx.Client())
    assert len(list(src.iter_parcels(limit=3))) == 3
    assert src.count() == 7


@respx.mock
def test_nys_adapter_surfaces_arcgis_errors(monkeypatch):
    monkeypatch.setattr("roofsignal.adapters.parcels.nys_public.time.sleep", lambda s: None)
    respx.get(f"{DEFAULT_URL}/query").mock(return_value=httpx.Response(200, json={"error": {"code": 500}}))
    with pytest.raises(RuntimeError, match="parcel query failed"):
        list(NysPublicParcels("Suffolk", ["210"], client=httpx.Client()).iter_parcels())


def test_csv_parcels(tmp_path):
    p = tmp_path / "p.csv"
    p.write_text("SBL,ADDR,CLASS,YB,LAT,LON\n1,10 Main St,210,1970,40.7,-73.2\n2,11 Main St,484,1980,,\n3,12 Main,210,abc,,\n")
    src = CsvParcels(p, {"parcel_id": "SBL", "site_address": "ADDR", "property_class": "CLASS", "year_built": "YB"},
                     lat_col="LAT", lon_col="LON", residential_classes=["210"])
    recs = list(src.iter_parcels())
    assert [r.parcel_id for r in recs] == ["1", "3"]
    assert recs[0].geometry == {"type": "Point", "coordinates": [-73.2, 40.7]}
    assert recs[0].year_built == 1970 and recs[1].year_built is None
    assert len(list(src.iter_parcels(limit=1))) == 1


def test_csv_parcels_missing_file(tmp_path):
    with pytest.raises(FileNotFoundError, match="FOIL"):
        list(CsvParcels(tmp_path / "nope.csv", {}).iter_parcels())


def test_permit_csv_and_dates():
    cols = {"permit_no": "Permit #", "issued_on": "Issue Date", "description": "Work Description",
            "address": "Location", "zip": "Zip", "parcel_id": "SBL"}
    recs = list(iter_permits(FIX / "permits_islip.csv", cols))
    assert len(recs) == 5
    assert recs[0].issued_on.isoformat() == "2004-03-15"
    assert recs[3].parcel_id == "0500-001.00-01.00-003.000" and recs[3].address is None
    assert parse_date("bad") is None and parse_date(None) is None
    assert parse_date("03-Jan-2020").isoformat() == "2020-01-03"


def test_mock_telephony_uses_fictional_range():
    t = MockTelephony()
    nums = {t.allocate_tracking_number("631", "x") for _ in range(150)}
    assert all(n.startswith("+1631555") and 100 <= int(n[-4:]) <= 199 for n in nums)
    assert len(nums) == 100
