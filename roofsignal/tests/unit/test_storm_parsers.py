import csv
from datetime import date, datetime, timezone
from pathlib import Path

import pytest

from roofsignal.adapters.storms.base import in_bbox
from roofsignal.adapters.storms.noaa_storm_events import parse_cz_timezone, parse_row
from roofsignal.adapters.storms.spc_reports import parse_csv
from roofsignal.db.models import StormType

FIX = Path(__file__).parent.parent / "fixtures"


def _rows():
    with (FIX / "storm_events_sample.csv").open() as fh:
        return list(csv.DictReader(fh))


def test_storm_events_hail_row():
    rep = parse_row(_rows()[0])
    assert rep.event_type is StormType.hail
    assert rep.magnitude == 1.25
    assert rep.occurred_at == datetime(2025, 7, 14, 21, 30, tzinfo=timezone.utc)  # EST-5 -> UTC
    assert (rep.lat, rep.lon) == (40.74, -73.21)
    assert rep.source_id == "1200001"


def test_storm_events_wind_converts_knots_to_mph_and_keeps_track():
    rep = parse_row(_rows()[1])
    assert rep.event_type is StormType.wind
    assert rep.magnitude == pytest.approx(59.8, abs=0.1)  # 52 kt
    assert (rep.end_lat, rep.end_lon) == (40.74, -73.18)


def test_storm_events_skips_other_types_and_zone_events():
    rows = _rows()
    assert parse_row(rows[2]) is None  # heavy rain
    assert parse_row(rows[3]) is None  # zone-level High Wind: no coordinates, not a TSTM wind type


@pytest.mark.parametrize("label,hours", [("EST-5", -5), ("CST-6", -6), ("MDT-6", -6), ("PST-8", -8), ("AST-4", -4), ("AKST-9", -9), ("HST-10", -10), ("GST10", 10), ("SST-11", -11)])
def test_cz_timezone(label, hours):
    assert parse_cz_timezone(label).utcoffset(None).total_seconds() == hours * 3600


def test_cz_timezone_rejects_garbage():
    with pytest.raises(ValueError):
        parse_cz_timezone("EASTERN")


def test_spc_hail_parse_units_and_day_rollover():
    reps = list(parse_csv((FIX / "spc_hail.csv").read_text(), StormType.hail, date(2025, 7, 14)))
    assert len(reps) == 3  # repeated header line skipped
    assert reps[0].magnitude == 1.0
    assert reps[0].occurred_at == datetime(2025, 7, 14, 19, 30, tzinfo=timezone.utc)
    assert reps[1].magnitude == 1.75
    assert reps[1].occurred_at == datetime(2025, 7, 15, 2, 15, tzinfo=timezone.utc)  # before 12Z = next day
    assert len({r.source_id for r in reps}) == 3


def test_spc_wind_unknown_speed_is_none():
    reps = list(parse_csv((FIX / "spc_wind.csv").read_text(), StormType.wind, date(2025, 7, 14)))
    assert reps[0].magnitude is None
    assert reps[1].magnitude == 61.0


def test_bbox():
    bbox = (-73.5, 40.55, -71.8, 41.32)
    assert in_bbox(-73.21, 40.74, bbox)
    assert not in_bbox(-96.8, 32.8, bbox)


def test_storm_events_bad_time_skipped():
    row = dict(_rows()[0], CZ_TIMEZONE="???")
    assert parse_row(row) is None
