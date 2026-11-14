"""Generic CSV/GeoJSON parcel import, e.g. for a FOIL response from a county that does not publish open data.

The county YAML gives a column map from our field names to the file's headers. Geometry is optional
(a CSV with lat/lon columns gives a point; parcels without polygons can still be scored on roof age).
"""

from __future__ import annotations

import csv
from collections.abc import Iterator
from pathlib import Path

from roofsignal.adapters.parcels.base import ParcelRecord, ParcelSource

FIELDS = [
    "parcel_id", "sbl", "swis", "town", "municipality", "site_address", "zip", "property_class", "year_built",
    "owner_name", "owner_mail_address", "owner_mail_city", "owner_mail_state", "owner_mail_zip",
]


class CsvParcels(ParcelSource):
    name = "csv_import"

    def __init__(self, path: str | Path, columns: dict[str, str], lat_col: str | None = None,
                 lon_col: str | None = None, residential_classes: list[str] | None = None) -> None:
        self.path = Path(path)
        self.columns = columns
        self.lat_col, self.lon_col = lat_col, lon_col
        self.residential_classes = set(residential_classes or [])
        self.source_version = self.path.name

    def iter_parcels(self, *, limit: int | None = None) -> Iterator[ParcelRecord]:
        if not self.path.exists():
            raise FileNotFoundError(
                f"Parcel file {self.path} not found. This county has no free parcel feed; "
                "load a FOIL/licensed export here."
            )
        n = 0
        with self.path.open(newline="", encoding="utf-8-sig") as fh:
            for row in csv.DictReader(fh):
                vals = {f: (row.get(self.columns[f]) or "").strip() or None for f in FIELDS if f in self.columns}
                if not vals.get("parcel_id"):
                    continue
                if self.residential_classes and vals.get("property_class") not in self.residential_classes:
                    continue
                geom = None
                if self.lat_col and self.lon_col and row.get(self.lat_col) and row.get(self.lon_col):
                    geom = {"type": "Point", "coordinates": [float(row[self.lon_col]), float(row[self.lat_col])]}
                yb = vals.pop("year_built", None)
                yield ParcelRecord(
                    **vals,
                    year_built=int(yb) if yb and yb.isdigit() and int(yb) > 1700 else None,
                    geometry=geom,
                )
                n += 1
                if limit and n >= limit:
                    return
