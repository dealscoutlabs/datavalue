"""Rules-based permit work-type classifier (no LLM). Order matters: solar-on-roof is not a roof replacement."""

from __future__ import annotations

import re

from roofsignal.db.models import WorkCategory

_RULES: list[tuple[WorkCategory, re.Pattern[str]]] = [
    (WorkCategory.solar, re.compile(r"\b(SOLAR|PHOTOVOLTAIC|PV\s+(SYSTEM|PANEL|ARRAY))\b")),
    (
        WorkCategory.roof,
        re.compile(r"\b(RE-?ROOF(ING)?|ROOF(ING)?|SHINGLES?|STRIP\s+AND\s+RE-?SHINGLE|TEAR[\s-]?OFF)\b"),
    ),
    (
        WorkCategory.hvac,
        re.compile(
            r"\b(HVAC|FURNACE|BOILER|HEAT\s*PUMP|MINI[\s-]?SPLIT|CENTRAL\s+A/?C|AIR\s+CONDITION(ER|ING)|"
            r"A/C\s+UNIT|AC\s+UNIT|CONDENSER|DUCT\s*WORK|DUCTS?)\b"
        ),
    ),
    (WorkCategory.driveway, re.compile(r"\b(DRIVEWAY|CURB\s+CUT|APRON)\b")),
]

# Wording that says the roof was *not* replaced (repairs to other structures mentioning a roof, etc.)
_ROOF_EXCLUSIONS = re.compile(r"\b(ROOF\s+MOUNTED|ROOFTOP\s+(UNIT|RTU)|ROOF\s+DECK|SHED\s+ROOF|GAZEBO|PERGOLA)\b")


def classify(description: str | None) -> WorkCategory:
    if not description:
        return WorkCategory.other
    text = description.upper()
    for category, pattern in _RULES:
        if pattern.search(text):
            if category is WorkCategory.roof and _ROOF_EXCLUSIONS.search(text):
                continue
            return category
    return WorkCategory.other
