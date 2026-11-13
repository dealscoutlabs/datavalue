from datetime import date, datetime, timezone

import pytest

from roofsignal.adapters.imagery.base import MockImageryProvider, RoofCondition
from roofsignal.signals.core import StormHit, imagery_signal, piecewise, roof_age_signal, storm_signal

AS_OF = date(2026, 11, 13)
P = {"hail_min_in": 1.0, "hail_full_in": 2.0, "wind_min_mph": 58, "wind_full_mph": 80, "hail_base": 0.7,
     "wind_base": 0.6}
ROOF = {"curve": [[0, 0], [10, 0], [15, 0.3], [20, 0.6], [25, 0.85], [30, 1.0]], "recent_permit_years": 5,
        "year_built_confidence": 0.7}


def hit(t, mag, day=1):
    return StormHit(t, mag, datetime(2026, 7, day, tzinfo=timezone.utc), "spc_reports", f"id{day}{t}", "Islip")


def test_no_hits():
    out = storm_signal([], P)
    assert out.normalized == 0 and out.reason_codes == ["NO_QUALIFYING_STORM"]


def test_hail_below_threshold_does_not_qualify():
    out = storm_signal([hit("hail", 0.75)], P)
    assert out.normalized == 0
    assert out.reason_codes == ["NO_QUALIFYING_STORM"]
    assert out.evidence["non_qualifying_reports"] == 1


def test_hail_at_threshold_gets_base_and_full_at_two_inches():
    assert storm_signal([hit("hail", 1.0)], P).normalized == pytest.approx(0.7)
    assert storm_signal([hit("hail", 1.5)], P).normalized == pytest.approx(0.85)
    assert storm_signal([hit("hail", 3.0)], P).normalized == pytest.approx(1.0)


def test_wind_threshold_and_unknown_speed():
    assert storm_signal([hit("wind", 57.9)], P).normalized == 0
    assert storm_signal([hit("wind", None)], P).normalized == 0
    out = storm_signal([hit("wind", 58)], P)
    assert out.normalized == pytest.approx(0.6) and out.reason_codes == ["STORM_WIND_12MO"]


def test_both_hail_and_wind_take_max_and_list_both_codes_newest_first():
    out = storm_signal([hit("wind", 80, day=2), hit("hail", 1.0, day=5)], P)
    assert out.normalized == pytest.approx(1.0)
    assert out.reason_codes == ["STORM_HAIL_12MO", "STORM_WIND_12MO"]
    assert out.evidence["events"][0]["date"] == "2026-07-05"
    assert out.value == 1.0  # hail magnitude preferred for value


def test_piecewise_clamps_and_interpolates():
    curve = ROOF["curve"]
    assert piecewise(-5, curve) == 0
    assert piecewise(12.5, curve) == pytest.approx(0.15)
    assert piecewise(40, curve) == 1.0
    assert piecewise(5, [[10, 0.5]]) == 0.5


def test_roof_age_from_permit():
    out = roof_age_signal(AS_OF, date(2001, 1, 1), 1960, True, ROOF)
    assert out.confidence == 1.0
    assert out.reason_codes[0] == "ROOF_AGE_FROM_PERMIT"
    assert "ROOF_AGE_GE_25Y" in out.reason_codes
    assert out.normalized == pytest.approx(0.877, abs=0.01)  # 25.9y on the 25->30 segment


def test_recent_roof_permit_zeroes_signal_even_if_house_is_old():
    out = roof_age_signal(AS_OF, date(2023, 1, 1), 1950, True, ROOF)
    assert out.normalized == 0 and "ROOF_PERMIT_RECENT" in out.reason_codes


def test_roof_age_from_year_built_has_lower_confidence():
    out = roof_age_signal(AS_OF, None, 2004, False, ROOF)
    assert out.reason_codes[0] == "ROOF_AGE_FROM_YEAR_BUILT"
    assert "NO_PERMIT_DATA_JURISDICTION" in out.reason_codes
    assert "ROOF_AGE_GE_20Y" in out.reason_codes
    assert out.confidence == 0.7
    assert out.value == 22.0


@pytest.mark.parametrize("year,code", [(2009, "ROOF_AGE_GE_15Y"), (2015, None)])
def test_roof_age_bands(year, code):
    out = roof_age_signal(AS_OF, None, year, True, ROOF)
    bands = [c for c in out.reason_codes if c.startswith("ROOF_AGE_GE")]
    assert bands == ([code] if code else [])


def test_roof_age_unknown():
    out = roof_age_signal(AS_OF, None, None, True, ROOF)
    assert out.normalized == 0 and out.confidence == 0 and out.reason_codes == ["ROOF_AGE_UNKNOWN"]


def test_future_permit_date_clamped_to_zero_age():
    out = roof_age_signal(AS_OF, date(2027, 1, 1), None, True, ROOF)
    assert out.value == 0.0 and "ROOF_PERMIT_RECENT" in out.reason_codes


def test_imagery_signal_mock_is_flagged():
    cond = MockImageryProvider().roof_condition("P1", -73.2, 40.7)
    out = imagery_signal(cond, {})
    assert out.is_mock and "IMAGERY_MOCK_EXCLUDED" in out.reason_codes
    assert MockImageryProvider().roof_condition("P1", 0, 0) == cond  # deterministic


@pytest.mark.parametrize("score,code", [(0.8, "IMAGERY_POOR_CONDITION"), (0.5, "IMAGERY_FAIR_CONDITION"), (0.1, None)])
def test_imagery_bands(score, code):
    out = imagery_signal(RoofCondition(score, 0.9, "2026-05-01", "licensed", False), {})
    assert out.reason_codes == ([code] if code else [])
    assert not out.is_mock


def test_imagery_missing():
    assert imagery_signal(None, {}).reason_codes == ["IMAGERY_UNAVAILABLE"]
