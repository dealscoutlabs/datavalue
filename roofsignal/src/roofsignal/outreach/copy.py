"""Homeowner-facing trigger text for mail pieces.

RULE: never claim or imply that we saw, detected or found damage. Only neutral, verifiable triggers are allowed:
a storm reported in the area (with its public source), or roof age estimated from public records. Imagery results
are never used in homeowner copy. tests/unit/test_copy_rules.py fails the build if banned wording appears in any
template or in generated text.
"""

from __future__ import annotations

import re
from datetime import date

BANNED_PATTERNS = [
    r"\bsaw\b", r"\bseen\b", r"\bnoticed\b", r"\bspotted\b", r"\bobserved\b", r"\bdetected\b", r"\bidentified\b",
    r"\bdamage(d)?\s+(to|on)\s+your\b", r"\byour\s+roof\s+(is|was|has\s+been)\s+damaged\b", r"\bsatellite\b",
    r"\baerial\b", r"\bimagery\b", r"\bimage(s)?\s+of\s+your\b", r"\bphoto(s)?\s+of\s+your\b", r"\binspected\b",
    r"\bwe\s+found\b", r"\bour\s+(scan|analysis)\b",
]
_BANNED_RE = re.compile("|".join(BANNED_PATTERNS), re.IGNORECASE)


def find_banned(text: str) -> list[str]:
    return [m.group(0) for m in _BANNED_RE.finditer(text)]


def assert_neutral(text: str) -> str:
    hits = find_banned(text)
    if hits:
        raise ValueError(f"Homeowner copy contains banned wording {hits}: {text!r}")
    return text


def _month_day_year(d: date) -> str:
    return f"{d:%B} {d.day}, {d.year}"


def storm_trigger(event_type: str, event_date: date, area_label: str) -> str:
    kind = "hail" if event_type == "hail" else "high winds"
    return assert_neutral(
        f"The National Weather Service recorded a storm with {kind} near {area_label} on {_month_day_year(event_date)}. "
        "Storms like this are a common reason homeowners have their roof checked."
    )


def roof_age_trigger(age_years: float, source: str) -> str:
    years = int(age_years // 5 * 5)  # round down to a 5-year band; never overstate precision
    basis = "public building permit records" if source == "permit" else "public property records"
    return assert_neutral(
        f"Based on {basis}, the roof on this home may be {years}+ years old. "
        "Most asphalt roofs are designed to last about 20 to 25 years."
    )


GENERIC_TRIGGER = assert_neutral("Homeowners in your area are getting free roof estimates from licensed local contractors.")
