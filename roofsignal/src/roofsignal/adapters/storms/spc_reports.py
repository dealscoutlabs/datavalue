"""NOAA Storm Prediction Center daily storm reports (free, preliminary, available next day).

Files: https://www.spc.noaa.gov/climo/reports/YYMMDD_rpts_filtered_{hail,wind}.csv
A report day runs 12Z to 12Z, so a time before 1200 UTC belongs to the next calendar day.
Hail size is in hundredths of an inch (100 = 1.00"); wind speed is in mph or 'UNK'.
"""

from __future__ import annotations

import csv
import io
from collections.abc import Iterator
from datetime import date, datetime, timedelta, timezone

import httpx

from roofsignal.adapters.storms.base import BBox, StormReport, StormSource, in_bbox
from roofsignal.core.http import cached_get, make_client
from roofsignal.db.models import StormType

BASE_URL = "https://www.spc.noaa.gov/climo/reports/"


def parse_csv(text: str, kind: StormType, report_day: date) -> Iterator[StormReport]:
    for i, row in enumerate(csv.DictReader(io.StringIO(text))):
        try:
            hhmm = int(row["Time"])
            lat, lon = float(row["Lat"]), float(row["Lon"])
        except (KeyError, ValueError, TypeError):
            continue  # SPC sometimes repeats header lines mid-file
        day = report_day + timedelta(days=1) if hhmm < 1200 else report_day
        occurred = datetime(day.year, day.month, day.day, hhmm // 100, hhmm % 100, tzinfo=timezone.utc)
        raw_mag = (row.get("Size") if kind is StormType.hail else row.get("Speed")) or ""
        try:
            mag = float(raw_mag)
            magnitude = mag / 100.0 if kind is StormType.hail else mag
        except ValueError:
            magnitude = None  # 'UNK' wind speeds are kept but never qualify on magnitude
        yield StormReport(
            source="spc_reports",
            source_id=f"{report_day:%y%m%d}-{kind.value}-{i}-{hhmm:04d}-{lat:.2f}-{lon:.2f}",
            event_type=kind,
            magnitude=magnitude,
            occurred_at=occurred,
            lon=lon,
            lat=lat,
            location_label=f"{row.get('Location', '').title()}, {row.get('County', '').title()} {row.get('State', '')}",
            raw={"comments": row.get("Comments")},
        )


class SpcReports(StormSource):
    name = "spc_reports"

    def __init__(self, client: httpx.Client | None = None) -> None:
        self.client = client or make_client()

    def iter_reports(self, start: date, end: date, bbox: BBox) -> Iterator[StormReport]:
        today = datetime.now(timezone.utc).date()
        day = start
        while day <= end:
            if day < today:  # don't cache a partial file for the current report day
                for kind, suffix in ((StormType.hail, "hail"), (StormType.wind, "wind")):
                    blob = cached_get(
                        self.client, f"{BASE_URL}{day:%y%m%d}_rpts_filtered_{suffix}.csv", allow_404=True
                    )
                    if not blob:
                        continue
                    for rep in parse_csv(blob.decode("latin-1"), kind, day):
                        if in_bbox(rep.lon, rep.lat, bbox):
                            yield rep
            day += timedelta(days=1)
