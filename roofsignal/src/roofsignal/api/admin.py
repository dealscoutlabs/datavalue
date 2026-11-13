"""Admin/supervisor routes: counties, scored properties, campaigns, compliance log, internal DNC."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from roofsignal.api.deps import Manager, get_session
from roofsignal.callcenter import service as cc
from roofsignal.core.config import list_counties, load_county
from roofsignal.db.models import AppUser, Campaign, County, ScoringRun
from roofsignal.outreach.campaigns import export_csv
from roofsignal.scoring.reason_codes import REASON_CODES
from roofsignal.scoring.run import latest_run

router = APIRouter(dependencies=[Manager])


@router.get("/api/reason-codes")
def reason_codes() -> dict:
    return {c.code: {"label": c.label, "agent_visible": c.agent_visible} for c in REASON_CODES.values()}


@router.get("/api/counties")
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


@router.get("/api/counties/{county_key}/properties")
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


@router.get("/api/properties/{property_id}")
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


@router.get("/api/campaigns")
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


@router.get("/api/campaigns/{campaign_id}/export.csv", response_class=PlainTextResponse)
def campaign_export(campaign_id: str, session: Session = Depends(get_session)) -> PlainTextResponse:
    camp = session.get(Campaign, uuid.UUID(campaign_id))
    if camp is None:
        raise HTTPException(404, "campaign not found")
    return PlainTextResponse(
        export_csv(session, camp),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{camp.name}.csv"'},
    )


@router.get("/api/compliance/decisions")
def compliance_decisions(e164: str | None = None, allowed: bool | None = None, limit: int = Query(100, le=500),
                         session: Session = Depends(get_session)) -> list[dict]:
    where, params = ["true"], {"lim": limit}
    if e164:
        where.append("e164 = :e")
        params["e"] = cc.normalize_us_phone(e164) or e164
    if allowed is not None:
        where.append("allowed = :a")
        params["a"] = allowed
    rows = session.execute(text(
        f"SELECT id, e164, purpose, call_kind, allowed, block_reasons, checks, ruleset_version, evaluated_at, "
        f"recipient_state, recipient_timezones, next_window_start, allow_mock_data, actor FROM compliance_decision "
        f"WHERE {' AND '.join(where)} ORDER BY evaluated_at DESC LIMIT :lim"), params).mappings().all()
    return [{**dict(r), "id": str(r["id"])} for r in rows]


class DncIn(BaseModel):
    phone: str
    reason: str


@router.get("/api/admin/dnc")
def dnc_list(session: Session = Depends(get_session)) -> list[dict]:
    rows = session.execute(text("SELECT e164, reason, source, added_by, added_at FROM internal_dnc "
                                "WHERE removed_at IS NULL ORDER BY added_at DESC LIMIT 500")).mappings().all()
    return [dict(r) for r in rows]


@router.post("/api/admin/dnc")
def dnc_add(body: DncIn, user: AppUser = Manager, session: Session = Depends(get_session)) -> dict:
    e164 = cc.normalize_us_phone(body.phone)
    if not e164:
        raise HTTPException(422, "invalid phone number")
    cc.add_internal_dnc(session, e164, body.reason, "admin", f"user:{user.id}")
    return {"e164": e164}


@router.post("/api/admin/dnc/remove")
def dnc_remove(body: DncIn, user: AppUser = Manager, session: Session = Depends(get_session)) -> dict:
    e164 = cc.normalize_us_phone(body.phone)
    if not e164:
        raise HTTPException(422, "invalid phone number")
    try:
        n = cc.remove_internal_dnc(session, e164, f"user:{user.id}", body.reason)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"removed": n}
