import pytest

from roofsignal.core.config import load_scoring
from roofsignal.scoring.reason_codes import REASON_CODES, agent_visible
from roofsignal.scoring.scorer import score_property, tier_for
from roofsignal.signals.core import SignalOutput


def cfg(include_mock=False):
    c = load_scoring().trades["roofing"].model_copy(deep=True)
    c.include_mock_signals = include_mock
    return c


def outs(storm=0.0, roof=0.0, roof_conf=1.0, img=0.0, img_mock=True):
    return {
        "storm": SignalOutput("storm", "x", storm, reason_codes=["STORM_HAIL_12MO"] if storm else ["NO_QUALIFYING_STORM"]),
        "roof_age": SignalOutput("roof_age", "x", roof, confidence=roof_conf, reason_codes=["ROOF_AGE_FROM_PERMIT"]),
        "imagery": SignalOutput("imagery", "mock", img, reason_codes=["IMAGERY_MOCK_EXCLUDED"], is_mock=img_mock),
    }


def test_mock_imagery_excluded_and_weights_renormalized():
    r = score_property(outs(storm=1.0, roof=1.0, img=1.0), cfg())
    assert r.score == 100.0 and r.tier == "A"
    img = next(c for c in r.components if c["signal"] == "imagery")
    assert img["counted"] is False and img["points"] == 0


def test_mock_imagery_counts_only_when_opted_in():
    r = score_property(outs(storm=0, roof=0, img=1.0), cfg(include_mock=True))
    assert r.score == pytest.approx(10.0)


def test_real_imagery_counts():
    r = score_property(outs(img=1.0, img_mock=False), cfg())
    assert r.score == pytest.approx(10.0)


def test_storm_only_and_roof_only_land_in_lower_tiers():
    assert score_property(outs(storm=0.7), cfg()).tier == "C"   # 35 points
    assert score_property(outs(roof=1.0), cfg()).tier == "B"    # 50 points
    assert score_property(outs(storm=0.7, roof=0.85), cfg()).tier == "A"  # 35 + 42.5


def test_confidence_scales_points():
    r = score_property(outs(roof=1.0, roof_conf=0.7), cfg())
    assert r.score == pytest.approx(35.0)


def test_components_sorted_and_reason_codes_deduped_in_points_order():
    r = score_property(outs(storm=0.7, roof=1.0), cfg())
    assert [c["signal"] for c in r.components][:2] == ["roof_age", "storm"]
    assert r.reason_codes[:2] == ["ROOF_AGE_FROM_PERMIT", "STORM_HAIL_12MO"]
    assert len(r.reason_codes) == len(set(r.reason_codes))


def test_disabled_signal_not_counted():
    c = cfg()
    c.signals["storm"].enabled = False
    r = score_property(outs(storm=1.0, roof=1.0), c)
    assert r.score == 100.0


def test_no_counted_signals_scores_zero():
    c = cfg()
    for s in c.signals.values():
        s.enabled = False
    assert score_property(outs(storm=1, roof=1), c).score == 0


def test_tier_for_boundaries():
    tiers = {"A": 70, "B": 50, "C": 30}
    assert tier_for(70, tiers) == "A"
    assert tier_for(69.99, tiers) == "B"
    assert tier_for(30, tiers) == "C"
    assert tier_for(29.9, tiers) == "D"


def test_imagery_codes_hidden_from_agents():
    codes = ["STORM_HAIL_12MO", "IMAGERY_POOR_CONDITION", "IMAGERY_MOCK_EXCLUDED", "NOT_A_CODE"]
    assert agent_visible(codes) == ["STORM_HAIL_12MO"]
    assert all(not c.agent_visible for k, c in REASON_CODES.items() if k.startswith("IMAGERY"))


def test_every_code_emitted_by_signals_is_registered():
    import inspect

    import roofsignal.signals.core as core

    src = inspect.getsource(core)
    import re

    emitted = set(re.findall(r'"([A-Z][A-Z0-9_]{5,})"', src))
    assert emitted <= set(REASON_CODES), emitted - set(REASON_CODES)
