"""NYS GIS Program Office public tax parcels (free). Covers only counties that publish openly; Nassau does not.

Service: https://nysgeohub.ny.gov/arcgis/rest/services/Parcels/NYS_Tax_Parcels_Public/FeatureServer/1
Data dictionary: https://gis.ny.gov/standardized-tax-parcel-data-dictionary
"""

from __future__ import annotations

import json
import time
from collections.abc import Iterator

import httpx

from roofsignal.adapters.parcels.base import ParcelRecord, ParcelSource
from roofsignal.core.http import make_client

DEFAULT_URL = "https://nysgeohub.ny.gov/arcgis/rest/services/Parcels/NYS_Tax_Parcels_Public/FeatureServer/1"

FIELDS = [
    "SWIS", "SBL", "PRINT_KEY", "CITYTOWN_NAME", "MUNI_NAME", "PARCEL_ADDR", "LOC_ZIP", "PROP_CLASS", "YR_BLT",
    "PRIMARY_OWNER", "MAIL_ADDR", "PO_BOX", "MAIL_CITY", "MAIL_STATE", "MAIL_ZIP", "ROLL_YR", "SWIS_SBL_ID",
]


def _clean(v):
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


def build_where(county_name: str, residential_classes: list[str], towns: list[str] | None) -> str:
    def q(s: str) -> str:
        return "'" + s.replace("'", "''") + "'"

    clauses = [f"COUNTY_NAME = {q(county_name)}"]
    if residential_classes:
        clauses.append(f"PROP_CLASS IN ({', '.join(q(c) for c in residential_classes)})")
    if towns:
        clauses.append(f"CITYTOWN_NAME IN ({', '.join(q(t) for t in towns)})")
    return " AND ".join(clauses)


def feature_to_record(feature: dict) -> ParcelRecord | None:
    p = {k: _clean(v) for k, v in (feature.get("properties") or {}).items()}
    swis, sbl = p.get("SWIS"), p.get("SBL") or p.get("PRINT_KEY")
    parcel_id = p.get("SWIS_SBL_ID") or (f"{swis}-{sbl}" if swis and sbl else None)
    if not parcel_id:
        return None
    yr = p.get("YR_BLT")
    mail_addr = p.get("MAIL_ADDR") or (f"PO BOX {p['PO_BOX']}" if p.get("PO_BOX") else None)
    return ParcelRecord(
        parcel_id=str(parcel_id),
        sbl=sbl,
        swis=swis,
        town=p.get("CITYTOWN_NAME"),
        municipality=p.get("MUNI_NAME"),
        site_address=p.get("PARCEL_ADDR"),
        zip=(str(p["LOC_ZIP"])[:5] if p.get("LOC_ZIP") else None),
        property_class=p.get("PROP_CLASS"),
        year_built=int(yr) if yr and int(yr) > 1700 else None,
        owner_name=p.get("PRIMARY_OWNER"),
        owner_mail_address=mail_addr,
        owner_mail_city=p.get("MAIL_CITY"),
        owner_mail_state=p.get("MAIL_STATE"),
        owner_mail_zip=(str(p["MAIL_ZIP"])[:10] if p.get("MAIL_ZIP") else None),
        geometry=feature.get("geometry"),
        raw={"ROLL_YR": p.get("ROLL_YR")},
    )


class NysPublicParcels(ParcelSource):
    name = "nys_public_parcels"

    def __init__(
        self,
        county_name: str,
        residential_classes: list[str],
        towns: list[str] | None = None,
        url: str = DEFAULT_URL,
        page_size: int = 2000,
        client: httpx.Client | None = None,
    ) -> None:
        self.where = build_where(county_name, residential_classes, towns)
        self.url = url
        self.page_size = page_size
        self.client = client or make_client()
        self.source_version = None

    def _query(self, params: dict) -> dict:
        last: Exception | None = None
        for attempt in range(4):
            try:
                r = self.client.get(f"{self.url}/query", params=params)
                r.raise_for_status()
                data = r.json()
                if "error" in data:
                    raise RuntimeError(f"ArcGIS error: {data['error']}")
                return data
            except (httpx.HTTPError, RuntimeError, json.JSONDecodeError) as exc:
                last = exc
                time.sleep(2**attempt)
        raise RuntimeError(f"parcel query failed: {last}")

    def count(self) -> int:
        return int(self._query({"where": self.where, "returnCountOnly": "true", "f": "json"})["count"])

    def iter_parcels(self, *, limit: int | None = None) -> Iterator[ParcelRecord]:
        offset, yielded = 0, 0
        while True:
            size = self.page_size if limit is None else min(self.page_size, limit - yielded)
            if size <= 0:
                return
            data = self._query(
                {
                    "where": self.where,
                    "outFields": ",".join(FIELDS),
                    "outSR": "4326",
                    "orderByFields": "OBJECTID",
                    "resultOffset": offset,
                    "resultRecordCount": size,
                    "f": "geojson",
                }
            )
            feats = data.get("features") or []
            for f in feats:
                rec = feature_to_record(f)
                if rec is None:
                    continue
                if self.source_version is None and rec.raw.get("ROLL_YR"):
                    self.source_version = f"roll_{rec.raw['ROLL_YR']}"
                yield rec
                yielded += 1
            if len(feats) < size:
                return
            offset += len(feats)
