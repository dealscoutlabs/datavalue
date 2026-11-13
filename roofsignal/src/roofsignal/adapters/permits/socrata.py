"""Building permits from a Socrata open-data portal (e.g. City of Dallas, dataset e7gq-4sah). Free.

The county YAML gives the domain, dataset id, column names and a SoQL filter. The classifier runs on
"<permit type> <work description>" so typed permits ("Residential Roofing Permit") and re-roofs filed under a
general renovation type ("REMOVE EXISTING ROOF AND INSTALL NEW ROOF") are both caught.
"""

from __future__ import annotations

import time
from collections.abc import Iterator

import httpx

from roofsignal.adapters.permits.csv_import import PermitRecord, parse_date
from roofsignal.core.http import make_client


class SocrataPermits:
    name = "socrata"

    def __init__(self, domain: str, dataset: str, columns: dict[str, str], where: str | None = None,
                 page_size: int = 50000, client: httpx.Client | None = None) -> None:
        self.url = f"https://{domain}/resource/{dataset}.json"
        self.columns = columns
        self.where = where
        self.page_size = page_size
        self.client = client or make_client()

    def _page(self, offset: int) -> list[dict]:
        params = {
            "$select": ",".join(sorted(set(self.columns.values()))),
            "$order": self.columns["permit_no"],
            "$limit": self.page_size,
            "$offset": offset,
        }
        if self.where:
            params["$where"] = self.where
        last: Exception | None = None
        for attempt in range(4):
            try:
                r = self.client.get(self.url, params=params)
                r.raise_for_status()
                return r.json()
            except httpx.HTTPError as exc:
                last = exc
                time.sleep(2**attempt)
        raise RuntimeError(f"Socrata query failed: {last}")

    def iter_permits(self, limit: int | None = None) -> Iterator[PermitRecord]:
        c = self.columns
        offset, n = 0, 0
        while True:
            rows = self._page(offset)
            for row in rows:
                desc = " ".join(x for x in (row.get(c.get("permit_type", "")), row.get(c.get("description", ""))) if x)
                z = row.get(c.get("zip", ""))
                yield PermitRecord(
                    permit_no=str(row[c["permit_no"]]),
                    issued_on=parse_date(row.get(c["issued_on"])),
                    description=desc or None,
                    address=row.get(c.get("address", "")),
                    zip=str(z)[:5] if z else None,
                    parcel_id=row.get(c["parcel_id"]) if c.get("parcel_id") else None,
                )
                n += 1
                if limit and n >= limit:
                    return
            if len(rows) < self.page_size:
                return
            offset += len(rows)
