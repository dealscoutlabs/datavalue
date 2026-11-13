"""US phone number validity and area-code time zones.

Area-code time zones are a SECONDARY signal (numbers port and people move); the recipient's address zone is the
primary one. The gate requires the call time to be allowed in every candidate zone, so an unknown area code is
treated as "any mainland US zone", which is the most restrictive choice.
"""

from __future__ import annotations

import re

E164_US = re.compile(r"^\+1([2-9]\d{2})([2-9]\d{2})(\d{4})$")

TOLL_FREE = {"800", "833", "844", "855", "866", "877", "888"}
PREMIUM = {"900"}

# NANP area codes that are not US states (Canada, Caribbean, US territories): we do not call these.
NON_US_STATES = {
    # Canada
    "204", "226", "236", "249", "250", "257", "263", "289", "306", "343", "354", "365", "367", "368", "382",
    "403", "416", "418", "428", "431", "437", "438", "450", "460", "468", "474", "506", "514", "519", "548",
    "579", "581", "584", "587", "600", "604", "613", "639", "647", "672", "683", "705", "709", "742", "753",
    "778", "780", "782", "807", "819", "825", "867", "873", "879", "902", "905", "942",
    # Caribbean / Atlantic NANP members
    "242", "246", "264", "268", "284", "345", "441", "473", "649", "658", "664", "721", "758", "767", "784",
    "809", "829", "849", "868", "869", "876",
    # US territories (different rules and zones; out of scope)
    "340", "670", "671", "684", "787", "939",
}

ET, CT, MT, PT = "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles"
MAINLAND = (ET, CT, MT, PT)

# Area codes in the pilot markets and their neighbors. Codes spanning two zones list both.
AREA_CODE_TZ: dict[str, tuple[str, ...]] = {
    # New York
    **{ac: (ET,) for ac in ("212", "315", "332", "347", "363", "516", "518", "585", "607", "631", "646", "680",
                             "716", "718", "838", "845", "914", "917", "929", "934")},
    # New Jersey / Connecticut
    **{ac: (ET,) for ac in ("201", "551", "609", "640", "732", "848", "856", "862", "908", "973",
                             "203", "475", "860", "959")},
    # Texas (915 El Paso is Mountain; 432 West Texas spans Central/Mountain)
    **{ac: (CT,) for ac in ("210", "214", "254", "281", "325", "346", "361", "409", "430", "469", "512", "682",
                             "713", "726", "737", "806", "817", "830", "832", "903", "936", "940", "945", "956",
                             "972", "979")},
    "915": (MT,),
    "432": (CT, MT),
    # Florida panhandle 850 spans Eastern/Central
    "850": (ET, CT),
}

# States and the zones they span (for recipients whose exact zone is unknown).
STATE_TZ: dict[str, tuple[str, ...]] = {
    **{s: (ET,) for s in ("CT", "DE", "DC", "GA", "ME", "MD", "MA", "NH", "NJ", "NY", "NC", "OH", "PA", "RI",
                          "SC", "VT", "VA", "WV")},
    **{s: (CT,) for s in ("AL", "AR", "IL", "IA", "LA", "MN", "MS", "MO", "OK", "WI")},
    **{s: (MT,) for s in ("CO", "MT", "NM", "UT", "WY")},
    "AZ": ("America/Phoenix",),
    **{s: (PT,) for s in ("CA", "NV", "WA")},
    "AK": ("America/Anchorage",),
    "HI": ("Pacific/Honolulu",),
    # States split between zones
    "FL": (ET, CT), "IN": (ET, CT), "KY": (ET, CT), "MI": (ET, CT), "TN": (ET, CT),
    "TX": (CT, MT), "KS": (CT, MT), "NE": (CT, MT), "ND": (CT, MT), "SD": (CT, MT),
    "ID": (MT, PT), "OR": (MT, PT),
}


def parse(e164: str) -> tuple[str, str, str] | None:
    m = E164_US.match(e164 or "")
    return m.groups() if m else None


def validity_problem(e164: str) -> str | None:
    """Return a reason code if the number must never be dialed, else None."""
    parts = parse(e164)
    if parts is None:
        return "NUMBER_INVALID_FORMAT"
    area, exchange, line = parts
    if area in TOLL_FREE:
        return "NUMBER_TOLL_FREE"
    if area in PREMIUM or exchange == "976":
        return "NUMBER_PREMIUM"
    if area[1:] == "11" or exchange[1:] == "11":
        return "NUMBER_N11"
    if exchange == "555" and line.startswith("01"):
        return "NUMBER_FICTIONAL_555"
    if area in NON_US_STATES:
        return "NUMBER_NOT_US"
    return None


def area_code_zones(e164: str) -> tuple[str, ...]:
    parts = parse(e164)
    if parts is None:
        return MAINLAND
    return AREA_CODE_TZ.get(parts[0], MAINLAND)
