import hashlib
from datetime import time

import pytest

from roofsignal.compliance import numbers
from roofsignal.compliance.rules import Window, load_rules

from .fakes import ROOT, RULES


def test_rules_load_and_disclosure_hash_matches_file():
    text = (ROOT / "config" / "disclosures" / "consent_v1.txt").read_text()
    assert RULES.accepted_disclosures["consent_v1"] == hashlib.sha256(text.encode()).hexdigest()
    assert RULES.federal_window == Window(time(8), time(21))
    assert RULES.state("fl").window == Window(time(8), time(20))
    assert RULES.state("TX").sunday_window == Window(time(12), time(21))
    assert RULES.state(None).window is None and RULES.state("ZZ").state_dnc_list is False
    assert RULES.national_dnc_max_age_days == 31
    assert "pewc" in RULES.wireless_kinds and "callback_request" not in RULES.wireless_kinds


def test_rules_hash_changes_when_disclosure_text_changes(tmp_path):
    (tmp_path / "compliance").mkdir()
    (tmp_path / "disclosures").mkdir()
    src = (ROOT / "config" / "compliance" / "rules.yaml").read_text()
    (tmp_path / "compliance" / "rules.yaml").write_text(src)
    (tmp_path / "disclosures" / "consent_v1.txt").write_text("version A")
    a = load_rules(tmp_path / "compliance" / "rules.yaml")
    (tmp_path / "disclosures" / "consent_v1.txt").write_text("version B")
    b = load_rules(tmp_path / "compliance" / "rules.yaml")
    assert a.hash != b.hash and a.accepted_disclosures != b.accepted_disclosures


def test_every_state_rule_is_marked_for_legal_review():
    import yaml

    raw = yaml.safe_load((ROOT / "config" / "compliance" / "rules.yaml").read_text())
    for code, rule in raw["states"].items():
        assert rule.get("legal_review") in ("pending", "confirmed"), code


def test_window_end_is_exclusive():
    w = Window(time(8), time(21))
    assert w.contains(time(8)) and w.contains(time(20, 59, 59)) and not w.contains(time(21))


@pytest.mark.parametrize("e164,zones", [("+16315551234", ("America/New_York",)),
                                        ("+19155551234", ("America/Denver",)),
                                        ("garbage", numbers.MAINLAND)])
def test_area_code_zones(e164, zones):
    assert numbers.area_code_zones(e164) == zones


def test_every_state_zone_is_valid():
    from zoneinfo import ZoneInfo

    for zones in list(numbers.STATE_TZ.values()) + list(numbers.AREA_CODE_TZ.values()):
        for z in zones:
            ZoneInfo(z)
    assert len(numbers.STATE_TZ) == 51
