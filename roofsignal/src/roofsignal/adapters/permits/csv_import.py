"""Permit CSV import: the format we expect from FOIL responses and building-department portal exports.

Each NY town/village issues its own permits, so a county config lists jurisdictions and each file is loaded
against one jurisdiction with a column map, e.g.
    {"permit_no": "Permit #", "issued_on": "Issue Date", "description": "Work Description",
     "address": "Location", "zip": "Zip", "parcel_id": "SBL"}
"""

from __future__ import annotations

import csv
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

_DATE_FORMATS = ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%Y/%m/%d", "%d-%b-%Y", "%m-%d-%Y")


@dataclass
class PermitRecord:
    permit_no: str
    issued_on: date | None
    description: str | None
    address: str | None
    zip: str | None
    parcel_id: str | None


def parse_date(value: str | None) -> date | None:
    if not value:
        return None
    value = value.strip().split(" ")[0]
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    return None


def iter_permits(path: str | Path, columns: dict[str, str]) -> Iterator[PermitRecord]:
    def get(row: dict, key: str) -> str | None:
        col = columns.get(key)
        v = (row.get(col) or "").strip() if col else ""
        return v or None

    with Path(path).open(newline="", encoding="utf-8-sig") as fh:
        for row in csv.DictReader(fh):
            permit_no = get(row, "permit_no")
            if not permit_no:
                continue
            z = get(row, "zip")
            yield PermitRecord(
                permit_no=permit_no,
                issued_on=parse_date(get(row, "issued_on")),
                description=get(row, "description"),
                address=get(row, "address"),
                zip=z[:5] if z else None,
                parcel_id=get(row, "parcel_id"),
            )
