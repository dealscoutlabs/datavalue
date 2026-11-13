"""Rule: never claim or imply we saw damage. Homeowner copy uses neutral triggers only."""

from datetime import date
from pathlib import Path

import pytest

from roofsignal.outreach.copy import GENERIC_TRIGGER, assert_neutral, find_banned, roof_age_trigger, storm_trigger

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize(
    "text",
    [
        "We saw damage on your roof",
        "Our satellite images of your home show wear",
        "We noticed missing shingles",
        "Aerial imagery suggests a problem",
        "Your roof was damaged in the storm",
        "We found hail damage",
        "Damage to your roof was detected",
        "Photos of your roof",
    ],
)
def test_banned_wording_detected(text):
    assert find_banned(text)
    with pytest.raises(ValueError):
        assert_neutral(text)


def test_generated_triggers_are_neutral():
    for t in [
        storm_trigger("hail", date(2025, 7, 14), "Islip"),
        storm_trigger("wind", date(2025, 7, 14), "Bay Shore"),
        roof_age_trigger(22.4, "permit"),
        roof_age_trigger(31, "year_built", 1995),
        roof_age_trigger(31, "year_built"),
        GENERIC_TRIGGER,
    ]:
        assert find_banned(t) == []


def test_roof_age_rounds_down_to_five_year_band():
    assert "20+ years" in roof_age_trigger(24.9, "permit")
    assert "public building permit records" in roof_age_trigger(24.9, "permit")


def test_year_built_is_never_presented_as_roof_age():
    t = roof_age_trigger(86, "year_built", 1940)
    assert "built in 1940" in t and "86" not in t and "roof on this home may be" not in t
    assert "built about 31 years ago" in roof_age_trigger(31, "year_built")


def test_script_talking_points_are_neutral_and_honest():
    from roofsignal.callcenter.script import talking_points

    storm = {"events": [{"type": "hail", "magnitude": 1.75, "date": "2026-04-28"}]}
    pts = talking_points(storm, {"estimated_age_years": 86, "source": "year_built", "year_built": 1940})
    assert pts[0] == "The National Weather Service recorded hail up to 1.75 inch in your area on April 28, 2026."
    assert pts[1] == "Public property records show the home was built in 1940."
    pts = talking_points(None, {"estimated_age_years": 23.2, "source": "permit"})
    assert pts == ["Based on building permit records, the roof may be around 20 or more years old."]
    assert talking_points({"events": [{"type": "wind", "magnitude": 61, "date": "2026-07-05"}]}, None) == [
        "The National Weather Service recorded high winds in your area on July 5, 2026."]
    assert "free roof estimates" in talking_points(None, {"estimated_age_years": 5, "source": "permit"})[0]


def test_storm_trigger_names_public_source_and_date():
    t = storm_trigger("hail", date(2025, 7, 4), "Islip")
    assert "National Weather Service" in t and "July 4, 2025" in t and "hail" in t


def test_homeowner_facing_templates_are_neutral():
    """Mail templates and public (homeowner) web pages. Admin pages and internal config may name signals."""
    paths = list((ROOT / "config" / "templates").rglob("*")) + list((ROOT / "web" / "src" / "app" / "(public)").rglob("*"))
    for p in paths:
        if p.is_file():
            assert find_banned(p.read_text()) == [], p
