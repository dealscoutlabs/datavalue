"""FastAPI app. Phase 1 exposes read-only admin endpoints for scored properties and campaign exports.

Auth: until Phase 2 adds role-based accounts, every /api route requires `Authorization: Bearer $ADMIN_API_TOKEN`
and the API refuses to serve data at all when that token is unset. The Next.js admin app calls these routes
server-side, so the token never reaches a browser.
"""

from __future__ import annotations

import hmac
import uuid
from collections.abc import Iterator

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.responses import PlainTextResponse
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from roofsignal.core.config import list_counties, load_county
from roofsignal.core.settings import get_settings
from roofsignal.db.models import Campaign, County, ScoringRun
from roofsignal.db.session import session_factory
from roofsignal.outreach.campaigns import export_csv
from roofsignal.scoring.reason_codes import REASON_CODES
from roofsignal.scoring.run import latest_run

app = FastAPI(title="RoofSignal API", version="0.1.0")


def get_session() -> Iterator[Session]:
    s = session_factory()()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


def require_admin(authorization: str | None = Header(default=None)) -> None:
    expected = get_settings().admin_api_token
    if not expected:
        raise HTTPException(503, "ADMIN_API_TOKEN is not configured; refusing to serve data")
    supplied = (authorization or "").removeprefix("Bearer ").strip()
    if not hmac.compare_digest(supplied.encode(), expected.encode()):
        raise HTTPException(401, "invalid token")


Admin = Depends(require_admin)


@app.get("/health")
def health(session: Session = Depends(get_session)) -> dict:
    session.execute(text("SELECT 1"))
    return {"ok": True}


@app.get("/api/reason-codes", dependencies=[Admin])
def reason_codes() -> dict:
    return {c.code: {"label": c.label, "agent_visible": c.agent_visible} for c in REASON_CODES.values()}


@app.get("/api/counties", dependencies=[Admin])
def counties(session: Session = Depends(get_session)) -> list[dict]:
    out = []
    for key in list_counties():
        cfg = load_county(key)
        c = session.scalar(select(County).where(County.key == key))
        run = latest_run(session, c) if c else None
        n = session.scalar(text("SELECT count(*) FROM property WHERE county_id = :c"), {"c": c.id}) if c else 0
        out.append({
            "key": key, "name": cfg.name, "state": cfg.state, "parcel_adapter": cfg.parcels.get("adapter"),
            "properties": n,
            "latest_run": None if run is None else {
                "id": str(run.id), "as_of": run.as_of.isoformat(), "config_hash": run.config_hash[:12],
                "finished_at": run.finished_at.isoformat() if run.finished_at else None, "stats": run.stats,
            },
        })
    return out


def _run_for(session: Session, county_key: str, run_id: str | None) -> ScoringRun:
    if run_id:
        run = session.get(ScoringRun, uuid.UUID(run_id))
    else:
        c = session.scalar(select(County).where(County.key == county_key))
        run = latest_run(session, c) if c else None
    if run is None:
        raise HTTPException(404, "no scoring run for this county")
    return run


@app.get("/api/counties/{county_key}/properties", dependencies=[Admin])
def properties(
    county_key: str,
    tier: list[str] = Query(default=[]),
    reason: str | None = None,
    town: str | None = None,
    zip: str | None = None,
    limit: int = Query(50, le=500),
    offset: int = 0,
    run_id: str | None = None,
    session: Session = Depends(get_session),
) -> dict:
    run = _run_for(session, county_key, run_id)
    where = ["s.run_id = :run"]
    params: dict = {"run": run.id, "lim": limit, "off": offset}
    if tier:
        where.append("s.tier = ANY(:tiers)")
        params["tiers"] = tier
    if reason:
        where.append(":reason = ANY(s.reason_codes)")
        params["reason"] = reason
    if town:
        where.append("(p.town ILIKE :town OR p.municipality ILIKE :town)")
        params["town"] = town
    if zip:
        where.append("p.zip = :zip")
        params["zip"] = zip
    clause = " AND ".join(where)
    total = session.scalar(text(f"SELECT count(*) FROM score s JOIN property p ON p.id = s.property_id WHERE {clause}"), params)
    rows = session.execute(
        text(
            f"""
            SELECT p.id, p.parcel_id, p.site_address, p.zip, p.town, p.municipality, p.year_built, p.owner_name,
                   p.owner_occupied_guess, s.score, s.tier, s.reason_codes
            FROM score s JOIN property p ON p.id = s.property_id
            WHERE {clause}
            ORDER BY s.score DESC, p.id LIMIT :lim OFFSET :off
            """
        ),
        params,
    ).mappings().all()
    return {
        "run": {"id": str(run.id), "as_of": run.as_of.isoformat(), "config_hash": run.config_hash[:12],
                "stats": run.stats},
        "total": total,
        "items": [{**dict(r), "id": str(r["id"])} for r in rows],
    }


@app.get("/api/properties/{property_id}", dependencies=[Admin])
def property_detail(property_id: str, run_id: str | None = None, session: Session = Depends(get_session)) -> dict:
    pid = uuid.UUID(property_id)
    prop = session.execute(
        text(
            """
            SELECT p.*, ST_AsGeoJSON(p.geom)::json AS geometry, ST_X(p.centroid) AS lon, ST_Y(p.centroid) AS lat,
                   c.key AS county_key
            FROM property p JOIN county c ON c.id = p.county_id WHERE p.id = :id
            """
        ),
        {"id": pid},
    ).mappings().first()
    if prop is None:
        raise HTTPException(404, "property not found")
    run = _run_for(session, prop["county_key"], run_id)
    score = session.execute(
        text("SELECT score, tier, reason_codes, components FROM score WHERE run_id = :r AND property_id = :p"),
        {"r": run.id, "p": pid},
    ).mappings().first()
    signals = session.execute(
        text(
            "SELECT signal, adapter, is_mock, value, normalized, confidence, reason_codes, evidence "
            "FROM signal_result WHERE run_id = :r AND property_id = :p ORDER BY signal"
        ),
        {"r": run.id, "p": pid},
    ).mappings().all()
    permits = session.execute(
        text(
            "SELECT pm.permit_no, pm.issued_on, pm.work_category, pm.work_type_raw, pm.match_method, "
            "pm.match_confidence, j.name AS jurisdiction FROM permit pm JOIN jurisdiction j ON j.id = pm.jurisdiction_id "
            "WHERE pm.property_id = :p ORDER BY pm.issued_on DESC NULLS LAST"
        ),
        {"p": pid},
    ).mappings().all()
    p = {k: v for k, v in prop.items() if k not in ("geom", "centroid")}
    p["id"] = str(p["id"])
    p["county_id"] = str(p["county_id"])
    return {
        "property": p,
        "run": {"id": str(run.id), "as_of": run.as_of.isoformat(), "config_hash": run.config_hash[:12]},
        "score": dict(score) if score else None,
        "signals": [dict(s) for s in signals],
        "permits": [dict(x) for x in permits],
    }


@app.get("/api/campaigns", dependencies=[Admin])
def campaigns(session: Session = Depends(get_session)) -> list[dict]:
    rows = session.execute(
        text(
            """
            SELECT c.id, c.name, c.channel, c.trade, c.tier_filter, c.tracking_phone, c.tracking_phone_is_mock,
                   c.status, c.created_at, co.key AS county_key, count(mp.id) AS pieces,
                   count(mp.exported_at) AS exported
            FROM campaign c JOIN county co ON co.id = c.county_id LEFT JOIN mail_piece mp ON mp.campaign_id = c.id
            GROUP BY c.id, co.key ORDER BY c.created_at DESC
            """
        )
    ).mappings().all()
    return [{**dict(r), "id": str(r["id"])} for r in rows]


@app.get("/api/campaigns/{campaign_id}/export.csv", dependencies=[Admin], response_class=PlainTextResponse)
def campaign_export(campaign_id: str, session: Session = Depends(get_session)) -> PlainTextResponse:
    camp = session.get(Campaign, uuid.UUID(campaign_id))
    if camp is None:
        raise HTTPException(404, "campaign not found")
    return PlainTextResponse(
        export_csv(session, camp),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{camp.name}.csv"'},
    )
