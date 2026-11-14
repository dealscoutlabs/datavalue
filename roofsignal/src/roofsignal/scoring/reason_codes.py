"""Registry of every reason code a score can carry.

`agent_visible=False` codes are internal: they are never shown to call-center agents or used in homeowner-facing
copy (rule: we never imply we "saw damage"; imagery-derived codes are internal only).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ReasonCode:
    code: str
    label: str
    agent_visible: bool = True


_CODES = [
    ReasonCode("STORM_HAIL_12MO", "Hail at or above the threshold size reported at this location in the lookback window"),
    ReasonCode("STORM_WIND_12MO", "Thunderstorm wind at or above the threshold speed reported at this location in the lookback window"),
    ReasonCode("NO_QUALIFYING_STORM", "No qualifying hail or wind report touches this parcel"),
    ReasonCode("ROOF_AGE_FROM_PERMIT", "Roof age estimated from the most recent roofing permit"),
    ReasonCode("ROOF_AGE_FROM_YEAR_BUILT", "Roof age estimated from year built (no roofing permit found; lower confidence)"),
    ReasonCode("ROOF_AGE_UNKNOWN", "No roofing permit and no year built on record"),
    ReasonCode("ROOF_AGE_GE_15Y", "Estimated roof age 15 years or more"),
    ReasonCode("ROOF_AGE_GE_20Y", "Estimated roof age 20 years or more"),
    ReasonCode("ROOF_AGE_GE_25Y", "Estimated roof age 25 years or more"),
    ReasonCode("ROOF_PERMIT_RECENT", "A roofing permit was issued recently; roof likely new"),
    ReasonCode("NO_PERMIT_DATA_JURISDICTION", "No permit data loaded yet for this property's building department"),
    ReasonCode("IMAGERY_POOR_CONDITION", "Licensed imagery provider rates roof condition as poor", agent_visible=False),
    ReasonCode("IMAGERY_FAIR_CONDITION", "Licensed imagery provider rates roof condition as fair", agent_visible=False),
    ReasonCode("IMAGERY_MOCK_EXCLUDED", "Imagery provider is a mock; excluded from the score", agent_visible=False),
    ReasonCode("IMAGERY_UNAVAILABLE", "No imagery result for this parcel", agent_visible=False),
]

REASON_CODES: dict[str, ReasonCode] = {c.code: c for c in _CODES}


def agent_visible(codes: list[str]) -> list[str]:
    return [c for c in codes if REASON_CODES.get(c, ReasonCode(c, c, False)).agent_visible]
