"""Scoring run: gather evidence per property, compute signals, score, and store everything with the config hash."""

from __future__ import annotations

import json
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from roofsignal.adapters.factory import imagery_provider
from roofsignal.adapters.imagery.base import ImageryProvider
from roofsignal.core.config import CountyConfig, ScoringConfig
from roofsignal.db.models import County, ScoringRun, Trade
from roofsignal.ingestion.loaders import ensure_county
from roofsignal.scoring.scorer import score_property
from roofsignal.signals.core import SignalOutput, StormHit, imagery_signal, roof_age_signal, storm_signal


def _months_ago(d: date, months: int) -> date:
    y, m = divmod(d.month - 1 - months, 12)
    year, month = d.year + y, m + 1
    day = min(d.day, 28)
    return date(year, month, day)


def _storm_hits(session: Session, county: County, start: date, end: date) -> dict[uuid.UUID, list[StormHit]]:
    rows = session.execute(
        text(
            """
            SELECT p.id AS pid, e.event_type, e.magnitude, e.occurred_at, e.source, e.source_id, e.location_label
            FROM storm_event e
            JOIN property p ON p.county_id = :c AND ST_Intersects(p.centroid, e.swath)
            WHERE e.swath IS NOT NULL AND e.occurred_at >= :start AND e.occurred_at < :end
            """
        ),
        {"c": county.id, "start": start, "end": end + timedelta(days=1)},
    )
    hits: dict[uuid.UUID, list[StormHit]] = defaultdict(list)
    for r in rows:
        hits[r.pid].append(
            StormHit(r.event_type, r.magnitude, r.occurred_at, r.source, r.source_id, r.location_label)
        )
    return hits


def _last_roof_permits(session: Session, county: County, as_of: date) -> dict[uuid.UUID, date]:
    rows = session.execute(
        text(
            """
            SELECT pm.property_id AS pid, max(pm.issued_on) AS last
            FROM permit pm JOIN property p ON p.id = pm.property_id
            WHERE p.county_id = :c AND pm.work_category = 'roof' AND pm.issued_on <= :as_of
            GROUP BY pm.property_id
            """
        ),
        {"c": county.id, "as_of": as_of},
    )
    return {r.pid: r.last for r in rows}


def _areas_with_permit_data(session: Session, county: County) -> set[str]:
    rows = session.execute(
        text("SELECT lower(name) FROM jurisdiction WHERE county_id = :c AND permit_data_status = 'loaded'"),
        {"c": county.id},
    )
    return {r[0] for r in rows}


def run_scoring(
    session: Session,
    county_cfg: CountyConfig,
    scoring_cfg: ScoringConfig,
    trade: str = "roofing",
    as_of: date | None = None,
    imagery: ImageryProvider | None = None,
    progress=None,
) -> ScoringRun:
    trade_cfg = scoring_cfg.trades[trade]
    if not trade_cfg.enabled:
        raise ValueError(f"Trade {trade!r} is disabled in scoring.yaml")
    as_of = as_of or datetime.now(timezone.utc).date()
    county = ensure_county(session, county_cfg)

    run = ScoringRun(
        county_id=county.id, trade=Trade(trade), as_of=as_of, config_hash=scoring_cfg.config_hash(),
        config_snapshot=scoring_cfg.model_dump(),
    )
    session.add(run)
    session.commit()

    storm_cfg = trade_cfg.signals.get("storm")
    roof_cfg = trade_cfg.signals.get("roof_age")
    img_cfg = trade_cfg.signals.get("imagery")

    hits: dict = {}
    if storm_cfg and storm_cfg.enabled:
        lookback = int(storm_cfg.params.get("lookback_months", 12))
        hits = _storm_hits(session, county, _months_ago(as_of, lookback), as_of)
    permits = _last_roof_permits(session, county, as_of) if roof_cfg and roof_cfg.enabled else {}
    permit_areas = _areas_with_permit_data(session, county)
    imagery = imagery or (imagery_provider(session) if img_cfg and img_cfg.enabled else None)

    tiers: dict[str, int] = defaultdict(int)
    n = 0
    raw = session.connection().connection.driver_connection
    props = session.execute(
        text(
            "SELECT id, parcel_id, year_built, town, municipality, ST_X(centroid) AS lon, ST_Y(centroid) AS lat "
            "FROM property WHERE county_id = :c ORDER BY id"
        ),
        {"c": county.id},
    ).all()

    now = datetime.now(timezone.utc)
    sig_rows: list[tuple] = []
    score_rows: list[tuple] = []

    def flush() -> None:
        with raw.cursor() as cur:
            with cur.copy(
                "COPY signal_result (id, run_id, property_id, signal, adapter, is_mock, value, normalized, "
                "confidence, reason_codes, evidence, computed_at) FROM STDIN"
            ) as cp:
                for row in sig_rows:
                    cp.write_row(row)
            with cur.copy(
                "COPY score (id, run_id, property_id, trade, score, tier, reason_codes, components) FROM STDIN"
            ) as cp:
                for row in score_rows:
                    cp.write_row(row)
        sig_rows.clear()
        score_rows.clear()

    for p in props:
        outputs: dict[str, SignalOutput] = {}
        if storm_cfg and storm_cfg.enabled:
            outputs["storm"] = storm_signal(hits.get(p.id, []), storm_cfg.params)
        if roof_cfg and roof_cfg.enabled:
            has_data = bool({(p.town or "").lower(), (p.municipality or "").lower()} & permit_areas)
            outputs["roof_age"] = roof_age_signal(as_of, permits.get(p.id), p.year_built, has_data, roof_cfg.params)
        if img_cfg and img_cfg.enabled and imagery is not None:
            cond = imagery.roof_condition(p.parcel_id, p.lon, p.lat) if p.lon is not None else None
            outputs["imagery"] = imagery_signal(cond, img_cfg.params)

        result = score_property(outputs, trade_cfg)
        for out in outputs.values():
            sig_rows.append(
                (uuid.uuid4(), run.id, p.id, out.signal, out.adapter, out.is_mock, out.value, out.normalized,
                 out.confidence, out.reason_codes, json.dumps(out.evidence, default=str), now)
            )
        score_rows.append(
            (uuid.uuid4(), run.id, p.id, trade, result.score, result.tier, result.reason_codes,
             json.dumps(result.components))
        )
        tiers[result.tier] += 1
        n += 1
        if n % 10000 == 0:
            flush()
            if progress:
                progress(n)
    flush()

    run.finished_at = datetime.now(timezone.utc)
    run.stats = {
        "properties": n,
        "tiers": dict(sorted(tiers.items())),
        "properties_with_storm_hits": len(hits),
        "properties_with_roof_permit": len(permits),
        "imagery_provider": getattr(imagery, "name", None),
    }
    session.commit()
    return run


def latest_run(session: Session, county: County, trade: str = "roofing") -> ScoringRun | None:
    return session.scalar(
        select(ScoringRun)
        .where(ScoringRun.county_id == county.id, ScoringRun.trade == Trade(trade), ScoringRun.finished_at.is_not(None))
        .order_by(ScoringRun.started_at.desc())
        .limit(1)
    )
