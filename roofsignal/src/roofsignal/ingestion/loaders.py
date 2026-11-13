"""Ingestion: county setup, parcels, permits (+ matching), storms (+ swaths). Each run is recorded in ingestion_run."""

from __future__ import annotations

import json
from collections.abc import Iterable, Iterator
from datetime import date, datetime, timezone
from itertools import islice
from pathlib import Path
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from roofsignal.adapters.parcels.base import ParcelRecord, ParcelSource
from roofsignal.adapters.parcels.csv_import import CsvParcels
from roofsignal.adapters.parcels.nys_public import NysPublicParcels
from roofsignal.adapters.permits.classifier import classify
from roofsignal.adapters.permits.csv_import import iter_permits
from roofsignal.adapters.storms.base import StormReport, StormSource
from roofsignal.core.address import normalize_address
from roofsignal.core.config import CountyConfig
from roofsignal.db.models import County, IngestionRun, Jurisdiction


def _batched(it: Iterable, n: int) -> Iterator[list]:
    it = iter(it)
    while batch := list(islice(it, n)):
        yield batch


def _start(session: Session, county: County | None, kind: str, source: str, params: dict) -> IngestionRun:
    run = IngestionRun(county_id=county.id if county else None, kind=kind, source=source, params=params)
    session.add(run)
    session.flush()
    return run


def _finish(run: IngestionRun, stats: dict, error: str | None = None) -> None:
    run.finished_at = datetime.now(timezone.utc)
    run.stats = stats
    run.status = "failed" if error else "ok"
    run.error = error


# --------------------------------------------------------------------------- county


def ensure_county(session: Session, cfg: CountyConfig) -> County:
    county = session.scalar(select(County).where(County.key == cfg.key))
    if county is None:
        county = County(key=cfg.key, fips=cfg.fips, name=cfg.name, state=cfg.state, timezone=cfg.timezone)
        session.add(county)
        session.flush()
    for j in cfg.jurisdictions:
        existing = session.scalar(
            select(Jurisdiction).where(
                Jurisdiction.county_id == county.id, Jurisdiction.name == j.name, Jurisdiction.kind == j.kind
            )
        )
        if existing is None:
            session.add(
                Jurisdiction(county_id=county.id, name=j.name, kind=j.kind, permit_data_status=j.permit_data_status)
            )
    session.flush()
    return county


# --------------------------------------------------------------------------- parcels


def parcel_source_for(cfg: CountyConfig, overrides: dict[str, Any] | None = None) -> ParcelSource:
    p = {**cfg.parcels, **(overrides or {})}
    adapter = p.get("adapter")
    if adapter == "nys_public_parcels":
        return NysPublicParcels(
            county_name=p["county_name"], residential_classes=p.get("residential_classes", []), towns=p.get("towns")
        )
    if adapter == "csv_import":
        return CsvParcels(
            path=p["path"], columns=p["columns"], lat_col=p.get("lat_col"), lon_col=p.get("lon_col"),
            residential_classes=p.get("residential_classes"),
        )
    raise ValueError(f"Unknown parcel adapter {adapter!r} for county {cfg.key}")


_UPSERT_PARCEL = text(
    """
    INSERT INTO property (id, county_id, parcel_id, sbl, swis, town, municipality, site_address, address_key, zip,
        property_class, year_built, owner_name, owner_mail_address, owner_mail_city, owner_mail_state, owner_mail_zip,
        owner_occupied_guess, geom, centroid, source, source_version)
    SELECT gen_random_uuid(), :county_id, :parcel_id, :sbl, :swis, :town, :municipality, :site_address, :address_key,
        :zip, :property_class, :year_built, :owner_name, :owner_mail_address, :owner_mail_city, :owner_mail_state,
        :owner_mail_zip, :owner_occupied_guess, g.geom,
        CASE WHEN g.geom IS NULL THEN NULL ELSE ST_PointOnSurface(g.geom) END, :source, :source_version
    FROM (SELECT CASE WHEN CAST(:geojson AS text) IS NULL THEN NULL
                      ELSE ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(CAST(:geojson AS text)), 4326)) END AS geom) g
    ON CONFLICT (county_id, parcel_id) DO UPDATE SET
        sbl = EXCLUDED.sbl, swis = EXCLUDED.swis, town = EXCLUDED.town, municipality = EXCLUDED.municipality,
        site_address = EXCLUDED.site_address, address_key = EXCLUDED.address_key, zip = EXCLUDED.zip,
        property_class = EXCLUDED.property_class, year_built = EXCLUDED.year_built,
        owner_name = EXCLUDED.owner_name, owner_mail_address = EXCLUDED.owner_mail_address,
        owner_mail_city = EXCLUDED.owner_mail_city, owner_mail_state = EXCLUDED.owner_mail_state,
        owner_mail_zip = EXCLUDED.owner_mail_zip, owner_occupied_guess = EXCLUDED.owner_occupied_guess,
        geom = EXCLUDED.geom, centroid = EXCLUDED.centroid, source = EXCLUDED.source,
        source_version = EXCLUDED.source_version, updated_at = now()
    """
)


def _owner_occupied(rec: ParcelRecord) -> bool | None:
    site, mail = normalize_address(rec.site_address), normalize_address(rec.owner_mail_address)
    if not site or not mail:
        return None
    return site == mail and (not rec.zip or not rec.owner_mail_zip or rec.zip[:5] == rec.owner_mail_zip[:5])


def _parcel_params(county_id, rec: ParcelRecord, source: str, version: str | None) -> dict:
    return {
        "county_id": county_id,
        "parcel_id": rec.parcel_id,
        "sbl": rec.sbl,
        "swis": rec.swis,
        "town": rec.town,
        "municipality": rec.municipality,
        "site_address": rec.site_address,
        "address_key": normalize_address(rec.site_address),
        "zip": rec.zip,
        "property_class": rec.property_class,
        "year_built": rec.year_built,
        "owner_name": rec.owner_name,
        "owner_mail_address": rec.owner_mail_address,
        "owner_mail_city": rec.owner_mail_city,
        "owner_mail_state": rec.owner_mail_state,
        "owner_mail_zip": rec.owner_mail_zip,
        "owner_occupied_guess": _owner_occupied(rec),
        "geojson": json.dumps(rec.geometry) if rec.geometry else None,
        "source": source,
        "source_version": version,
    }


def load_parcels(
    session: Session, cfg: CountyConfig, source: ParcelSource | None = None, limit: int | None = None,
    batch_size: int = 1000, progress=None,
) -> dict:
    county = ensure_county(session, cfg)
    source = source or parcel_source_for(cfg)
    run = _start(session, county, "parcels", source.name, {"limit": limit})
    session.commit()
    stats = {"loaded": 0, "with_year_built": 0, "with_geometry": 0}
    try:
        for batch in _batched(source.iter_parcels(limit=limit), batch_size):
            params = [_parcel_params(county.id, r, source.name, source.source_version) for r in batch]
            session.execute(_UPSERT_PARCEL, params)
            stats["loaded"] += len(batch)
            stats["with_year_built"] += sum(1 for r in batch if r.year_built)
            stats["with_geometry"] += sum(1 for r in batch if r.geometry)
            session.commit()
            if progress:
                progress(stats["loaded"])
        _finish(run, stats)
    except Exception as exc:
        session.rollback()
        _finish(run, stats, error=str(exc))
        session.add(run)
        session.commit()
        raise
    session.commit()
    return stats


# --------------------------------------------------------------------------- permits


def load_permits(
    session: Session, cfg: CountyConfig, jurisdiction_name: str, path: str | Path, columns: dict[str, str],
    jurisdiction_kind: str = "town",
) -> dict:
    """Load one jurisdiction's permit file and match each permit to a parcel.

    Match order: parcel id (1.0) -> normalized address + ZIP (0.9) -> address unique within that town/village (0.7).
    """
    county = ensure_county(session, cfg)
    jur = session.scalar(
        select(Jurisdiction).where(
            Jurisdiction.county_id == county.id, Jurisdiction.name == jurisdiction_name,
            Jurisdiction.kind == jurisdiction_kind,
        )
    )
    if jur is None:
        jur = Jurisdiction(county_id=county.id, name=jurisdiction_name, kind=jurisdiction_kind)
        session.add(jur)
        session.flush()
    run = _start(session, county, "permits", "csv_import", {"jurisdiction": jurisdiction_name, "file": str(path)})

    area_col = "municipality" if jurisdiction_kind == "village" else "town"
    rows = session.execute(
        text(
            f"SELECT id, parcel_id, sbl, address_key, zip FROM property "
            f"WHERE county_id = :c AND {area_col} ILIKE :name"
        ),
        {"c": county.id, "name": jurisdiction_name},
    ).all()
    by_parcel = {}
    by_addr_zip = {}
    by_addr: dict[str, list] = {}
    for r in rows:
        for pid in (r.parcel_id, r.sbl):
            if pid:
                by_parcel[pid.replace(" ", "").upper()] = r.id
        if r.address_key:
            by_addr_zip[(r.address_key, r.zip)] = r.id
            by_addr.setdefault(r.address_key, []).append(r.id)

    stats = {"rows": 0, "matched": 0, "roof": 0, "by_method": {}}
    for rec in iter_permits(path, columns):
        stats["rows"] += 1
        prop_id, method, conf = None, None, None
        if rec.parcel_id and rec.parcel_id.replace(" ", "").upper() in by_parcel:
            prop_id, method, conf = by_parcel[rec.parcel_id.replace(" ", "").upper()], "parcel_id", 1.0
        else:
            key = normalize_address(rec.address)
            if key and rec.zip and (key, rec.zip) in by_addr_zip:
                prop_id, method, conf = by_addr_zip[(key, rec.zip)], "address_zip", 0.9
            elif key and len(by_addr.get(key, [])) == 1:
                prop_id, method, conf = by_addr[key][0], "address_town", 0.7
        category = classify(rec.description)
        stats["roof"] += category.value == "roof"
        if prop_id:
            stats["matched"] += 1
            stats["by_method"][method] = stats["by_method"].get(method, 0) + 1
        session.execute(
            text(
                """
                INSERT INTO permit (id, jurisdiction_id, property_id, permit_no, issued_on, work_type_raw, work_category,
                    raw_address, raw_parcel_id, match_method, match_confidence, source)
                VALUES (gen_random_uuid(), :j, :p, :no, :issued, :desc, :cat, :addr, :pid, :m, :conf, 'csv_import')
                ON CONFLICT (jurisdiction_id, permit_no) DO UPDATE SET property_id = EXCLUDED.property_id,
                    issued_on = EXCLUDED.issued_on, work_type_raw = EXCLUDED.work_type_raw,
                    work_category = EXCLUDED.work_category, match_method = EXCLUDED.match_method,
                    match_confidence = EXCLUDED.match_confidence, updated_at = now()
                """
            ),
            {
                "j": jur.id, "p": prop_id, "no": rec.permit_no, "issued": rec.issued_on, "desc": rec.description,
                "cat": category.value, "addr": rec.address, "pid": rec.parcel_id, "m": method, "conf": conf,
            },
        )
    jur.permit_data_status = "loaded"
    _finish(run, stats)
    session.commit()
    return stats


# --------------------------------------------------------------------------- storms


def load_storms(
    session: Session, cfg: CountyConfig, sources: list[StormSource], start: date, end: date,
) -> dict:
    """Upsert storm reports inside the county bbox, then (re)build each report's swath footprint."""
    county = ensure_county(session, cfg)
    radii = cfg.storms.get("swath_radius_m", {"hail": 2000, "wind": 3000})
    stats: dict[str, Any] = {}
    for src in sources:
        run = _start(session, county, "storms", src.name, {"start": start.isoformat(), "end": end.isoformat()})
        n = 0
        for rep in src.iter_reports(start, end, tuple(cfg.bbox)):
            _upsert_storm(session, rep)
            n += 1
        _finish(run, {"reports": n})
        stats[src.name] = n
        session.commit()

    session.execute(
        text(
            """
            UPDATE storm_event SET
                swath_radius_m = CASE event_type WHEN 'hail' THEN :hail ELSE :wind END,
                swath = ST_Buffer(geom::geography, CASE event_type WHEN 'hail' THEN :hail ELSE :wind END)::geometry
            WHERE occurred_at::date BETWEEN :start AND :end
              AND ST_Intersects(geom, ST_MakeEnvelope(:x0, :y0, :x1, :y1, 4326))
            """
        ),
        {"hail": radii["hail"], "wind": radii["wind"], "start": start, "end": end,
         "x0": cfg.bbox[0], "y0": cfg.bbox[1], "x1": cfg.bbox[2], "y1": cfg.bbox[3]},
    )
    session.commit()
    return stats


def _upsert_storm(session: Session, rep: StormReport) -> None:
    if rep.end_lon is not None and rep.end_lat is not None and (rep.end_lon, rep.end_lat) != (rep.lon, rep.lat):
        wkt = f"LINESTRING({rep.lon} {rep.lat}, {rep.end_lon} {rep.end_lat})"
    else:
        wkt = f"POINT({rep.lon} {rep.lat})"
    session.execute(
        text(
            """
            INSERT INTO storm_event (id, source, source_id, event_type, magnitude, occurred_at, location_label, geom, raw)
            VALUES (gen_random_uuid(), :source, :sid, :et, :mag, :at, :loc, ST_GeomFromText(:wkt, 4326), CAST(:raw AS jsonb))
            ON CONFLICT (source, source_id) DO UPDATE SET magnitude = EXCLUDED.magnitude,
                occurred_at = EXCLUDED.occurred_at, geom = EXCLUDED.geom, raw = EXCLUDED.raw, updated_at = now()
            """
        ),
        {"source": rep.source, "sid": rep.source_id, "et": rep.event_type.value, "mag": rep.magnitude,
         "at": rep.occurred_at, "loc": rep.location_label, "wkt": wkt, "raw": json.dumps(rep.raw)},
    )
