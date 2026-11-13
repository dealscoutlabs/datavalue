"""Address normalization used to match permits to parcels. Deliberately simple and deterministic."""

from __future__ import annotations

import re

_SUFFIXES = {
    "STREET": "ST", "STR": "ST", "AVENUE": "AVE", "AV": "AVE", "ROAD": "RD", "DRIVE": "DR", "DRV": "DR",
    "LANE": "LN", "COURT": "CT", "PLACE": "PL", "BOULEVARD": "BLVD", "TERRACE": "TER", "CIRCLE": "CIR",
    "PARKWAY": "PKWY", "HIGHWAY": "HWY", "TURNPIKE": "TPKE", "TPK": "TPKE", "PATH": "PATH", "WAY": "WAY",
    "TRAIL": "TRL", "HOLLOW": "HOLW", "SQUARE": "SQ", "EXTENSION": "EXT", "CRESCENT": "CRES",
}
_DIRECTIONS = {"NORTH": "N", "SOUTH": "S", "EAST": "E", "WEST": "W"}
_UNIT_RE = re.compile(r"\b(APT|UNIT|STE|SUITE|#|FL|FLOOR|RM)\b.*$")


def normalize_address(addr: str | None) -> str | None:
    """'12 North Main Street, Apt 2' -> '12 N MAIN ST'. Returns None when there is nothing usable."""
    if not addr:
        return None
    s = addr.upper()
    s = s.split(",")[0]
    s = re.sub(r"#\s*\w+", "", s)
    s = _UNIT_RE.sub("", s)
    s = re.sub(r"[^A-Z0-9 ]", " ", s)
    tokens = s.split()
    out = []
    for i, tok in enumerate(tokens):
        if tok in _DIRECTIONS and i > 0:  # keep leading number untouched
            tok = _DIRECTIONS[tok]
        elif tok in _SUFFIXES and i == len(tokens) - 1:
            tok = _SUFFIXES[tok]
        out.append(tok)
    # strip leading zeros from house number
    if out and out[0].isdigit():
        out[0] = str(int(out[0]))
    norm = " ".join(out).strip()
    return norm or None
