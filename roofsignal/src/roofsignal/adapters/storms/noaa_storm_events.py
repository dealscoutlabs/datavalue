"""NOAA NCEI Storm Events Database (free, quality-controlled, published ~2-4 months after the event).

Bulk files: https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/StormEvents_details-ftp_v1.0_dYYYY_cYYYYMMDD.csv.gz
Thunderstorm wind MAGNITUDE is in knots; hail MAGNITUDE is in inches. We keep events that have coordinates.
"""

from __future__ import annotations

import csv
import gzip
import io
import re
from collections.abc import Iterator
from datetime import date, datetime, timedelta, timezone

import httpx

from roofsignal.adapters.storms.base import KNOTS_TO_MPH, BBox, StormReport, StormSource, in_bbox
from roofsignal.core.http import cached_get, make_client
from roofsignal.db.models import StormType

BASE_URL = "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/"
_EVENT_TYPES = {"Hail": StormType.hail, "Thunderstorm Wind": StormType.wind}
_TZ_RE = re.compile(r"^[A-Z]{2,4}([+-]?\d{1,2})$")


def parse_cz_timezone(tz: str) -> timezone:
    """Storm Events labels: 'EST-5', 'CST-6', 'AKST-9', 'HST-10', and 'GST10' (Guam, UTC+10). The number is the
    signed UTC offset in hours."""
    m = _TZ_RE.match((tz or "").strip().upper())
    if not m:
        raise ValueError(f"Unrecognized CZ_TIMEZONE {tz!r}")
    return timezone(timedelta(hours=int(m.group(1))))


def parse_row(row: dict[str, str]) -> StormReport | None:
    et = _EVENT_TYPES.get(row.get("EVENT_TYPE", ""))
    if et is None:
        return None
    try:
        lat, lon = float(row["BEGIN_LAT"]), float(row["BEGIN_LON"])
    except (KeyError, ValueError):
        return None  # zone-level events without coordinates are not usable for parcel matching
    mag_raw = (row.get("MAGNITUDE") or "").strip()
    magnitude = float(mag_raw) if mag_raw else None
    if et is StormType.wind and magnitude is not None:
        magnitude = round(magnitude * KNOTS_TO_MPH, 1)
    try:
        local = datetime.strptime(row["BEGIN_DATE_TIME"], "%d-%b-%y %H:%M:%S")
        occurred = local.replace(tzinfo=parse_cz_timezone(row["CZ_TIMEZONE"])).astimezone(timezone.utc)
    except (KeyError, ValueError):
        return None  # unparseable time: skip rather than guess
    end_lat = end_lon = None
    try:
        end_lat, end_lon = float(row["END_LAT"]), float(row["END_LON"])
    except (KeyError, ValueError):
        pass
    return StormReport(
        source="noaa_storm_events",
        source_id=row["EVENT_ID"],
        event_type=et,
        magnitude=magnitude,
        occurred_at=occurred,
        lon=lon,
        lat=lat,
        end_lon=end_lon,
        end_lat=end_lat,
        location_label=f"{row.get('BEGIN_LOCATION', '').title()}, {row.get('CZ_NAME', '').title()} {row.get('STATE', '').title()}".strip(", "),
        raw={k: row.get(k) for k in ("EPISODE_ID", "MAGNITUDE_TYPE", "SOURCE", "STATE", "CZ_NAME")},
    )


class NoaaStormEvents(StormSource):
    name = "noaa_storm_events"

    def __init__(self, client: httpx.Client | None = None) -> None:
        self.client = client or make_client()

    def _year_file(self, year: int) -> str | None:
        listing = self.client.get(BASE_URL)
        listing.raise_for_status()
        names = sorted(set(re.findall(rf"StormEvents_details-ftp_v1\.0_d{year}_c\d{{8}}\.csv\.gz", listing.text)))
        return names[-1] if names else None

    def iter_reports(self, start: date, end: date, bbox: BBox) -> Iterator[StormReport]:
        for year in range(start.year, end.year + 1):
            name = self._year_file(year)
            if not name:
                continue
            blob = cached_get(self.client, BASE_URL + name)
            text = gzip.decompress(blob).decode("latin-1")
            for row in csv.DictReader(io.StringIO(text)):
                rep = parse_row(row)
                if rep is None or not in_bbox(rep.lon, rep.lat, bbox):
                    continue
                if start <= rep.occurred_at.date() <= end:
                    yield rep
