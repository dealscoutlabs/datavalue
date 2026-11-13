"""Dallas Central Appraisal District (DCAD) bulk data (free).

Inputs (downloaded by `roofsignal parcels fetch dallas_tx`, or by hand):
  * Appraisal roll, DataProducts.aspx -> DCADyyyy_CURRENT.ZIP: ACCOUNT_INFO.CSV (owner, mailing, site address),
    ACCOUNT_APPRL_YEAR.CSV (state property code SPTD_CODE, city jurisdiction), RES_DETAIL.CSV (year built, roof,
    heating/AC, condition).
  * Parcel polygons, GISDataProducts.aspx -> PARCEL_GEOM.zip: shapefile in NAD83 Texas North Central (US ft),
    keyed by account number ("Acct" = GIS_PARCEL_ID).

We deliberately do NOT ingest DCAD's PHONE_NUM column: numbers may only enter outbound calling through the
compliance gate, never from an appraisal roll. Owners flagged EXCLUDE_OWNER='Y' (confidential under Texas law)
get no owner data stored and are never mailed.
"""

from __future__ import annotations

import csv
from collections.abc import Iterator
from pathlib import Path

from roofsignal.adapters.parcels.base import ParcelRecord, ParcelSource

# SPTD codes (DCAD SPTD_CD_XREF): A11 single-family, A12 townhouse, B12 duplex, E11 ranch improvements.
# Excluded by default: A13 condos (HOA roof), A20/M31 mobile homes, B11 apartments, vacant lots.
DEFAULT_CODES = ["A11", "A12", "B12", "E11"]

_ATTR_COLS = {
    "ROOF_TYP_DESC": "roof_type",
    "ROOF_MAT_DESC": "roof_material",
    "HEATING_TYP_DESC": "heating",
    "AC_TYP_DESC": "ac",
    "CDU_RATING_DESC": "condition",
    "TOT_LIVING_AREA_SF": "living_sqft",
    "NUM_STORIES_DESC": "stories",
}


def _csv(path: Path) -> Iterator[dict[str, str]]:
    with path.open(newline="", encoding="latin-1") as fh:
        yield from csv.DictReader(fh)


def _clean(v: str | None) -> str | None:
    if v is None:
        return None
    v = " ".join(v.split())
    return v or None


def mailing_line(row: dict[str, str]) -> str | None:
    """DCAD spreads owner names and street lines across OWNER_ADDRESS_LINE1..4; the street line is the last one."""
    lines = [_clean(row.get(f"OWNER_ADDRESS_LINE{i}")) for i in range(1, 5)]
    lines = [x for x in lines if x]
    return lines[-1] if lines else None


def site_address(row: dict[str, str]) -> str | None:
    parts = [_clean(row.get("STREET_NUM")), _clean(row.get("STREET_HALF_NUM")), _clean(row.get("FULL_STREET_NAME"))]
    addr = " ".join(p for p in parts if p)
    unit = _clean(row.get("UNIT_ID"))
    if addr and unit:
        addr = f"{addr} UNIT {unit}"
    return addr or None


def _year(v: str | None) -> int | None:
    try:
        y = int(float(v or 0))
    except ValueError:
        return None
    return y if 1700 < y < 2100 else None


class DcadParcels(ParcelSource):
    name = "dcad"

    def __init__(self, roll_dir: str | Path, geom_path: str | Path | None, sptd_codes: list[str] | None = None,
                 cities: list[str] | None = None) -> None:
        self.roll_dir = Path(roll_dir)
        self.geom_path = Path(geom_path) if geom_path else None
        self.codes = set(sptd_codes or DEFAULT_CODES)
        self.cities = {c.upper() for c in cities} if cities else None
        self.source_version = None

    def _check(self) -> None:
        for name in ("ACCOUNT_INFO.CSV", "ACCOUNT_APPRL_YEAR.CSV", "RES_DETAIL.CSV"):
            if not (self.roll_dir / name).exists():
                raise FileNotFoundError(f"{self.roll_dir / name} missing; run `roofsignal parcels fetch dallas_tx`")

    def _residential_accounts(self) -> dict[str, tuple[str, str]]:
        """account -> (city jurisdiction, SPTD code) for residential classes."""
        out: dict[str, tuple[str, str]] = {}
        for row in _csv(self.roll_dir / "ACCOUNT_APPRL_YEAR.CSV"):
            code = row.get("SPTD_CODE", "").strip()
            if code not in self.codes:
                continue
            city = (_clean(row.get("CITY_JURIS_DESC")) or "UNINCORPORATED").upper()
            if self.cities and city not in self.cities:
                continue
            out[row["ACCOUNT_NUM"]] = (city, code)
            if self.source_version is None and row.get("APPRAISAL_YR"):
                self.source_version = f"dcad_{row['APPRAISAL_YR']}"
        return out

    def _res_detail(self, accounts: dict) -> dict[str, tuple[int | None, dict]]:
        out: dict[str, tuple[int | None, dict]] = {}
        for row in _csv(self.roll_dir / "RES_DETAIL.CSV"):
            acct = row["ACCOUNT_NUM"]
            if acct not in accounts:
                continue
            yb = _year(row.get("YR_BUILT"))
            prev = out.get(acct)
            # Several buildings on one account: keep the oldest main structure's attributes.
            if prev is None or (yb and (prev[0] is None or yb < prev[0])):
                attrs = {k: _clean(row.get(c)) for c, k in _ATTR_COLS.items() if _clean(row.get(c))}
                if attrs.get("roof_material") == "UNASSIGNED":
                    attrs.pop("roof_material")
                out[acct] = (yb, attrs)
        return out

    def _geometries(self, wanted: set[str]) -> dict[str, dict]:
        if self.geom_path is None:
            return {}
        import shapefile
        from pyproj import Transformer

        tf = Transformer.from_crs("EPSG:2276", "EPSG:4326", always_xy=True)  # NAD83 TX North Central ftUS
        out: dict[str, dict] = {}
        with shapefile.Reader(str(self.geom_path)) as shp:
            fields = [f[0] for f in shp.fields[1:]]
            key = fields.index("Acct")
            for sr in shp.iterShapeRecords():
                acct = (sr.record[key] or "").strip()
                if acct not in wanted or not sr.shape.points:
                    continue
                gj = sr.shape.__geo_interface__
                out[acct] = _transform(gj, tf)
        return out

    def iter_parcels(self, *, limit: int | None = None) -> Iterator[ParcelRecord]:
        self._check()
        accounts = self._residential_accounts()
        details = self._res_detail(accounts)
        rows = []
        for row in _csv(self.roll_dir / "ACCOUNT_INFO.CSV"):
            if row["ACCOUNT_NUM"] in accounts:
                rows.append(row)
                if limit and len(rows) >= limit:
                    break
        geoms = self._geometries({(r.get("GIS_PARCEL_ID") or r["ACCOUNT_NUM"]).strip() for r in rows})
        for row in rows:
            acct = row["ACCOUNT_NUM"]
            restricted = row.get("EXCLUDE_OWNER", "").strip().upper() == "Y"
            yb, attrs = details.get(acct, (None, {}))
            owner = " ".join(x for x in (_clean(row.get("OWNER_NAME1")), _clean(row.get("OWNER_NAME2"))) if x)
            yield ParcelRecord(
                parcel_id=acct,
                sbl=(row.get("GIS_PARCEL_ID") or "").strip() or None,
                town=accounts[acct][0].title(),
                municipality=_clean(row.get("PROPERTY_CITY")),
                site_address=site_address(row),
                zip=(_clean(row.get("PROPERTY_ZIPCODE")) or "")[:5] or None,
                property_class=accounts[acct][1],
                year_built=yb,
                owner_name=None if restricted else (owner or None),
                owner_mail_address=None if restricted else mailing_line(row),
                owner_mail_city=None if restricted else _clean(row.get("OWNER_CITY")),
                owner_mail_state=None if restricted else _clean(row.get("OWNER_STATE")),
                owner_mail_zip=None if restricted else (_clean(row.get("OWNER_ZIPCODE")) or "")[:5] or None,
                geometry=geoms.get((row.get("GIS_PARCEL_ID") or acct).strip()),
                owner_info_restricted=restricted,
                attributes=attrs,
            )


def _transform(geom: dict, tf) -> dict:
    def ring(coords):
        xs, ys = zip(*[(c[0], c[1]) for c in coords])
        lon, lat = tf.transform(xs, ys)
        return [[round(a, 7), round(b, 7)] for a, b in zip(lon, lat)]

    t = geom["type"]
    if t == "Polygon":
        return {"type": "Polygon", "coordinates": [ring(r) for r in geom["coordinates"]]}
    if t == "MultiPolygon":
        return {"type": "MultiPolygon", "coordinates": [[ring(r) for r in poly] for poly in geom["coordinates"]]}
    raise ValueError(f"unexpected geometry {t}")
