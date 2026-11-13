"""Signal functions: each turns raw evidence for one property into a normalized 0..1 value with reason codes.

Pure functions with no I/O, so every branch is unit-tested. The scoring orchestrator (scoring/run.py) gathers the
evidence from the database and calls these.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

from roofsignal.adapters.imagery.base import RoofCondition


@dataclass
class SignalOutput:
    signal: str
    adapter: str
    normalized: float
    value: float | None = None
    confidence: float = 1.0
    reason_codes: list[str] = field(default_factory=list)
    evidence: dict[str, Any] = field(default_factory=dict)
    is_mock: bool = False


def _lerp(x: float, x0: float, x1: float, y0: float, y1: float) -> float:
    if x1 == x0:
        return y1
    t = min(1.0, max(0.0, (x - x0) / (x1 - x0)))
    return y0 + t * (y1 - y0)


def piecewise(x: float, curve: list[list[float]]) -> float:
    """Linear interpolation over [[x, y], ...] points sorted by x; clamps at the ends."""
    pts = sorted(curve)
    if x <= pts[0][0]:
        return float(pts[0][1])
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x <= x1:
            return _lerp(x, x0, x1, y0, y1)
    return float(pts[-1][1])


# --------------------------------------------------------------------------- storm


@dataclass
class StormHit:
    event_type: str  # hail | wind
    magnitude: float | None
    occurred_at: datetime
    source: str
    source_id: str
    location_label: str | None = None


def storm_signal(hits: list[StormHit], params: dict[str, Any]) -> SignalOutput:
    """`hits` are events whose swath touches the parcel inside the lookback window (filtering by date happens in
    SQL). Qualification thresholds are applied here so the thresholds live in scoring.yaml."""
    hail_min = float(params.get("hail_min_in", 1.0))
    hail_full = float(params.get("hail_full_in", 2.0))
    wind_min = float(params.get("wind_min_mph", 58))
    wind_full = float(params.get("wind_full_mph", 80))
    hail_base = float(params.get("hail_base", 0.7))
    wind_base = float(params.get("wind_base", 0.6))

    hail = [h for h in hits if h.event_type == "hail" and h.magnitude is not None and h.magnitude >= hail_min]
    wind = [h for h in hits if h.event_type == "wind" and h.magnitude is not None and h.magnitude >= wind_min]

    hail_n = max((_lerp(h.magnitude, hail_min, hail_full, hail_base, 1.0) for h in hail), default=0.0)
    wind_n = max((_lerp(h.magnitude, wind_min, wind_full, wind_base, 1.0) for h in wind), default=0.0)

    codes: list[str] = []
    if hail:
        codes.append("STORM_HAIL_12MO")
    if wind:
        codes.append("STORM_WIND_12MO")
    if not codes:
        codes.append("NO_QUALIFYING_STORM")

    qualifying = sorted(hail + wind, key=lambda h: h.occurred_at, reverse=True)
    return SignalOutput(
        signal="storm",
        adapter="storm_swaths",
        normalized=round(max(hail_n, wind_n), 4),
        value=max((h.magnitude for h in hail), default=None) if hail else max((h.magnitude for h in wind), default=None),
        reason_codes=codes,
        evidence={
            "max_hail_in": max((h.magnitude for h in hail), default=None),
            "max_wind_mph": max((h.magnitude for h in wind), default=None),
            "events": [
                {
                    "type": h.event_type,
                    "magnitude": h.magnitude,
                    "date": h.occurred_at.date().isoformat(),
                    "source": h.source,
                    "source_id": h.source_id,
                    "location": h.location_label,
                }
                for h in qualifying[:10]
            ],
            "non_qualifying_reports": len(hits) - len(qualifying),
        },
    )


# --------------------------------------------------------------------------- roof age


def roof_age_signal(
    as_of: date,
    last_roof_permit: date | None,
    year_built: int | None,
    jurisdiction_has_permit_data: bool,
    params: dict[str, Any],
) -> SignalOutput:
    curve = params.get("curve", [[0, 0], [10, 0], [15, 0.3], [20, 0.6], [25, 0.85], [30, 1.0]])
    recent_years = float(params.get("recent_permit_years", 5))
    yb_conf = float(params.get("year_built_confidence", 0.7))

    codes: list[str] = []
    if not jurisdiction_has_permit_data:
        codes.append("NO_PERMIT_DATA_JURISDICTION")

    if last_roof_permit is not None:
        age = (as_of - last_roof_permit).days / 365.25
        source, confidence = "permit", 1.0
        codes.insert(0, "ROOF_AGE_FROM_PERMIT")
    elif year_built is not None:
        age = float(as_of.year - year_built)
        source, confidence = "year_built", yb_conf
        codes.insert(0, "ROOF_AGE_FROM_YEAR_BUILT")
    else:
        codes.insert(0, "ROOF_AGE_UNKNOWN")
        return SignalOutput("roof_age", "permits+assessor", 0.0, None, 0.0, codes, {"source": None})

    age = max(0.0, age)
    if source == "permit" and age < recent_years:
        codes.append("ROOF_PERMIT_RECENT")
        normalized = 0.0
    else:
        normalized = piecewise(age, curve)
        for threshold, code in ((25, "ROOF_AGE_GE_25Y"), (20, "ROOF_AGE_GE_20Y"), (15, "ROOF_AGE_GE_15Y")):
            if age >= threshold:
                codes.append(code)
                break

    return SignalOutput(
        signal="roof_age",
        adapter="permits+assessor",
        normalized=round(normalized, 4),
        value=round(age, 1),
        confidence=confidence,
        reason_codes=codes,
        evidence={
            "source": source,
            "estimated_age_years": round(age, 1),
            "last_roof_permit": last_roof_permit.isoformat() if last_roof_permit else None,
            "year_built": year_built,
        },
    )


# --------------------------------------------------------------------------- imagery


def imagery_signal(result: RoofCondition | None, params: dict[str, Any]) -> SignalOutput:
    poor = float(params.get("poor_threshold", 0.7))
    fair = float(params.get("fair_threshold", 0.4))
    if result is None:
        return SignalOutput("imagery", "none", 0.0, None, 0.0, ["IMAGERY_UNAVAILABLE"], {})
    codes = []
    if result.is_mock:
        codes.append("IMAGERY_MOCK_EXCLUDED")
    if result.condition_score >= poor:
        codes.append("IMAGERY_POOR_CONDITION")
    elif result.condition_score >= fair:
        codes.append("IMAGERY_FAIR_CONDITION")
    return SignalOutput(
        signal="imagery",
        adapter=result.provider,
        normalized=round(result.condition_score, 4),
        value=result.condition_score,
        confidence=result.confidence,
        reason_codes=codes,
        evidence={"captured_on": result.captured_on, "provider": result.provider},
        is_mock=result.is_mock,
    )
